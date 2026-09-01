from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.permissions import SAFE_METHODS

from apps.audit.services import log_event
from apps.personnel.permissions import _role
from apps.personnel.storage import is_configured, signed_url, upload_bytes

from .models import LeaveBalance, LeaveNotification, LeaveRequest, LeaveType
from .permissions import APPROVER_ROLES, LEAVE_ADMIN_ROLES, IsLeaveAdmin, LeaveRequestPermission, _employee_for
from .serializers import LeaveBalanceSerializer, LeaveRequestSerializer, LeaveTypeSerializer
from .services import apply_approval_deduction, get_balance, notify


class LeaveTypeViewSet(viewsets.ModelViewSet):
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsLeaveAdmin]
    search_fields = ['name', 'code']
    filterset_fields = ['is_active', 'kind']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        # Non-HR (submission form) only sees active types; HR manages all.
        if self.request.method in SAFE_METHODS and _role(self.request.user) not in LEAVE_ADMIN_ROLES:
            return qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Leave type {obj.code} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Leave type {obj.code} updated')


class LeaveBalanceViewSet(viewsets.ModelViewSet):
    queryset = LeaveBalance.objects.select_related('employee', 'leave_type').all()
    serializer_class = LeaveBalanceSerializer
    permission_classes = [IsLeaveAdmin]
    filterset_fields = ['employee', 'leave_type', 'year']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        # Non-HR sees only their own balances (self-service).
        if _role(self.request.user) not in LEAVE_ADMIN_ROLES:
            employee = _employee_for(self.request.user)
            if employee is None:
                return qs.none()
            return qs.filter(employee_id=employee.id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Balance {obj.leave_type.code} for {obj.employee_id} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Balance {obj.leave_type.code} for {obj.employee_id} corrected')


class LeaveRequestViewSet(viewsets.ModelViewSet):
    queryset = LeaveRequest.objects.select_related('employee', 'leave_type', 'approver').all()
    serializer_class = LeaveRequestSerializer
    permission_classes = [LeaveRequestPermission]
    filterset_fields = ['status', 'employee', 'leave_type', 'leave_type__kind']
    search_fields = ['employee__full_name', 'reason']

    def get_queryset(self):
        qs = super().get_queryset()
        role = _role(self.request.user)
        employee = _employee_for(self.request.user)
        if role in LEAVE_ADMIN_ROLES:
            return qs
        if employee is None:
            return qs.none()
        if role == 'MANAGEMENT':
            return qs.filter(Q(employee__manager_id=employee.id) | Q(employee_id=employee.id))
        return qs.filter(employee_id=employee.id)

    def perform_create(self, serializer):
        employee = _employee_for(self.request.user)
        if employee is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': 'Akun tidak terhubung ke data karyawan.'})
        request_obj = serializer.save(employee=employee)
        # Notify the employee's manager (in-app).
        manager_employee = employee.manager
        manager_user = getattr(manager_employee, 'user', None)
        notify(
            manager_user,
            request_obj,
            f'Pengajuan {request_obj.leave_type.name} dari {employee.full_name} menunggu persetujuan.',
        )
        log_event(self.request, 'create', obj=request_obj, description=f'Leave request {request_obj.id} submitted')

    def _load_request(self, request, pk):
        obj = self.get_queryset().filter(pk=pk).first()
        if obj is None:
            return None, Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        return obj, None

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        leave, err = self._load_request(request, pk)
        if err:
            return err
        role = _role(request.user)
        if role not in APPROVER_ROLES:
            return Response({'detail': 'Anda tidak berwenang menyetujui.'}, status=status.HTTP_403_FORBIDDEN)
        employee = _employee_for(request.user)
        if employee is not None and leave.employee_id == employee.id:
            return Response({'detail': 'Tidak dapat menyetujui pengajuan sendiri.'}, status=status.HTTP_400_BAD_REQUEST)
        if leave.status != 'PENDING':
            return Response({'detail': 'Hanya pengajuan PENDING yang dapat disetujui.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            leave.status = 'APPROVED'
            leave.approved_at = timezone.now()
            leave.approver = request.user
            leave.save(update_fields=['status', 'approved_at', 'approver', 'updated_at'])
            apply_approval_deduction(leave)
        hr_users = self._hr_users()
        for recipient in hr_users:
            notify(recipient, leave, f'Pengajuan {leave.leave_type.name} {leave.employee.full_name} disetujui.')
        notify(getattr(leave.employee, 'user', None), leave, f'Pengajuan {leave.leave_type.name} Anda disetujui.')
        log_event(request, 'approve', obj=leave, description=f'Leave request {leave.id} approved')
        return Response(LeaveRequestSerializer(leave, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        leave, err = self._load_request(request, pk)
        if err:
            return err
        role = _role(request.user)
        if role not in APPROVER_ROLES:
            return Response({'detail': 'Anda tidak berwenang menolak.'}, status=status.HTTP_403_FORBIDDEN)
        employee = _employee_for(request.user)
        if employee is not None and leave.employee_id == employee.id:
            return Response({'detail': 'Tidak dapat menolak pengajuan sendiri.'}, status=status.HTTP_400_BAD_REQUEST)
        if leave.status != 'PENDING':
            return Response({'detail': 'Hanya pengajuan PENDING yang dapat ditolak.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get('rejection_reason') or '').strip()
        if not reason:
            return Response({'rejection_reason': 'Alasan penolakan wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        leave.status = 'REJECTED'
        leave.rejected_at = timezone.now()
        leave.approver = request.user
        leave.rejection_reason = reason
        leave.save(update_fields=['status', 'rejected_at', 'approver', 'rejection_reason', 'updated_at'])
        for recipient in self._hr_users():
            notify(recipient, leave, f'Pengajuan {leave.leave_type.name} {leave.employee.full_name} ditolak.')
        notify(getattr(leave.employee, 'user', None), leave, f'Pengajuan {leave.leave_type.name} Anda ditolak.')
        log_event(request, 'reject', obj=leave, description=f'Leave request {leave.id} rejected')
        return Response(LeaveRequestSerializer(leave, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        leave, err = self._load_request(request, pk)
        if err:
            return err
        employee = _employee_for(request.user)
        if leave.status not in ('PENDING', 'APPROVED'):
            return Response({'detail': 'Pengajuan ini tidak dapat dibatalkan.'}, status=status.HTTP_400_BAD_REQUEST)
        if leave.status == 'PENDING' and employee is not None and leave.employee_id != employee.id and _role(request.user) not in LEAVE_ADMIN_ROLES:
            return Response({'detail': 'Hanya pemilik yang dapat membatalkan.'}, status=status.HTTP_403_FORBIDDEN)
        leave.status = 'CANCELLED'
        leave.save(update_fields=['status', 'updated_at'])
        log_event(request, 'update', obj=leave, description=f'Leave request {leave.id} cancelled')
        return Response(LeaveRequestSerializer(leave, context={'request': request}).data)

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser], url_path='attachment')
    def attachment(self, request, pk=None):
        leave, err = self._load_request(request, pk)
        if err:
            return err
        if request.method == 'POST':
            return self._upload_attachment(request, leave)
        return self._download_attachment(request, leave)

    def _upload_attachment(self, request, leave):
        employee = _employee_for(request.user)
        if employee is not None and leave.employee_id != employee.id and _role(request.user) not in LEAVE_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'file': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        path = f'leaves/{leave.employee_id}/{leave.id}-{upload.name}'
        upload_bytes('employee-documents', path, upload.read(), content_type=upload.content_type or 'application/octet-stream')
        leave.attachment_name = upload.name
        leave.attachment_path = path
        leave.attachment_content_type = upload.content_type or ''
        leave.save(update_fields=['attachment_name', 'attachment_path', 'attachment_content_type', 'updated_at'])
        log_event(request, 'upload', obj=leave, description=f'Leave request {leave.id} attachment uploaded')
        return Response(LeaveRequestSerializer(leave, context={'request': request}).data)

    def _download_attachment(self, request, leave):
        if not leave.attachment_path:
            return Response({'detail': 'Tidak ada lampiran.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        from django.shortcuts import redirect

        log_event(request, 'download', obj=leave, description=f'Leave request {leave.id} attachment downloaded')
        return redirect(signed_url('employee-documents', leave.attachment_path))

    @action(detail=False, methods=['get'])
    def notifications(self, request):
        qs = LeaveNotification.objects.filter(recipient=request.user)
        data = [
            {
                'id': n.id,
                'leave_request': n.leave_request_id,
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

        return list(User.objects.filter(role__key__in=LEAVE_ADMIN_ROLES))
