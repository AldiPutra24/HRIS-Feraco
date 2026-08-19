from django.contrib.auth import authenticate
from rest_framework import serializers

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

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'role', 'role_key', 'is_active', 'is_staff', 'password')
        read_only_fields = ('id',)
        extra_kwargs = {
            'email': {'required': True},
        }

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
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
