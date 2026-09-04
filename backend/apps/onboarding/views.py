import uuid
from datetime import datetime

from django.conf import settings
from django.shortcuts import redirect
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.storage import (
    delete_object,
    is_configured,
    signed_url,
    upload_bytes,
)

from .models import (
    Onboarding,
    OnboardingChecklistItem,
    OnboardingData,
    OnboardingDocument,
)
from .permissions import IsOnboardingAdmin
from .serializers import (
    OnboardingChecklistItemSerializer,
    OnboardingDataReadSerializer,
    OnboardingDataSerializer,
    OnboardingDocumentSerializer,
    OnboardingSerializer,
    PRIVILEGED_ROLES,
)
from .services import (
    complete_onboarding,
    create_default_checklist,
    readiness_errors,
    sync_checklist,
    transition_onboarding,
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

class OnboardingViewSet(viewsets.ModelViewSet):
    queryset = (
        Onboarding.objects.select_related(
            'candidate',
            'candidate__job',
            'candidate__job__department',
            'candidate__job__position',
            'created_by',
        )
        .prefetch_related('status_history', 'checklist_items')
        .all()
    )
    serializer_class = OnboardingSerializer
    permission_classes = [IsOnboardingAdmin]
    filterset_fields = ['status', 'candidate']
    search_fields = ['candidate__full_name', 'candidate__email', 'candidate__job__title']
    ordering_fields = ['created_at', 'target_join_date']
    ordering = ['-created_at']

    def _editable_or_400(self, obj):
        if not obj.is_editable():
            raise serializers.ValidationError('Onboarding COMPLETED/CANCELLED tidak dapat diubah.')

    def create(self, request, *args, **kwargs):
        candidate_id = request.data.get('candidate')
        if not candidate_id:
            return Response({'detail': 'candidate wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.recruitment.models import Candidate
        try:
            candidate = Candidate.objects.select_related('job').get(pk=candidate_id)
        except Candidate.DoesNotExist:
            return Response({'detail': 'Candidate tidak ditemukan.'}, status=status.HTTP_400_BAD_REQUEST)

        if candidate.status != 'OFFER_ACCEPTED':
            return Response(
                {'detail': 'Onboarding hanya dapat dibuat untuk candidate dengan status OFFER_ACCEPTED.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Onboarding.objects.filter(candidate=candidate).exists():
            return Response(
                {'detail': 'Onboarding untuk candidate ini sudah ada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save(candidate=candidate, created_by=request.user)
        create_default_checklist(obj)
        log_event(
            request,
            'create',
            obj=obj,
            description=f'Onboarding dibuat untuk candidate "{candidate.full_name}"',
        )
        return Response(
            self.get_serializer(obj, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        self._editable_or_400(self.get_object())
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._editable_or_400(self.get_object())
        obj = self.get_object()
        # Block direct PATCH to COMPLETED.
        if request.data.get('status') == 'COMPLETED':
            raise serializers.ValidationError(
                'COMPLETED hanya dapat dilakukan melalui action "Complete Onboarding".'
            )
        return super().partial_update(request, *args, **kwargs)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(
            self.request,
            'update',
            obj=obj,
            description=f'Onboarding "{obj.candidate.full_name}" diperbarui',
        )

    def destroy(self, request, *args, **kwargs):
        """Permanent delete — admin/superuser only."""
        if not (request.user.is_superuser or getattr(getattr(request.user, 'role', None), 'key', None) == 'ADMIN'):
            return Response({'detail': 'Hanya admin yang dapat menghapus onboarding.'}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        name = obj.candidate.full_name
        obj.delete()
        log_event(request, 'delete', obj=None, description=f'Onboarding "{name}" deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        return self.destroy(request, pk=pk)

    # ---- Employment data -------------------------------------------------

    @action(detail=True, methods=['get', 'patch'])
    def data(self, request, pk=None):
        """GET or PATCH onboarding employment data (biodata/financial/employment)."""
        onboarding = self.get_object()
        data, _ = OnboardingData.objects.get_or_create(onboarding=onboarding)
        if request.method == 'GET':
            role = getattr(getattr(request.user, 'role', None), 'key', None)
            serializer_class = (
                OnboardingDataSerializer
                if role in PRIVILEGED_ROLES
                else OnboardingDataReadSerializer
            )
            serializer = serializer_class(data, context=self.get_serializer_context())
            return Response(serializer.data)
        self._editable_or_400(onboarding)
        serializer = OnboardingDataSerializer(
            data, data=request.data, partial=True, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        sync_checklist(onboarding)
        log_event(
            request,
            'update',
            obj=data,
            description=f'Data onboarding "{onboarding.candidate.full_name}" diperbarui',
        )
        return Response(serializer.data)

    # ---- Checklist --------------------------------------------------------

    @action(detail=True, methods=['get'])
    def checklist(self, request, pk=None):
        """List the onboarding checklist (auto-created defaults)."""
        onboarding = self.get_object()
        items = onboarding.checklist_items.all()
        serializer = OnboardingChecklistItemSerializer(
            items, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=True, methods=['patch'], url_path='checklist/(?P<item_id>[0-9]+)')
    def checklist_item(self, request, pk=None, item_id=None):
        """Mark a checklist item complete / add notes."""
        onboarding = self.get_object()
        self._editable_or_400(onboarding)
        try:
            item = onboarding.checklist_items.get(pk=item_id)
        except OnboardingChecklistItem.DoesNotExist:
            return Response({'detail': 'Item checklist tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = OnboardingChecklistItemSerializer(
            item, data=request.data, partial=True, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(completed_by=request.user)
        log_event(
            request,
            'update',
            obj=item,
            description=f'Checklist "{item.code}" diperbarui',
        )
        return Response(serializer.data)

    # ---- Documents --------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], parser_classes=[JSONParser, FormParser, MultiPartParser])
    def documents(self, request, pk=None):
        """List onboarding documents, or upload a new one (multipart)."""
        onboarding = self.get_object()
        if request.method == 'GET':
            docs = onboarding.documents.all()
            serializer = OnboardingDocumentSerializer(
                docs, many=True, context=self.get_serializer_context()
            )
            return Response(serializer.data)
        self._editable_or_400(onboarding)

        upload = request.FILES.get('file')
        if not upload:
            return Response({'detail': 'file wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)

        document_type = request.data.get('document_type') or 'LAINNYA'
        if document_type not in dict(OnboardingDocument.DocType.choices):
            return Response({'detail': 'document_type tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response(
                {'detail': f'File melebihi batas {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.content_type not in ALLOWED_MIME_TYPES:
            return Response(
                {'detail': 'Tipe file tidak diizinkan. Gunakan PDF, JPG, PNG, atau DOC/DOCX.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        path = f'onboarding/{onboarding.id}/documents/{datetime.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:8]}-{upload.name}'
        try:
            upload_bytes(settings.ONBOARDING_STORAGE_BUCKET, path, upload.read(), upload.content_type)
        except Exception as exc:
            return Response(
                {'detail': f'Upload gagal: {str(exc)[:120]}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        doc = OnboardingDocument.objects.create(
            onboarding=onboarding,
            document_type=document_type,
            notes=(request.data.get('notes') or '').strip()[:500],
            original_filename=upload.name,
            storage_path=path,
            file_size=upload.size,
            mime_type=upload.content_type,
            uploaded_by=request.user,
        )
        log_event(
            request,
            'create',
            obj=doc,
            description=f'Dokumen {document_type} "{upload.name}" diunggah',
        )
        serializer = OnboardingDocumentSerializer(doc, context=self.get_serializer_context())
        sync_checklist(onboarding)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch', 'delete'], url_path='documents/(?P<document_id>[0-9]+)')
    def document_detail(self, request, pk=None, document_id=None):
        """Review (approve/reject/notes) or delete an onboarding document."""
        onboarding = self.get_object()
        self._editable_or_400(onboarding)
        try:
            doc = onboarding.documents.get(pk=document_id)
        except OnboardingDocument.DoesNotExist:
            return Response({'detail': 'Dokumen tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)

        if request.method == 'DELETE':
            try:
                delete_object(settings.ONBOARDING_STORAGE_BUCKET, doc.storage_path)
            except Exception:
                pass  # best-effort: DB row is the source of truth for deletion
            doc.delete()
            log_event(
                request,
                'delete',
                obj=doc,
                description=f'Dokumen {doc.document_type} "{doc.original_filename}" dihapus',
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        if request.data.get('status') in ('APPROVED', 'REJECTED'):
            doc.reviewed_by = request.user
            doc.reviewed_at = timezone.now()
        serializer = OnboardingDocumentSerializer(
            doc, data=request.data, partial=True, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        sync_checklist(onboarding)
        log_event(
            request,
            'update',
            obj=doc,
            description=f'Dokumen {doc.document_type} "{doc.original_filename}" status -> {doc.status}',
        )
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='documents/(?P<document_id>[0-9]+)/download')
    def document_download(self, request, pk=None, document_id=None):
        """Redirect to a short-lived signed URL for the stored document."""
        onboarding = self.get_object()
        try:
            doc = onboarding.documents.get(pk=document_id)
        except OnboardingDocument.DoesNotExist:
            return Response({'detail': 'Dokumen tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        log_event(
            request,
            'read',
            obj=doc,
            description=f'Dokumen {doc.document_type} "{doc.original_filename}" dilihat',
        )
        # Return signed URL as JSON so the browser can open it in a new tab
        # without a cross-origin redirect (which fetch cannot follow with
        # credentials). Bucket stays private; secret never leaves the server.
        return Response({'url': signed_url(settings.ONBOARDING_STORAGE_BUCKET, doc.storage_path)})

    @action(detail=True, methods=['get'])
    def readiness(self, request, pk=None):
        """Report onboarding readiness (blockers + progress)."""
        onboarding = self.get_object()
        sync_checklist(onboarding)
        checklist = onboarding.checklist_items.all()
        total = checklist.count()
        done = checklist.filter(completed=True).count()
        errors = readiness_errors(onboarding)
        return Response({
            'status': onboarding.status,
            'ready': onboarding.status in ('READY', 'COMPLETED') or (
                onboarding.status == 'DOCUMENT_REVIEW' and len(errors) == 0
            ),
            'progress': round(done / total * 100) if total else 0,
            'errors': errors,
        })

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        """Forward-only status move. HR/admin only."""
        obj = self.get_object()
        to_status = request.data.get('status')
        note = (request.data.get('note') or '').strip()
        if not to_status or to_status not in dict(Onboarding.Status.choices):
            return Response({'detail': 'Status tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        if to_status == 'COMPLETED':
            return Response(
                {'detail': 'COMPLETED hanya dapat dilakukan melalui action "Complete Onboarding".'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        onboarding, history = transition_onboarding(obj, to_status, request, note)
        if onboarding is None:
            return Response(
                {'detail': f'Transisi dari {obj.status} ke {to_status} tidak diizinkan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(self.get_serializer(onboarding, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Complete onboarding → create Employee, Contract, User account."""
        onboarding = self.get_object()
        if onboarding.status == 'COMPLETED':
            return Response(
                self.get_serializer(onboarding, context={'request': request}).data,
                status=status.HTTP_200_OK,
            )
        if onboarding.status != 'READY':
            return Response(
                {'detail': 'Onboarding harus berstatus READY untuk dikompletasi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = complete_onboarding(onboarding, request)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        log_event(
            request,
            'update',
            obj=result,
            description=f'Onboarding "{result.candidate.full_name}" completed via complete action',
        )
        return Response(
            self.get_serializer(result, context={'request': request}).data,
            status=status.HTTP_200_OK,
        )