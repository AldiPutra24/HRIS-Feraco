from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.personnel.models import Employee

from decimal import Decimal

from .models import LeaveBalance, LeaveQuotaAdjustment, LeaveRequest, LeaveRequestDate, LeaveType
from .permissions import _employee_for
from .services import (
    HALF_DAY,
    compute_total_days,
    format_days,
    format_leave_dates,
    get_balance,
    is_discontinued_leave_type,
    supports_half_day,
    tracks_quota,
)


def _today():
    """Indirection so tests can pin 'today' for the no-backdate rule."""
    return timezone.localdate()


def _days_field(**kwargs):
    # JSON numbers (not strings) so existing frontend arithmetic keeps working.
    return serializers.DecimalField(max_digits=6, decimal_places=1, coerce_to_string=False, **kwargs)

STATUS_CHOICES = set(dict(LeaveRequest.STATUS_CHOICES).keys())


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = (
            'id', 'name', 'code', 'kind', 'is_active', 'default_quota',
            'max_days_per_request', 'min_tenure_months', 'max_days_without_attachment',
            'carry_forward_max', 'deducts_from', 'is_paid',
            'requires_attachment', 'description',
        )
        read_only_fields = ('id',)

    def validate_code(self, value):
        value = (value or '').strip().upper()
        if not value:
            raise serializers.ValidationError('Kode wajib diisi.')
        return value


class LeaveBalanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    allocated_days = _days_field(required=False)
    adjustment_days = _days_field(read_only=True)
    used_days = _days_field(read_only=True)
    remaining_days = _days_field(read_only=True)

    class Meta:
        model = LeaveBalance
        fields = (
            'id', 'employee', 'employee_name', 'leave_type', 'leave_type_name', 'year',
            'allocated_days', 'adjustment_days', 'used_days', 'remaining_days',
        )
        read_only_fields = ('id', 'adjustment_days', 'used_days', 'remaining_days', 'employee_name', 'leave_type_name')

    def validate(self, attrs):
        allocated = attrs.get('allocated_days', getattr(self.instance, 'allocated_days', Decimal('0')))
        adjustment = getattr(self.instance, 'adjustment_days', Decimal('0'))
        used = getattr(self.instance, 'used_days', Decimal('0'))
        attrs['remaining_days'] = allocated + adjustment - used
        return attrs


