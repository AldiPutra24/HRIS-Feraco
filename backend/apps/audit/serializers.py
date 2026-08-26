from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    module = serializers.SerializerMethodField()
    entity_type = serializers.SerializerMethodField()
    entity_id = serializers.SerializerMethodField()
    object_repr = serializers.SerializerMethodField()
    timestamp = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = (
            'id',
            'action',
            'actor',
            'module',
            'object_repr',
            'entity_type',
            'entity_id',
            'description',
            'changes_before',
            'changes_after',
            'metadata',
            'ip_address',
            'user_agent',
            'timestamp',
        )

    def get_actor(self, obj):
        return obj.user.username if obj.user else None

    def get_module(self, obj):
        return obj.content_type.app_label if obj.content_type else None

    def get_object_repr(self, obj):
        return str(obj.content_object) if obj.content_object else None

    def get_entity_type(self, obj):
        return obj.content_type.model if obj.content_type else None

    def get_entity_id(self, obj):
        return obj.object_id

    def get_timestamp(self, obj):
        return obj.created_at
