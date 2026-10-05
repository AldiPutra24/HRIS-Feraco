from decimal import Decimal, InvalidOperation

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
from .permissions import (
    FINAL_APPROVER_ROLES,
    REIMBURSEMENT_ADMIN_ROLES,
    REVIEW_ROLES,
    ReimbursementPermission,
    _employee_for,
)
from .serializers import ReimbursementCategorySerializer, ReimbursementSerializer
from .services import notify


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB — keep uploads under gunicorn timeout
# Bukti Payment/Tagihan/Invoice: max 5 MB (payment proof keeps the 10 MB limit).
ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
# Bukti Payment/Tagihan/Invoice: PDF or image. Extension, content type and
# file signature (magic bytes) must all match the same format.
_GENERIC_TYPES = {'application/octet-stream', ''}
ATTACHMENT_FORMATS = {
    'pdf': {
        'extensions': ('.pdf',),
        'content_types': {'application/pdf', 'application/x-pdf'},
        'magic': lambda b: b[:5] == b'%PDF-',
    },
    'jpeg': {
        'extensions': ('.jpg', '.jpeg'),
        'content_types': {'image/jpeg', 'image/pjpeg'},
        'magic': lambda b: b[:3] == b'\xff\xd8\xff',
    },
    'png': {
        'extensions': ('.png',),
        'content_types': {'image/png'},
        'magic': lambda b: b[:8] == b'\x89PNG\r\n\x1a\n',
    },
    'webp': {
        'extensions': ('.webp',),
        'content_types': {'image/webp'},
        'magic': lambda b: b[:4] == b'RIFF' and b[8:12] == b'WEBP',
    },
}


def _is_allowed_attachment(name, content_type, data):
    name = (name or '').lower()
    content_type = (content_type or '').lower()
    for spec in ATTACHMENT_FORMATS.values():
        if (
            name.endswith(spec['extensions'])
            and (content_type in spec['content_types'] or content_type in _GENERIC_TYPES)
            and spec['magic'](data)
        ):
            return True
    return False
# Fields an employee must fill before a reimbursement can be submitted.
SUBMIT_REQUIRED = (
    ('bank_name', 'Nama Bank'),
    ('bank_account_name', 'Nama Pemilik Rekening'),
    ('bank_account_number', 'Nomor Rekening'),
    ('contact_email', 'Email'),
)
EDITABLE_STATUSES = ('DRAFT', 'PENDING')


def _notify(name, obj):
    """Centralized notification hook (best-effort, never raises)."""
    from apps.notifications import services as notif

    getattr(notif, name)(obj)


def _bucket():
    return settings.REIMBURSEMENT_STORAGE_BUCKET


