from rest_framework import serializers

from .models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = Announcement
        fields = ('id', 'title', 'body', 'created_by', 'created_by_name', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_by', 'created_by_name', 'created_at', 'updated_at')
