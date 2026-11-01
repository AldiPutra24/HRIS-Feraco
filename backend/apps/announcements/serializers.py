from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .models import Announcement, AnnouncementRead, STATUS_ACTIVE, STATUS_INACTIVE


def default_end_date():
    return timezone.localdate() + timedelta(days=7)


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    # Default ON on create (model default is False; explicit false still wins).
    use_end_date = serializers.BooleanField(default=True)
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'title', 'body', 'created_by', 'created_by_name', 'created_at', 'updated_at',
            'status', 'use_end_date', 'end_date', 'category', 'is_pinned', 'is_read',
        )
        read_only_fields = ('id', 'created_by', 'created_by_name', 'created_at', 'updated_at')

    def get_is_read(self, obj):
        # Annotated by AnnouncementViewSet.get_queryset; query only as a fallback (create/update).
        annotated = getattr(obj, 'is_read', None)
        if annotated is not None:
            return annotated
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return AnnouncementRead.objects.filter(announcement=obj, user=request.user).exists()

    def validate(self, attrs):
        creating = self.instance is None
        if creating and 'use_end_date' not in attrs:
            attrs['use_end_date'] = True  # default ON
        use_end_date = attrs.get('use_end_date', getattr(self.instance, 'use_end_date', False))
        if creating and use_end_date and 'end_date' not in attrs:
            attrs['end_date'] = default_end_date()  # default +7 days
        end_date = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if not use_end_date:
            attrs['end_date'] = None
        if use_end_date and not end_date:
            raise serializers.ValidationError({'end_date': 'End date wajib diisi saat menggunakan end date.'})
        return attrs

    def save(self, **kwargs):
        # Auto-inactive when end date has passed; manual status still honored otherwise.
        if self.validated_data.get('use_end_date') and self.validated_data.get('end_date'):
            from django.utils import timezone
            if self.validated_data['end_date'] < timezone.localdate():
                self.validated_data['status'] = STATUS_INACTIVE
        return super().save(**kwargs)