class LeaveQuotaAdjustmentSerializer(serializers.ModelSerializer):
    """HR manual quota adjustment (+/-, step 0.5) with mandatory reason."""

    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    amount = _days_field()
    reason = serializers.CharField(
        allow_blank=False,
        error_messages={'blank': 'Alasan adjustment wajib diisi.', 'required': 'Alasan adjustment wajib diisi.'},
    )

    class Meta:
        model = LeaveQuotaAdjustment
        fields = (
            'id', 'employee', 'employee_name', 'leave_type', 'leave_type_name', 'year',
            'amount', 'reason', 'created_by_name', 'created_at',
        )
        read_only_fields = ('id', 'employee_name', 'leave_type_name', 'created_by_name', 'created_at')

    def get_created_by_name(self, obj):
        user = obj.created_by
        if user is None:
            return None
        personnel = getattr(user, 'personnel', None)
        return getattr(personnel, 'full_name', '') or user.get_full_name() or user.get_username()

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError('Adjustment tidak boleh 0.')
        if (value * 2) != (value * 2).to_integral_value():
            raise serializers.ValidationError('Adjustment harus kelipatan 0,5 hari.')
        if abs(value) > 365:
            raise serializers.ValidationError('Adjustment terlalu besar.')
        return value

    def validate_year(self, value):
        if not 2000 <= value <= 2100:
            raise serializers.ValidationError('Tahun tidak valid.')
        return value

    def validate_reason(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Alasan adjustment wajib diisi.')
        return value

    def validate_leave_type(self, value):
        if not tracks_quota(value):
            raise serializers.ValidationError(f'Kategori "{value.name}" tidak memakai kuota.')
        return value


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_manager_name = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source='leave_type.name', read_only=True)
    leave_type_kind = serializers.CharField(source='leave_type.kind', read_only=True)
    approver_name = serializers.CharField(source='approver.username', read_only=True)
    attachment_url = serializers.SerializerMethodField()
    # Individually picked days (e.g. 01, 02, 05 Sep). Optional: legacy clients
    # may still send start_date/end_date (inclusive range).
    dates = serializers.ListField(child=serializers.DateField(), write_only=True, required=False, allow_empty=False)
    # Subset of `dates` taken as Half Day (0.5) — Cuti Tahunan only.
    half_days = serializers.ListField(child=serializers.DateField(), write_only=True, required=False)
    total_days = _days_field(read_only=True)
    leave_dates = serializers.SerializerMethodField()
    leave_days = serializers.SerializerMethodField()
    leave_dates_display = serializers.SerializerMethodField()
    # Model allows blank; enforce required at API level (no migration needed).
    reason = serializers.CharField(
        required=True,
        allow_blank=False,
        error_messages={
            'required': 'Alasan pengajuan wajib diisi.',
            'blank': 'Alasan pengajuan wajib diisi.',
        },
    )

    class Meta:
        model = LeaveRequest
        fields = (
            'id', 'employee', 'employee_name', 'employee_manager_name', 'leave_type', 'leave_type_name', 'leave_type_kind',
            'start_date', 'end_date', 'dates', 'half_days', 'leave_dates', 'leave_days', 'leave_dates_display',
            'total_days', 'reason', 'attachment_name',
            'attachment_url', 'status', 'submitted_at', 'approved_at', 'rejected_at',
            'approver', 'approver_name', 'rejection_reason', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'employee', 'total_days', 'status', 'submitted_at', 'approved_at',
            'rejected_at', 'approver', 'created_at', 'updated_at', 'employee_name',
            'leave_type_name', 'leave_type_kind', 'approver_name', 'attachment_url',
            'leave_dates', 'leave_days', 'leave_dates_display',
        )
        extra_kwargs = {
            # Derived from `dates` when individual days are picked.
            'start_date': {'required': False},
            'end_date': {'required': False},
        }

    def get_leave_dates(self, obj):
        return [d.isoformat() for d in obj.selected_dates()]

    def get_leave_days(self, obj):
        return [{'date': d.isoformat(), 'portion': p} for d, p in obj.selected_days()]

    def get_leave_dates_display(self, obj):
        days = obj.selected_days()
        return format_leave_dates([d for d, _ in days], [d for d, p in days if p == LeaveRequestDate.HALF])

    def get_employee_manager_name(self, obj):
        mgr = getattr(obj.employee, 'manager', None)
        return mgr.full_name if mgr else None

    def get_employee_manager_name(self, obj):
        mgr = getattr(obj.employee, 'manager', None)
        return mgr.full_name if mgr else None

    def get_attachment_url(self, obj):
        if not obj.attachment_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/leaves/requests/{obj.id}/attachment/')

    def validate(self, attrs):
        request = self.context.get('request')
        picked = attrs.pop('dates', None)
        half = attrs.pop('half_days', None) or []
        if self.instance is not None:
            picked, half = None, []  # dates are fixed once submitted
        if picked is not None:
            dupes = sorted({d for d in picked if picked.count(d) > 1})
            if dupes:
                raise serializers.ValidationError(
                    {'dates': f'Tanggal duplikat: {", ".join(d.isoformat() for d in dupes)}.'}
                )
            picked = sorted(picked)
            if len({d.year for d in picked}) > 1:
                raise serializers.ValidationError(
                    {'dates': 'Tanggal cuti dalam satu pengajuan harus berada di tahun yang sama.'}
                )
            if not set(half) <= set(picked):
                raise serializers.ValidationError({'half_days': 'Half Day harus termasuk tanggal yang dipilih.'})
            attrs['start_date'] = picked[0]
            attrs['end_date'] = picked[-1]
            attrs['_dates'] = picked
            attrs['_half'] = sorted(set(half))
        elif self.instance is None and not attrs.get('start_date'):
            raise serializers.ValidationError({'dates': 'Pilih minimal satu tanggal cuti.'})
        elif self.instance is None and not attrs.get('end_date'):
            attrs['end_date'] = attrs['start_date']
        start = attrs.get('start_date')
        end = attrs.get('end_date')
        leave_type = attrs.get('leave_type')
        kind = self.initial_data.get('kind')

        if self.instance is None:
            # No backdate: no leave day before today (today itself allowed).
            today = _today()
            past = sorted(d for d in (picked or []) if d < today)
            if picked is None and start and start < today:
                past = [start]
            if past:
                raise serializers.ValidationError({'dates': (
                    'Tidak dapat mengajukan izin/cuti untuk tanggal sebelum hari ini: '
                    + ', '.join(d.isoformat() for d in past) + '.'
                )})
            if half and leave_type is not None and not supports_half_day(leave_type):
                raise serializers.ValidationError(
                    {'half_days': f'Half Day hanya tersedia untuk Cuti Tahunan, bukan "{leave_type.name}".'}
                )

        # Inactive/discontinued types (e.g. Cuti Tanpa Gaji) never accept new requests.
        if self.instance is None and leave_type is not None and (
            not leave_type.is_active or is_discontinued_leave_type(leave_type)
        ):
            raise serializers.ValidationError(
                {'leave_type': f'Kategori "{leave_type.name}" tidak tersedia untuk pengajuan baru.'}
            )

        # Category kind must match the request's kind (only on create).
        if self.instance is None and kind and leave_type:
            if kind not in ('LEAVE', 'PERMISSION'):
                raise serializers.ValidationError({'kind': 'Jenis tidak valid (LEAVE/PERMISSION).'})
            if leave_type.kind != kind:
                raise serializers.ValidationError(
                    {'kind': f'Kategori "{leave_type.name}" tidak termasuk dalam jenis yang dipilih.'}
                )

        employee = attrs.get('employee')
        if employee is None:
            employee = getattr(self.instance, 'employee', None)
        if employee is None and request is not None:
            employee = _employee_for(request.user)

        # Only on create (status locked after submission).
        if self.instance is None:
            if employee is None:
                raise serializers.ValidationError({'employee': 'Karyawan wajib diisi.'})
            if employee.employment_status != 'ACTIVE':
                raise serializers.ValidationError({'employee': 'Karyawan tidak aktif tidak dapat mengajukan.'})
            if start and end and end < start:
                raise serializers.ValidationError({'end_date': 'Tanggal selesai tidak boleh sebelum tanggal mulai.'})
            if start and leave_type:
                # Total = picked days (Full Day 1, Half Day 0.5), not the start..end span.
                if picked is not None:
                    total = Decimal(len(picked)) - HALF_DAY * len(attrs.get('_half', []))
                else:
                    total = Decimal(compute_total_days(start, end or start))
                attrs['total_days'] = total

                # Tenure eligibility for Cuti Tahunan: day-precision, eligible
                # after exactly 3 months since join_date (policy 2026).
                if leave_type.code == 'ANNUAL' and employee.join_date:
                    from .services import _eligible_date

                    if start < _eligible_date(employee.join_date):
                        eligible = _eligible_date(employee.join_date)
                        raise serializers.ValidationError(
                            {'start_date': (
                                f'Belum memenuhi masa kerja minimal '
                                f'{leave_type.min_tenure_months or 3} bulan untuk {leave_type.name}.'
                                f' Eligible mulai {eligible.isoformat()}.'
                            )}
                        )
                elif leave_type.min_tenure_months and employee.join_date:
                    months = (start.year - employee.join_date.year) * 12 + (start.month - employee.join_date.month)
                    if months < leave_type.min_tenure_months:
                        raise serializers.ValidationError(
                            {'start_date': (
                                f'Belum memenuhi masa kerja minimal '
                                f'{leave_type.min_tenure_months} bulan untuk {leave_type.name}.'
                            )}
                        )

                # Per-request duration cap (e.g. Cuti Tahunan maks 3 hari berturut-turut).
                if leave_type.max_days_per_request and total > leave_type.max_days_per_request:
                    raise serializers.ValidationError(
                        {'end_date': (
                            f'{leave_type.name} maksimal {leave_type.max_days_per_request} hari '
                            f'per permohonan.'
                        )}
                    )

                # Attachment rules: mandatory types OR doctor's note above threshold
                # (e.g. Izin Sakit: 1 hari tanpa surat, >1 hari wajib surat dokter).
                needs_attachment = leave_type.requires_attachment or (
                    leave_type.max_days_without_attachment
                    and total > leave_type.max_days_without_attachment
                )
                if needs_attachment and not self.initial_data.get('attachment_name'):
                    raise serializers.ValidationError(
                        {'attachment_name': 'Lampiran wajib untuk pengajuan ini.'}
                    )

                # Quota check against the type that actually gets deducted
                # (Cuti Berobat deducts from Cuti Tahunan).
                target_type = leave_type.deducts_from or leave_type
                balance = get_balance(employee, target_type, start.year)
                if balance.is_limited and total > balance.remaining_days:
                    raise serializers.ValidationError(
                        {'start_date': (
                            f'Sisa kuota tidak mencukupi ({format_days(balance.remaining_days)} hari tersisa, '
                            f'diajukan {format_days(total)} hari).'
                        )}
                    )
        return attrs

    def create(self, validated_data):
        picked = validated_data.pop('_dates', None)
        half = set(validated_data.pop('_half', []))
        validated_data.setdefault('status', 'PENDING')
        validated_data.setdefault('total_days', compute_total_days(validated_data['start_date'], validated_data['end_date']))
        obj = super().create(validated_data)
        if picked:
            LeaveRequestDate.objects.bulk_create([
                LeaveRequestDate(
                    leave_request=obj, date=d,
                    portion=LeaveRequestDate.HALF if d in half else LeaveRequestDate.FULL,
                )
                for d in picked
            ])
        return obj
