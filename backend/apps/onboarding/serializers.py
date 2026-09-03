from django.utils import timezone
from rest_framework import serializers

from .models import (
    Onboarding,
    OnboardingChecklistItem,
    OnboardingData,
    OnboardingDocument,
    OnboardingStatusHistory,
)


class OnboardingStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingStatusHistory
        fields = ('id', 'from_status', 'to_status', 'changed_by_name', 'changed_at', 'note')

    def get_changed_by_name(self, obj):
        return obj.changed_by.get_username() if obj.changed_by_id else None


PRIVILEGED_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}


def _mask(value, visible):
    if not value:
        return ''
    if visible:
        return value
    if len(value) <= 4:
        return '****'
    return value[:2] + '*' * (len(value) - 6) + value[-4:]


class OnboardingDataSerializer(serializers.ModelSerializer):
    """Writable serializer (plain sensitive fields)."""

    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    reporting_to_name = serializers.CharField(source='reporting_to.full_name', read_only=True)

    class Meta:
        model = OnboardingData
        fields = (
            'id',
            'full_name', 'nik', 'birth_place', 'birth_date', 'address',
            'phone', 'personal_email', 'emergency_contact_name',
            'emergency_contact_phone',
            'bank_account_number', 'bank_account_name', 'npwp',
            'bpjs_kesehatan', 'bpjs_ketenagakerjaan',
            'department', 'department_name', 'position', 'position_name',
            'reporting_to', 'reporting_to_name', 'join_date', 'employment_type',
            'probation_enabled', 'probation_start_date', 'probation_end_date',
            'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'department_name', 'position_name', 'reporting_to_name',
            'created_at', 'updated_at',
        )
        extra_kwargs = {
            'full_name': {'required': False},
            'nik': {'required': False},
            'birth_place': {'required': False},
            'birth_date': {'required': False},
            'address': {'required': False},
            'phone': {'required': False},
            'personal_email': {'required': False},
            'emergency_contact_name': {'required': False},
            'emergency_contact_phone': {'required': False},
            'bank_account_number': {'required': False},
            'bank_account_name': {'required': False},
            'npwp': {'required': False},
            'bpjs_kesehatan': {'required': False},
            'bpjs_ketenagakerjaan': {'required': False},
            'department': {'required': False},
            'position': {'required': False},
            'reporting_to': {'required': False},
            'join_date': {'required': False},
            'employment_type': {'required': False},
            'probation_enabled': {'required': False},
            'probation_start_date': {'required': False},
            'probation_end_date': {'required': False},
        }

    def validate_nik(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError('NIK harus berupa angka.')
        return value

    def validate_department(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError('Department tidak aktif, pilih department lain.')
        return value

    def validate_position(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError('Position tidak aktif, pilih position lain.')
        return value

    def validate(self, attrs):
        instance = self.instance

        position = attrs.get('position')
        department = attrs.get('department')
        if position is not None:
            if department is None and instance is not None:
                department = instance.department
            if department is None or position.department_id != department.id:
                raise serializers.ValidationError(
                    {'position': 'Position tidak termasuk dalam department yang dipilih.'}
                )

        employment_type = attrs.get(
            'employment_type', instance.employment_type if instance else None
        )
        join_date = attrs.get('join_date')
        if join_date is None and instance is not None:
            join_date = instance.join_date

        prob_enabled = attrs.get(
            'probation_enabled', instance.probation_enabled if instance else False
        )
        prob_start = attrs.get(
            'probation_start_date', instance.probation_start_date if instance else None
        )
        prob_end = attrs.get(
            'probation_end_date', instance.probation_end_date if instance else None
        )

        # Probation only allowed for PKWTT.
        if employment_type == 'PKWT' and (prob_enabled or prob_start or prob_end):
            raise serializers.ValidationError(
                {'probation_enabled': 'Probation hanya berlaku untuk kontrak PKWTT.'}
            )
        if prob_enabled:
            if not (prob_start and prob_end):
                raise serializers.ValidationError(
                    {'probation_start_date': 'Tanggal probation wajib diisi bila probation diaktifkan.'}
                )
            if prob_end < prob_start:
                raise serializers.ValidationError(
                    {'probation_end_date': 'Tanggal akhir probation tidak boleh sebelum tanggal mulai.'}
                )
            if join_date and prob_start < join_date:
                raise serializers.ValidationError(
                    {'probation_start_date': 'Probation tidak boleh dimulai sebelum join date.'}
                )
        elif prob_start or prob_end:
            raise serializers.ValidationError(
                {'probation_enabled': 'Tanggal probation tidak boleh diisi bila probation nonaktif.'}
            )
        return attrs


class OnboardingDataReadSerializer(OnboardingDataSerializer):
    """Read serializer — masks sensitive fields for non-privileged roles."""

    nik = serializers.SerializerMethodField()
    bank_account_number = serializers.SerializerMethodField()
    npwp = serializers.SerializerMethodField()
    bpjs_kesehatan = serializers.SerializerMethodField()
    bpjs_ketenagakerjaan = serializers.SerializerMethodField()

    def _privileged(self):
        request = self.context.get('request')
        role = getattr(getattr(request.user, 'role', None), 'key', None) if request else None
        return role in PRIVILEGED_ROLES

    def get_nik(self, obj):
        return _mask(obj.nik, self._privileged())

    def get_bank_account_number(self, obj):
        return _mask(obj.bank_account_number, self._privileged())

    def get_npwp(self, obj):
        return _mask(obj.npwp, self._privileged())

    def get_bpjs_kesehatan(self, obj):
        return _mask(obj.bpjs_kesehatan, self._privileged())

    def get_bpjs_ketenagakerjaan(self, obj):
        return _mask(obj.bpjs_ketenagakerjaan, self._privileged())


class OnboardingChecklistItemSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingChecklistItem
        fields = (
            'id', 'onboarding', 'name', 'code', 'category', 'required',
            'completed', 'notes', 'completed_at', 'completed_by',
            'completed_by_name', 'ordering',
        )
        read_only_fields = (
            'id', 'onboarding', 'name', 'code', 'category', 'required',
            'completed_at', 'completed_by', 'completed_by_name', 'ordering',
        )

    def update(self, instance, validated_data):
        completed = validated_data.get('completed', instance.completed)
        if completed and not instance.completed:
            validated_data['completed_at'] = timezone.now()
            validated_data['completed_by'] = self.context['request'].user
        elif not completed and instance.completed:
            validated_data['completed_at'] = None
            validated_data['completed_by'] = None
        return super().update(instance, validated_data)

    def get_completed_by_name(self, obj):
        return obj.completed_by.get_username() if obj.completed_by_id else None


class OnboardingDocumentSerializer(serializers.ModelSerializer):
    document_type_label = serializers.CharField(source='get_document_type_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingDocument
        fields = (
            'id', 'onboarding', 'document_type', 'document_type_label',
            'original_filename', 'file_size', 'mime_type', 'status', 'status_label',
            'notes', 'uploaded_by', 'uploaded_by_name',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at', 'created_at',
        )
        read_only_fields = (
            'id', 'onboarding', 'original_filename', 'file_size', 'mime_type',
            'uploaded_by', 'uploaded_by_name', 'reviewed_by', 'reviewed_by_name',
            'reviewed_at', 'created_at',
        )

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_username() if obj.uploaded_by_id else None

    def get_reviewed_by_name(self, obj):
        return obj.reviewed_by.get_username() if obj.reviewed_by_id else None


class OnboardingSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(source='candidate.full_name', read_only=True)
    candidate_email = serializers.CharField(source='candidate.email', read_only=True)
    candidate_status = serializers.CharField(source='candidate.status', read_only=True)
    job_title = serializers.CharField(source='candidate.job.title', read_only=True)
    department_name = serializers.CharField(source='candidate.job.department.name', read_only=True, default=None)
    position_name = serializers.CharField(source='candidate.job.position.name', read_only=True, default=None)
    next_statuses = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()
    status_history = OnboardingStatusHistorySerializer(many=True, read_only=True)
    data = OnboardingDataReadSerializer(read_only=True)
    employee_id = serializers.CharField(source='employee.employee_id', read_only=True, default=None)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True, default=None)
    employee_status = serializers.CharField(source='employee.employment_status', read_only=True, default=None)
    account_status = serializers.SerializerMethodField()

    class Meta:
        model = Onboarding
        fields = (
            'id', 'candidate', 'candidate_name', 'candidate_email',
            'candidate_status', 'job_title', 'department_name', 'position_name',
            'status', 'next_statuses', 'target_join_date', 'notes',
            'created_by', 'created_by_name', 'completed_by', 'completed_by_name',
            'completed_at', 'created_at', 'updated_at',
            'status_history', 'data',
            'employee', 'employee_id', 'employee_name', 'employee_status',
            'account_status',
        )
        read_only_fields = (
            'id', 'candidate_name', 'candidate_email', 'candidate_status',
            'job_title', 'department_name', 'position_name', 'status',
            'next_statuses', 'created_by', 'created_by_name',
            'completed_by', 'completed_by_name', 'completed_at',
            'created_at', 'updated_at', 'status_history', 'data',
            'employee', 'employee_id', 'employee_name', 'employee_status',
            'account_status',
        )

    def get_next_statuses(self, obj):
        return sorted(Onboarding.TRANSITIONS.get(obj.status, set()))

    def get_created_by_name(self, obj):
        return obj.created_by.get_username() if obj.created_by_id else None

    def get_completed_by_name(self, obj):
        return obj.completed_by.get_username() if obj.completed_by_id else None

    def get_account_status(self, obj):
        employee = getattr(obj, 'employee', None)
        if employee is None:
            return None
        user = getattr(employee, 'user', None)
        if user is None:
            return 'NO_ACCOUNT'
        return 'ACTIVE' if user.is_active else 'INACTIVE'
