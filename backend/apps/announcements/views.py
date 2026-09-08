from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.audit.services import log_event

from .models import Announcement
from .permissions import IsAnnouncementAdmin
from .serializers import AnnouncementSerializer


class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAnnouncementAdmin]
    search_fields = ['title', 'body']

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'Announcement {obj.title} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Announcement {obj.title} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Announcement {instance.title} deleted')
        instance.delete()
