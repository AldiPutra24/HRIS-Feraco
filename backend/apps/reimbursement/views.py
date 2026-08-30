from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.permissions import _role
from apps.personnel.storage import is_configured, signed_url, upload_bytes

from .models import Reimbursement, ReimbursementCategory, ReimbursementNotification
from .permissions import REIMBURSEMENT_ADMIN_ROLES, ReimbursementPermission, _employee_for
from .serializers import ReimbursementCategorySerializer, ReimbursementSerializer
from .services import notify


def _bucket():
    return settings.REIMBURSEMENT_STORAGE_BUCKET


class ReimbursementCategoryViewSet(viewsets.ModelViewSet):
    queryset = ReimbursementCategory.objects.all()
    serializer_class = ReimbursementCategorySerializer
    permission_classes = [ReimbursementPermission]
    filterset_fields = ['is_active']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if _role(self.request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Reimbursement category {obj.code} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Reimbursement category {obj.code} updated')


class ReimbursementViewSet(viewsets.ModelViewSet):
    queryset = Reimbursement.objects.select_related('employee', 'category', 'reviewer').all()
    serializer_class = ReimbursementSerializer
    permission_classes = [ReimbursementPermission]
    filterset_fields = ['status', 'employee', 'category']
    search_fields = ['employee__full_name', 'description', 'payment_reference']

    def get_queryset(self):
        qs = super().get_queryset()
        role = _role(self.request.user)
        employee = _employee_for(self.request.user)
        if role in REIMBURSEMENT_ADMIN_ROLES:
            return qs
        if employee is None:
            return qs.none()
        return qs.filter(employee_id=employee.id)

    def perform_create(self, serializer):
        employee = _employee_for(self.request.user)
        if employee is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'Akun tidak terhubung ke data karyawan.'})
        obj = serializer.save(employee=employee)
        log_event(self.request, 'create', obj=obj, description=f'Reimbursement {obj.id} draft created')

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        obj = self._load(request, pk)
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id != employee.id and _role(request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        if obj.status != 'DRAFT':
            return Response({'detail': 'Hanya pengajuan DRAFT yang dapat dikirim.'}, status=status.HTTP_400_BAD_REQUEST)
        if obj.category.requires_attachment and not obj.attachment_path:
            return Response({'detail': 'Lampiran wajib untuk kategori ini.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'PENDING'
        obj.submitted_at = timezone.now()
        obj.save(update_fields=['status', 'submitted_at', 'updated_at'])
        for recipient in self._hr_users():
            notify(recipient, obj, f'Pengajuan reimbursement {obj.employee.full_name} ({obj.category.name}) menunggu persetujuan.')
        log_event(request, 'update', obj=obj, description=f'Reimbursement {obj.id} submitted')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        obj = self._load(request, pk)
        role = _role(request.user)
        if role not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Anda tidak berwenang menyetujui.'}, status=status.HTTP_403_FORBIDDEN)
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id == employee.id:
            return Response({'detail': 'Tidak dapat menyetujui pengajuan sendiri.'}, status=status.HTTP_400_BAD_REQUEST)
        if obj.status != 'PENDING':
            return Response({'detail': 'Hanya pengajuan PENDING yang dapat disetujui.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            obj.status = 'APPROVED'
            obj.approved_at = timezone.now()
            obj.reviewer = request.user
            obj.save(update_fields=['status', 'approved_at', 'reviewer', 'updated_at'])
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda disetujui.')
        log_event(request, 'approve', obj=obj, description=f'Reimbursement {obj.id} approved')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        obj = self._load(request, pk)
        role = _role(request.user)
        if role not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Anda tidak berwenang menolak.'}, status=status.HTTP_403_FORBIDDEN)
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id == employee.id:
            return Response({'detail': 'Tidak dapat menolak pengajuan sendiri.'}, status=status.HTTP_400_BAD_REQUEST)
        if obj.status != 'PENDING':
            return Response({'detail': 'Hanya pengajuan PENDING yang dapat ditolak.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get('rejection_reason') or '').strip()
        if not reason:
            return Response({'rejection_reason': 'Alasan penolakan wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'REJECTED'
        obj.rejected_at = timezone.now()
        obj.reviewer = request.user
        obj.rejection_reason = reason
        obj.save(update_fields=['status', 'rejected_at', 'reviewer', 'rejection_reason', 'updated_at'])
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda ditolak.')
        log_event(request, 'reject', obj=obj, description=f'Reimbursement {obj.id} rejected')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def mark_paid(self, request, pk=None):
        obj = self._load(request, pk)
        role = _role(request.user)
        if role not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Anda tidak berwenang menandai dibayar.'}, status=status.HTTP_403_FORBIDDEN)
        if obj.status != 'APPROVED':
            return Response({'detail': 'Hanya pengajuan APPROVED yang dapat ditandai dibayar.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = (request.data.get('payment_reference') or '').strip()
        obj.status = 'PAID'
        obj.paid_at = timezone.now()
        obj.payment_reference = reference
        obj.save(update_fields=['status', 'paid_at', 'payment_reference', 'updated_at'])
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda telah dibayar.')
        log_event(request, 'paid', obj=obj, description=f'Reimbursement {obj.id} marked paid')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        obj = self._load(request, pk)
        employee = _employee_for(request.user)
        if obj.status != 'DRAFT':
            return Response({'detail': 'Hanya pengajuan DRAFT yang dapat dibatalkan.'}, status=status.HTTP_400_BAD_REQUEST)
        if employee is not None and obj.employee_id != employee.id and _role(request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        obj.status = 'CANCELLED'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'update', obj=obj, description=f'Reimbursement {obj.id} cancelled')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    def _load(self, request, pk):
        from django.http import Http404

        obj = self.get_queryset().filter(pk=pk).first()
        if obj is None:
            raise Http404
        return obj

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser], url_path='attachment')
    def attachment(self, request, pk=None):
        obj = self._load(request, pk)
        if request.method == 'POST':
            return self._upload_attachment(request, obj)
        return self._download_attachment(request, obj)

    def _upload_attachment(self, request, obj):
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id != employee.id and _role(request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        if obj.status not in ('DRAFT', 'PENDING'):
            return Response({'detail': 'Lampiran hanya dapat diubah saat DRAFT atau PENDING.'}, status=status.HTTP_400_BAD_REQUEST)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'file': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        path = f'reimbursements/{obj.employee_id}/{obj.id}-{upload.name}'
        upload_bytes(_bucket(), path, upload.read(), content_type=upload.content_type or 'application/octet-stream')
        obj.attachment_name = upload.name
        obj.attachment_path = path
        obj.attachment_content_type = upload.content_type or ''
        obj.save(update_fields=['attachment_name', 'attachment_path', 'attachment_content_type', 'updated_at'])
        log_event(request, 'upload', obj=obj, description=f'Reimbursement {obj.id} attachment uploaded')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    def _download_attachment(self, request, obj):
        if not obj.attachment_path:
            return Response({'detail': 'Tidak ada lampiran.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        from django.shortcuts import redirect
        log_event(request, 'download', obj=obj, description=f'Reimbursement {obj.id} attachment downloaded')
        return redirect(signed_url(_bucket(), obj.attachment_path))

    @action(detail=False, methods=['get'])
    def notifications(self, request):
        qs = ReimbursementNotification.objects.filter(recipient=request.user)
        data = [
            {
                'id': n.id,
                'reimbursement': n.reimbursement_id,
                'message': n.message,
                'is_read': n.is_read,
                'created_at': n.created_at,
            }
            for n in qs[:50]
        ]
        return Response(data)

    @staticmethod
    def _hr_users():
        from apps.accounts.models import User
        return list(User.objects.filter(role__key__in=REIMBURSEMENT_ADMIN_ROLES))
