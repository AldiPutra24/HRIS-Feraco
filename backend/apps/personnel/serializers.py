from rest_framework import serializers

from .models import Department, Employee, EmployeeContract, EmployeeDocument, EmploymentHistory, Position


class DepartmentSerializer(serializers.ModelSerializer):
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Department
        fields = ('id', 'name', 'code', 'is_active', 'created_at', 'updated_at', 'employee_count')
        read_only_fields = ('id', 'created_at', 'updated_at', 'employee_count')
        extra_kwargs = {
            'name': {'required': True, 'allow_blank': False},
            'code': {'required': False, 'allow_blank': True},
        }

    def get_employee_count(self, obj):
        return obj.employees.count()

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError('Nama department wajib diisi.')
        return name


class PositionSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = ('id', 'name', 'code', 'department', 'department_name', 'is_active', 'created_at', 'updated_at', 'employee_count')
        read_only_fields = ('id', 'created_at', 'updated_at', 'department_name', 'employee_count')
        extra_kwargs = {
            'name': {'required': True, 'allow_blank': False},
            'code': {'required': False, 'allow_blank': True},
        }

    def get_employee_count(self, obj):
        return obj.employees.count()

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError('Nama position wajib diisi.')
        return name


def _mask(value, visible):
    if not value:
        return ''
    if visible:
        return value
    if len(value) <= 4:
        return '****'
    return value[:2] + '*' * (len(value) - 6) + value[-4:]


class EmployeeSerializer(serializers.ModelSerializer):
    """Writable serializer (plain sensitive fields)."""

    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    manager_name = serializers.CharField(source='manager.full_name', read_only=True)

    class Meta:
        model = Employee
        fields = (
            'id',
            'employee_id',
            'full_name',
            'nik',
            'birth_place',
            'birth_date',
            'address',
            'phone',
            'personal_email',
            'emergency_contact_name',
            'emergency_contact_phone',
            'bank_account_number',
            'bank_account_name',
            'npwp',
            'bpjs_kesehatan',
            'bpjs_ketenagakerjaan',
            'status',
            'department',
            'department_name',
            'position',
            'position_name',
            'manager',
            'manager_name',
            'join_date',
            'employment_status',
        )
        read_only_fields = ('id', 'employee_id', 'department_name', 'position_name', 'manager_name')
        extra_kwargs = {
            'nik': {'required': False, 'allow_blank': True},
        }

    def validate_nik(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError('NIK must contain digits only.')
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
        department = attrs.get('department')
        position = attrs.get('position')
        if position is not None:
            if department is None and self.instance is not None:
                department = self.instance.department
            if department is None or position.department_id != department.id:
                raise serializers.ValidationError({'position': 'Position tidak termasuk dalam department yang dipilih.'})
        return attrs


class EmployeeReadSerializer(EmployeeSerializer):
    """Read serializer — masks sensitive fields for non-privileged roles."""

    nik = serializers.SerializerMethodField()
    bank_account_number = serializers.SerializerMethodField()
    npwp = serializers.SerializerMethodField()
    bpjs_kesehatan = serializers.SerializerMethodField()
    bpjs_ketenagakerjaan = serializers.SerializerMethodField()

    def _privileged(self):
        request = self.context.get('request')
        role = getattr(getattr(request.user, 'role', None), 'key', None) if request else None
        return role in {'ADMIN', 'HR_STAFF', 'HR_LEAD'}

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


class EmployeeContractSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeContract
        fields = ('id', 'employee', 'contract_type', 'start_date', 'end_date', 'notes', 'created_at')
        read_only_fields = ('id', 'employee', 'created_at')


class EmploymentHistorySerializer(serializers.ModelSerializer):
    previous_department_name = serializers.CharField(source='previous_department.name', read_only=True)
    previous_position_name = serializers.CharField(source='previous_position.name', read_only=True)
    new_department_name = serializers.CharField(source='new_department.name', read_only=True)
    new_position_name = serializers.CharField(source='new_position.name', read_only=True)

    class Meta:
        model = EmploymentHistory
        fields = (
            'id',
            'employee',
            'date',
            'history_type',
            'previous_department',
            'previous_department_name',
            'previous_position',
            'previous_position_name',
            'new_department',
            'new_department_name',
            'new_position',
            'new_position_name',
            'notes',
            'created_at',
        )
        read_only_fields = ('id', 'employee', 'created_at')


class EmployeeDocumentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeDocument
        fields = ('id', 'employee', 'contract', 'name', 'content_type', 'size', 'version', 'created_at', 'url')
        read_only_fields = ('id', 'employee', 'content_type', 'size', 'version', 'created_at', 'url')

    def get_url(self, obj):
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/documents/{obj.id}/download/')