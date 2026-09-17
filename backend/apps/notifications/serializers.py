from rest_framework import serializers

from apps.accounts.models import User

from .emails import AVAILABLE_PLACEHOLDERS
from .models import Notification, NotificationEventConfig, NotificationSetting

EVENT_KEYS = (
    'LEAVE_SUBMITTED',
    'LEAVE_APPROVED',
    'LEAVE_REJECTED',
    'CONTRACT',
    'BIRTHDAY_HR',
    'BIRTHDAY_EMPLOYEE',
)


class NotificationEventConfigSerializer(serializers.ModelSerializer):
    available_placeholders = serializers.SerializerMethodField()

    class Meta:
        model = NotificationEventConfig
        fields = ('id', 'event', 'enabled', 'subject', 'body', 'available_placeholders', 'updated_at')
        read_only_fields = ('id', 'event', 'available_placeholders', 'updated_at')

    def get_available_placeholders(self, obj):
        return AVAILABLE_PLACEHOLDERS


class NotificationSettingSerializer(serializers.ModelSerializer):
    additional_hr_users = serializers.PrimaryKeyRelatedField(
        many=True,
        required=False,
        queryset=User.objects.filter(role__key__in=('HR_STAFF', 'HR_LEAD')),
    )
    additional_hr_details = serializers.SerializerMethodField()

    class Meta:
        model = NotificationSetting
        fields = (
            'id', 'default_hr_emails', 'additional_hr_users', 'additional_hr_details',
            'birthday_h1_enabled', 'birthday_h0_enabled', 'contract_offsets', 'updated_at',
        )
        read_only_fields = ('id', 'additional_hr_details', 'updated_at')

    def get_additional_hr_details(self, obj):
        return [
            {'id': u.id, 'username': u.username, 'email': u.email, 'role': getattr(u.role, 'key', '')}
            for u in obj.additional_hr_users.filter(is_active=True).select_related('role')
        ]

    def validate_default_hr_emails(self, value):
        emails = [p.strip() for p in (value or '').replace(';', ',').split(',') if p.strip()]
        invalid = [e for e in emails if '@' not in e]
        if invalid:
            raise serializers.ValidationError(f'Email tidak valid: {", ".join(invalid)}')
        return ', '.join(dict.fromkeys(emails))

    def validate_contract_offsets(self, value):
        parts = [p.strip() for p in (value or '').split(',') if p.strip()]
        offsets = []
        for p in parts:
            if not p.isdigit():
                raise serializers.ValidationError('Offset harus berupa angka hari dipisah koma (mis. 30,14,7,3,1,0).')
            offsets.append(int(p))
        if not offsets:
            raise serializers.ValidationError('Minimal satu offset diperlukan.')
        return ', '.join(str(o) for o in sorted(set(offsets), reverse=True))

    def validate_additional_hr_users(self, value):
        for u in value:
            if getattr(u.role, 'key', '') not in ('HR_STAFF', 'HR_LEAD'):
                raise serializers.ValidationError(f'{u.username} bukan HR Staff/HR Lead.')
        return value


class NotificationSerializer(serializers.Serializer):
    """Read-only shape for the bell popover."""

    id = serializers.IntegerField(read_only=True)
    kind = serializers.CharField(read_only=True)
    title = serializers.CharField(read_only=True)
    message = serializers.CharField(read_only=True)
    link = serializers.CharField(read_only=True)
    object_id = serializers.CharField(read_only=True)
    is_read = serializers.BooleanField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
