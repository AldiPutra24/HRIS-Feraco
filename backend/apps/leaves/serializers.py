from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.personnel.models import Employee

from .models import LeaveBalance, LeaveRequest, LeaveType
from .permissions import _employee_for
from .services import compute_total_days, get_balance

STATUS_CHOICES = set(dict(LeaveRequest.STATUS_CHOICES).keys())


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ('id', 'name', 'code', 'is_active', 'default_quota', 'requires_attachment', 'description')
        read_only_fields = ('id',)

    def validate_code(self, value):
        value = (value or '').strip().upper()
        if not value:
            raise serializers.ValidationError('Kode wajib diisi.')
        return value


class LeaveBalanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)

    class Meta:
        model = LeaveBalance
        fields = ('id', 'employee', 'employee_name', 'leave_type', 'leave_type_name', 'year', 'allocated_days', 'used_days', 'remaining_days')
        read_only_fields = ('id', 'used_days', 'remaining_days', 'employee_name', 'leave_type_name')

    def validate(self, attrs):
        attrs['remaining_days'] = attrs.get('allocated_days', 0) - attrs.get('used_days', 0)
        return attrs


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    approver_name = serializers.CharField(source='approver.username', read_only=True)
    attachment_url = serializers.SerializerMethodField()
    remaining_days = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = (
            'id', 'employee', 'employee_name', 'leave_type', 'leave_type_name',
            'start_date', 'end_date', 'total_days', 'reason', 'attachment_name',
            'attachment_url', 'status', 'submitted_at', 'approved_at', 'rejected_at',
            'approver', 'approver_name', 'rejection_reason', 'created_at', 'updated_at',
            'remaining_days',
        )
        read_only_fields = (
            'id', 'employee', 'total_days', 'status', 'submitted_at', 'approved_at',
            'rejected_at', 'approver', 'created_at', 'updated_at', 'employee_name',
            'leave_type_name', 'approver_name', 'attachment_url', 'remaining_days',
        )

    def get_attachment_url(self, obj):
        if not obj.attachment_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/leaves/requests/{obj.id}/attachment/')

    def get_remaining_days(self, obj):
        balance = get_balance(obj.employee, obj.leave_type, obj.start_date.year)
        return balance.remaining_days if balance else 0

    def validate(self, attrs):
        request = self.context.get('request')
        employee = attrs.get('employee')
        if employee is None:
            employee = getattr(self.instance, 'employee', None)
        if employee is None and request is not None:
            employee = _employee_for(request.user)
        start = attrs.get('start_date')
        end = attrs.get('end_date')
        leave_type = attrs.get('leave_type')

        # Only on create (status locked after submission).
        if self.instance is None:
            if employee is None:
                raise serializers.ValidationError({'employee': 'Karyawan wajib diisi.'})
            if employee.employment_status != 'ACTIVE':
                raise serializers.ValidationError({'employee': 'Karyawan tidak aktif tidak dapat mengajukan.'})
            if start and end and end < start:
                raise serializers.ValidationError({'end_date': 'Tanggal selesai tidak boleh sebelum tanggal mulai.'})
            if start and leave_type:
                total = compute_total_days(start, end or start)
                attrs['total_days'] = total
                if leave_type.requires_attachment and not self.initial_data.get('attachment_name'):
                    raise serializers.ValidationError({'attachment_name': 'Lampiran wajib untuk jenis cuti ini.'})
                # Quota check only for quota-bearing types.
                balance = get_balance(employee, leave_type, start.year)
                if balance.allocated_days > 0 and total > balance.remaining_days:
                    raise serializers.ValidationError(
                        {'start_date': f'Sisa kuota tidak mencukupi ({balance.remaining_days} hari tersisa).'}
                    )
        return attrs

    def create(self, validated_data):
        validated_data.setdefault('status', 'PENDING')
        validated_data.setdefault('total_days', compute_total_days(validated_data['start_date'], validated_data['end_date']))
        return super().create(validated_data)