def _upload_path(obj, kind, filename):
    prefix = 'attachments' if kind == 'attachment' else 'payment-proofs'
    return f'reimbursements/{obj.id}/{prefix}/{filename}'


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
        if role == 'MANAGEMENT':
            # Self-service: Management sees only their OWN reimbursements.
            if employee is None:
                return qs.none()
            return qs.filter(employee_id=employee.id)
        if employee is None:
            return qs.none()
        return qs.filter(employee_id=employee.id)

    def _block_management_write(self):
        """Management must stay within their own reimbursement flow: they may
        create/edit/submit/cancel their OWN drafts, but never touch another
        user's reimbursement and never approve/reject/mark paid."""
        return

    def perform_create(self, serializer):
        self._block_management_write()
        employee = _employee_for(self.request.user)
        if employee is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'Akun tidak terhubung ke data karyawan.'})
        obj = serializer.save(employee=employee)
        log_event(self.request, 'create', obj=obj, description=f'Reimbursement {obj.id} draft created')

    def update(self, request, *args, **kwargs):
        """Owner edits only while DRAFT/PENDING (before HR Staff review).
        HR never edits through PATCH — review/approve actions only."""
        obj = self.get_object()
        employee = _employee_for(request.user)
        if employee is None or obj.employee_id != employee.id:
            return Response(
                {'detail': 'Hanya pemilik pengajuan yang dapat mengubah data. HR memakai aksi review/approve.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if obj.status not in EDITABLE_STATUSES:
            return Response(
                {'detail': 'Pengajuan tidak dapat diubah setelah direview HR Staff.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._block_management_write()
        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Hanya ADMIN yang dapat menghapus data reimbursement.'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # Best-effort cleanup of stored binaries; DB row is the source of truth.
        from apps.personnel.storage import delete_object
        for path in (instance.attachment_path, instance.payment_proof_path):
            if path:
                try:
                    delete_object(_bucket(), path)
                except Exception:
                    pass
        log_event(self.request, 'delete', obj=instance, description=f'Reimbursement {instance.id} deleted')
        instance.delete()

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        self._block_management_write()
        obj = self._load(request, pk)
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id != employee.id and _role(request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        if obj.status != 'DRAFT':
            return Response({'detail': 'Hanya pengajuan DRAFT yang dapat dikirim.'}, status=status.HTTP_400_BAD_REQUEST)
        # Bukti Payment/Tagihan/Invoice (PDF/gambar) wajib untuk SEMUA pengajuan.
        if not obj.attachment_path:
            return Response(
                {'attachment': 'Bukti Payment/Tagihan/Invoice wajib diunggah sebelum pengajuan dikirim.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        missing = {f: f'{label} wajib diisi.' for f, label in SUBMIT_REQUIRED if not (getattr(obj, f) or '').strip()}
        if missing:
            return Response(missing, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'PENDING'
        obj.submitted_at = timezone.now()
        obj.save(update_fields=['status', 'submitted_at', 'updated_at'])
        for recipient in self._hr_users():
            notify(recipient, obj, f'Pengajuan reimbursement {obj.employee.full_name} ({obj.category.name}) menunggu persetujuan.')
        # Stage 1 -> HR Staff review (bell + HR email, idempotent).
        _notify('notify_reimbursement_submitted', obj)
        log_event(request, 'update', obj=obj, description=f'Reimbursement {obj.id} submitted')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    def _self_block(self, request, obj, verb):
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id == employee.id:
            return Response({'detail': f'Tidak dapat {verb} pengajuan sendiri.'}, status=status.HTTP_400_BAD_REQUEST)
        return None

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """Layer 1 — HR Staff sets Nominal Disetujui -> WAITING_HR_LEAD."""
        obj = self._load(request, pk)
        if _role(request.user) not in REVIEW_ROLES:
            return Response({'detail': 'Hanya HR Staff yang menetapkan nominal disetujui.'}, status=status.HTTP_403_FORBIDDEN)
        blocked = self._self_block(request, obj, 'mereview')
        if blocked:
            return blocked
        approved_amount = request.data.get('approved_amount')
        if approved_amount in (None, ''):
            return Response({'approved_amount': 'Nominal disetujui wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            approved_amount = Decimal(str(approved_amount))
        except (InvalidOperation, TypeError, ValueError):
            return Response({'approved_amount': 'Nominal disetujui tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        if approved_amount < 0:
            return Response({'approved_amount': 'Nominal disetujui tidak boleh negatif.'}, status=status.HTTP_400_BAD_REQUEST)
        if approved_amount > obj.amount:
            return Response({'approved_amount': 'Nominal disetujui tidak boleh melebihi nominal diajukan.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            obj = Reimbursement.objects.select_for_update().select_related('employee', 'category').get(pk=obj.pk)
            if obj.status != 'PENDING':
                return Response({'detail': 'Hanya pengajuan PENDING HR Staff yang dapat direview.'}, status=status.HTTP_400_BAD_REQUEST)
            prev_approved = str(obj.approved_amount) if obj.approved_amount is not None else None
            obj.approved_amount = approved_amount
            obj.amount_set_by = request.user
            obj.amount_set_at = timezone.now()
            obj.status = 'WAITING_HR_LEAD'
            obj.save(update_fields=['approved_amount', 'amount_set_by', 'amount_set_at', 'status', 'updated_at'])
        # Stage 2 -> HR Lead final approval (bell, idempotent).
        _notify('notify_reimbursement_reviewed', obj)
        log_event(
            request, 'update', obj=obj,
            description=f'Reimbursement {obj.id} reviewed: nominal disetujui ditetapkan',
            changes_before={'approved_amount': prev_approved, 'status': 'PENDING'},
            changes_after={'approved_amount': str(approved_amount), 'status': 'WAITING_HR_LEAD'},
        )
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Layer 2 — HR Lead approves payment of the amount set by HR Staff."""
        self._block_management_write()
        obj = self._load(request, pk)
        if _role(request.user) not in FINAL_APPROVER_ROLES:
            return Response({'detail': 'Hanya HR Lead yang dapat menyetujui pembayaran.'}, status=status.HTTP_403_FORBIDDEN)
        blocked = self._self_block(request, obj, 'menyetujui')
        if blocked:
            return blocked
        if 'approved_amount' in request.data:
            return Response(
                {'approved_amount': 'HR Lead tidak dapat mengubah nominal. Tolak pengajuan bila nominal perlu dikoreksi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            obj = Reimbursement.objects.select_for_update().select_related('employee', 'category').get(pk=obj.pk)
            if obj.status != 'WAITING_HR_LEAD':
                return Response(
                    {'detail': 'Hanya pengajuan yang sudah direview HR Staff (Waiting HR Lead) yang dapat disetujui.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            obj.status = 'APPROVED'
            obj.approved_at = timezone.now()
            obj.reviewer = request.user
            obj.save(update_fields=['status', 'approved_at', 'reviewer', 'updated_at'])
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda disetujui.')
        _notify('notify_reimbursement_approved', obj)
        log_event(
            request, 'approve', obj=obj,
            description=f'Reimbursement {obj.id} payment approved by HR Lead',
            changes_before={'status': 'WAITING_HR_LEAD'},
            changes_after={'status': 'APPROVED', 'approved_amount': str(obj.approved_amount)},
        )
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """HR Staff rejects at review (PENDING); HR Lead rejects at final
        approval (WAITING_HR_LEAD). Admin may act on either layer."""
        self._block_management_write()
        obj = self._load(request, pk)
        role = _role(request.user)
        if role not in REVIEW_ROLES | FINAL_APPROVER_ROLES:
            return Response({'detail': 'Anda tidak berwenang menolak.'}, status=status.HTTP_403_FORBIDDEN)
        blocked = self._self_block(request, obj, 'menolak')
        if blocked:
            return blocked
        reason = (request.data.get('rejection_reason') or '').strip()
        with transaction.atomic():
            obj = Reimbursement.objects.select_for_update().select_related('employee', 'category').get(pk=obj.pk)
            allowed = (obj.status == 'PENDING' and role in REVIEW_ROLES) or (
                obj.status == 'WAITING_HR_LEAD' and role in FINAL_APPROVER_ROLES
            )
            if obj.status not in ('PENDING', 'WAITING_HR_LEAD'):
                return Response({'detail': 'Hanya pengajuan yang sedang diproses yang dapat ditolak.'}, status=status.HTTP_400_BAD_REQUEST)
            if not allowed:
                return Response(
                    {'detail': 'Tahap ini bukan wewenang Anda (PENDING: HR Staff, Waiting HR Lead: HR Lead).'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not reason:
                return Response({'rejection_reason': 'Alasan penolakan wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
            prev_status = obj.status
            obj.status = 'REJECTED'
            obj.rejected_at = timezone.now()
            obj.reviewer = request.user
            obj.rejection_reason = reason
            obj.save(update_fields=['status', 'rejected_at', 'reviewer', 'rejection_reason', 'updated_at'])
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda ditolak.')
        _notify('notify_reimbursement_rejected', obj)
        log_event(
            request, 'reject', obj=obj, description=f'Reimbursement {obj.id} rejected at {prev_status}',
            changes_before={'status': prev_status}, changes_after={'status': 'REJECTED'},
        )
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def mark_paid(self, request, pk=None):
        self._block_management_write()
        obj = self._load(request, pk)
        role = _role(request.user)
        if role not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Anda tidak berwenang menandai dibayar.'}, status=status.HTTP_403_FORBIDDEN)
        if obj.status != 'APPROVED':
            return Response({'detail': 'Hanya pengajuan APPROVED yang dapat ditandai dibayar.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = (request.data.get('payment_reference') or '').strip()
        upload = request.FILES.get('file')
        obj.status = 'PAID'
        obj.paid_at = timezone.now()
        obj.payment_reference = reference
        if upload is not None:
            if not is_configured():
                return Response({'file': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            if upload.size > MAX_UPLOAD_BYTES:
                return Response({'file': f'File melebihi batas {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.'}, status=status.HTTP_400_BAD_REQUEST)
            path = _upload_path(obj, 'payment_proof', upload.name)
            try:
                upload_bytes(_bucket(), path, upload.read(), content_type=upload.content_type or 'application/octet-stream')
            except Exception as e:
                return Response({'file': f'Upload gagal: {str(e)[:120]}'}, status=status.HTTP_502_BAD_GATEWAY)
            obj.payment_proof_name = upload.name
            obj.payment_proof_path = path
            obj.payment_proof_content_type = upload.content_type or ''
        update_fields = ['status', 'paid_at', 'payment_reference', 'updated_at']
        if upload is not None:
            update_fields += ['payment_proof_name', 'payment_proof_path', 'payment_proof_content_type']
        obj.save(update_fields=update_fields)
        notify(getattr(obj.employee, 'user', None), obj, f'Reimbursement {obj.category.name} Anda telah dibayar.')
        # Transfer confirmation to the email given on the request (best-effort).
        _notify('notify_reimbursement_paid', obj)
        log_event(request, 'paid', obj=obj, description=f'Reimbursement {obj.id} marked paid')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        self._block_management_write()
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
            self._block_management_write()
        if request.method == 'POST':
            return self._upload_file(request, obj, 'file', 'attachment')
        return self._download_file(request, obj, 'attachment')

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser], url_path='payment_proof')
    def payment_proof(self, request, pk=None):
        obj = self._load(request, pk)
        if request.method == 'POST':
            self._block_management_write()
        if request.method == 'POST':
            return self._upload_file(request, obj, 'file', 'payment_proof')
        return self._download_file(request, obj, 'payment_proof')

    def _upload_file(self, request, obj, field, kind):
        """Upload attachment/payment_proof bytes to storage. kind in ('attachment','payment_proof')."""
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id != employee.id and _role(request.user) not in REIMBURSEMENT_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        if kind == 'attachment' and obj.status not in ('DRAFT', 'PENDING'):
            return Response({'detail': 'Lampiran hanya dapat diubah saat DRAFT atau PENDING.'}, status=status.HTTP_400_BAD_REQUEST)
        if kind == 'payment_proof' and obj.status != 'PAID':
            return Response({'detail': 'Bukti transfer hanya dapat diunggah untuk pengajuan PAID.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'file': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        upload = request.FILES.get(field)
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        limit = ATTACHMENT_MAX_BYTES if kind == 'attachment' else MAX_UPLOAD_BYTES
        if upload.size > limit:
            label = 'Bukti Payment/Tagihan/Invoice' if kind == 'attachment' else 'File'
            return Response(
                {'file': f'{label} melebihi batas {limit // (1024 * 1024)} MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        data = upload.read()
        if kind == 'attachment':
            # Bukti Payment/Tagihan/Invoice: PDF or image (JPG/PNG/WEBP).
            if not _is_allowed_attachment(upload.name, upload.content_type, data):
                return Response(
                    {'file': 'Bukti Payment/Tagihan/Invoice harus berupa file PDF atau gambar (JPG, PNG, WEBP).'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        path = _upload_path(obj, kind, upload.name)
        try:
            upload_bytes(_bucket(), path, data, content_type=upload.content_type or 'application/octet-stream')
        except Exception as e:
            return Response({'file': f'Upload gagal: {str(e)[:120]}'}, status=status.HTTP_502_BAD_GATEWAY)
        name_field = f'{kind}_name'
        path_field = f'{kind}_path'
        ctype_field = f'{kind}_content_type'
        setattr(obj, name_field, upload.name)
        setattr(obj, path_field, path)
        setattr(obj, ctype_field, upload.content_type or '')
        obj.save(update_fields=[name_field, path_field, ctype_field, 'updated_at'])
        log_event(request, 'upload', obj=obj, description=f'Reimbursement {obj.id} {kind} uploaded')
        return Response(ReimbursementSerializer(obj, context={'request': request}).data)

    def _download_file(self, request, obj, kind):
        path_field = f'{kind}_path'
        name_field = f'{kind}_name'
        if not getattr(obj, path_field):
            return Response({'detail': 'Tidak ada ' + ('lampiran' if kind == 'attachment' else 'bukti transfer') + '.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        from django.shortcuts import redirect
        log_event(request, 'download', obj=obj, description=f'Reimbursement {obj.id} {name_field} downloaded')
        return redirect(signed_url(_bucket(), getattr(obj, path_field)))

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Live status counts from the same scoped queryset as the list.

        `?mine=1` limits to the caller's own employee record (Employee
        Overview / self-service pages), so KPI cards never depend on a
        single paginated page or on client-side filtering.
        """
        from django.db.models import Count, DecimalField, Sum
        from django.db.models.functions import Coalesce

        qs = self.get_queryset()
        if request.query_params.get('mine') in ('1', 'true'):
            employee = _employee_for(request.user)
            qs = qs.filter(employee_id=employee.id) if employee is not None else qs.none()
        counts = {key: 0 for key, _ in Reimbursement.STATUS_CHOICES}
        for row in qs.values('status').annotate(n=Count('id')):
            counts[row['status']] = row['n']
        paid = qs.filter(status='PAID').aggregate(
            total=Coalesce(Sum(Coalesce('approved_amount', 'amount')), 0, output_field=DecimalField())
        )['total']
        return Response({'counts': counts, 'total': sum(counts.values()), 'paid_amount': paid})

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
