from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.permissions import _role
from apps.personnel.storage import is_configured, signed_url, upload_bytes

from .models import Candidate, Job
from .permissions import IsRecruitmentAdmin, RECRUITMENT_ADMIN_ROLES
from .serializers import CandidateSerializer, JobPublicSerializer, JobSerializer
from .services import _bucket, transition_candidate


class JobViewSet(viewsets.ModelViewSet):
    """HR admin: manage job postings."""

    queryset = Job.objects.select_related('department', 'position').prefetch_related('applications').all()
    serializer_class = JobSerializer
    permission_classes = [IsRecruitmentAdmin]
    filterset_fields = ['status', 'department', 'employment_type']
    search_fields = ['title', 'location']
    ordering_fields = ['created_at', 'open_date', 'close_date']

    def perform_create(self, serializer):
        slug = self._unique_slug(serializer.validated_data['title'])
        obj = serializer.save(created_by=self.request.user, slug=slug)
        log_event(self.request, 'create', obj=obj, description=f'Job "{obj.title}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Job "{obj.title}" updated')

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.status != 'DRAFT':
            return Response({'detail': 'Hanya job DRAFT yang dapat dihapus.'}, status=status.HTTP_400_BAD_REQUEST)
        log_event(request, 'delete', obj=obj, description=f'Job "{obj.title}" deleted')
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        """Permanent delete — admin/superuser only (bypasses DRAFT restriction)."""
        if not (request.user.is_superuser or _role(request.user) == 'ADMIN'):
            return Response({'detail': 'Hanya admin yang dapat menghapus permanen.'}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        title = obj.title
        obj.delete()
        log_event(request, 'delete', obj=None, description=f'Job "{title}" hard-deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        obj = self.get_object()
        if obj.status == 'OPEN':
            return Response({'detail': 'Job sudah OPEN.'}, status=status.HTTP_400_BAD_REQUEST)
        if not obj.is_complete():
            return Response({'detail': 'Job tidak lengkap. Lengkapi semua field wajib sebelum membuka.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'OPEN'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'approve', obj=obj, description=f'Job "{obj.title}" opened')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        obj = self.get_object()
        if obj.status != 'OPEN':
            return Response({'detail': 'Hanya job OPEN yang dapat ditutup.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'CLOSED'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'close', obj=obj, description=f'Job "{obj.title}" closed')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        obj = self.get_object()
        if obj.status != 'CLOSED':
            return Response({'detail': 'Hanya job CLOSED yang dapat dibuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        if obj.close_date and obj.close_date < timezone.localdate():
            return Response({'detail': 'Close date sudah lewat. Perbarui close_date sebelum membuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        if not obj.is_complete():
            return Response({'detail': 'Job tidak lengkap. Lengkapi semua field wajib sebelum membuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'OPEN'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'approve', obj=obj, description=f'Job "{obj.title}" reopened')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @staticmethod
    def _unique_slug(title, attempt=0):
        base = slugify(title)[:250]
        slug = f'{base}-{attempt}' if attempt else base
        if Job.objects.filter(slug=slug).exists():
            return JobViewSet._unique_slug(title, attempt + 1)
        return slug


class PublicJobViewSet(viewsets.ReadOnlyModelViewSet):
    """Public: list OPEN jobs, view job detail by slug."""

    queryset = Job.objects.filter(status='OPEN').select_related('department', 'position').all()
    serializer_class = JobPublicSerializer
    permission_classes = [AllowAny]
    lookup_field = 'slug'
    pagination_class = None

    def get_queryset(self):
        today = timezone.localdate()
        # Exclude jobs where close_date is in the past
        return self.queryset.filter(
            status='OPEN',
        ).exclude(
            close_date__lt=today,
        )


class CandidateViewSet(viewsets.ModelViewSet):
    """HR: view candidates. Public: create via Apply."""

    queryset = Candidate.objects.select_related('job').all()
    serializer_class = CandidateSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    filterset_fields = ['job', 'source', 'status']
    search_fields = ['full_name', 'email']

    def get_permissions(self):
        if self.action == 'create':
            return [AllowAny()]
        return [IsRecruitmentAdmin()]

    def perform_create(self, serializer):
        obj = serializer.save()
        file = self.request.FILES.get('cv')
        if file and is_configured():
            path = f'cvs/{obj.id}/{file.name}'
            upload_bytes(_bucket(), path, file.read(), file.content_type or 'application/octet-stream')
            obj.cv_name = file.name
            obj.cv_path = path
            obj.cv_content_type = file.content_type or ''
            obj.save(update_fields=['cv_name', 'cv_path', 'cv_content_type', 'updated_at'])
            log_event(self.request, 'upload', obj=obj, description=f'CV uploaded for candidate "{obj.full_name}"')
        log_event(self.request, 'create', obj=obj, description=f'Candidate "{obj.full_name}" applied for "{obj.job.title}"')

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        """Move candidate to next status. Only HR roles (IsRecruitmentAdmin)."""
        obj = self.get_object()
        to_status = request.data.get('status')
        note = (request.data.get('note') or '').strip()
        if not to_status or to_status not in dict(Candidate.STATUS_CHOICES):
            return Response({'detail': 'Status tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        candidate, history = transition_candidate(obj, to_status, request, note)
        if candidate is None:
            return Response(
                {'detail': f'Transisi dari {obj.status} ke {to_status} tidak diizinkan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(CandidateSerializer(candidate, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'])
    def cv(self, request, pk=None):
        obj = self.get_object()
        if request.method == 'GET':
            return self._download_cv(request, obj)
        return self._upload_cv(request, obj)

    def _upload_cv(self, request, obj):
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'File wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        path = f'cvs/{obj.id}/{file.name}'
        upload_bytes(_bucket(), path, file.read(), file.content_type or 'application/octet-stream')
        if obj.cv_path:
            try:
                from apps.personnel.storage import delete_object
                delete_object(_bucket(), obj.cv_path)
            except Exception:
                pass
        obj.cv_name = file.name
        obj.cv_path = path
        obj.cv_content_type = file.content_type or ''
        obj.save(update_fields=['cv_name', 'cv_path', 'cv_content_type', 'updated_at'])
        log_event(request, 'upload', obj=obj, description=f'CV uploaded for candidate "{obj.full_name}"')
        return Response({'detail': 'CV uploaded.', 'cv_name': file.name})

    def _download_cv(self, request, obj):
        if not obj.cv_path or not is_configured():
            return Response({'detail': 'CV not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            url = signed_url(_bucket(), obj.cv_path)
            return Response({'url': url, 'name': obj.cv_name})
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def destroy(self, request, *args, **kwargs):
        """Permanent delete — admin/superuser only."""
        if not (request.user.is_superuser or _role(request.user) == 'ADMIN'):
            return Response({'detail': 'Hanya admin yang dapat menghapus kandidat.'}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        name = obj.full_name
        obj.delete()
        log_event(request, 'delete', obj=None, description=f'Candidate "{name}" deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        return self.destroy(request, pk=pk)