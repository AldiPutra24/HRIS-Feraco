from django.contrib.auth import authenticate
from rest_framework import serializers

from apps.personnel.models import Employee

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='role.key', read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_staff')


class RoleSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ('id', 'key', 'name', 'user_count')
        read_only_fields = ('id', 'key', 'user_count')

    def get_user_count(self, obj):
        return obj.users.count()

class UserAdminSerializer(serializers.ModelSerializer):
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all(), required=False, allow_null=True)
    role_key = serializers.CharField(source='role.key', read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), required=False, allow_null=True, write_only=True)
    employee_id = serializers.IntegerField(source='personnel.employee.id', read_only=True, allow_null=True)
    employee_name = serializers.CharField(source='personnel.employee.full_name', read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'role', 'role_key', 'is_active', 'is_staff', 'password', 'employee', 'employee_id', 'employee_name')
        read_only_fields = ('id',)
        extra_kwargs = {
            'email': {'required': True},
        }

    def validate_employee(self, employee):
        # One active user per employee; one employee per user.
        if employee is not None and employee.user_id not in (None, self.instance.pk if self.instance else None):
            raise serializers.ValidationError('Karyawan ini sudah terhubung ke user lain.')
        return employee

    def validate(self, attrs):
        employee = attrs.get('employee')
        if employee is not None:
            # Pull name/email from the employee (source of truth).
            attrs['first_name'] = employee.full_name
            attrs['last_name'] = ''
            attrs['email'] = employee.personal_email or attrs.get('email')
            if not attrs.get('username'):
                attrs['username'] = employee.employee_id.lower()
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        employee = validated_data.pop('employee', None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        if employee is not None:
            employee.user = user
            employee.save(update_fields=['user', 'updated_at'])
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        employee = validated_data.pop('employee', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        if employee is not None and employee.user_id != instance.pk:
            employee.user = instance
            employee.save(update_fields=['user', 'updated_at'])
        return instance

class SelfAccountSerializer(serializers.ModelSerializer):
    """Self-service account edit: username/email/name/password. Role/status excluded."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    current_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'password', 'current_password')
        read_only_fields = ('id',)
        extra_kwargs = {
            'username': {'required': True},
            'email': {'required': True},
        }

    def validate(self, attrs):
        if attrs.get('password'):
            current = attrs.get('current_password', '')
            if not current or not self.instance.check_password(current):
                raise serializers.ValidationError({'current_password': 'Password saat ini salah.'})
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop('current_password', None)
        password = validated_data.pop('password', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(style={'input_type': 'password'}, write_only=True)

    def validate(self, attrs):
        request = self.context.get('request')
        user = User.objects.filter(email__iexact=attrs['email']).first()
        if user is None:
            user = authenticate(
                request=request,
                username=attrs['email'],
                password=attrs['password'],
            )
        else:
            user = user if user.check_password(attrs['password']) else None

        if user is None or not user.is_active:
            raise serializers.ValidationError('Invalid email or password.')
        attrs['user'] = user
        return attrs
