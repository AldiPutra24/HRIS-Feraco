from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.audit.services import log_event
from apps.personnel.permissions import WRITE_ROLES, _role

from .models import Announcement
from .permissions import IsAnnouncementAdmin
from .serializers import AnnouncementSerializer


class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAnnouncementAdmin]
    search_fields = ['title', 'body']

    def get_queryset(self):
        qs = Announcement.objects.all()
        # Employees (non-admin) only see currently visible announcements.
        if _role(self.request.user) not in WRITE_ROLES:
            qs = [a for a in qs if a.is_visible]
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'Announcement {obj.title} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Announcement {obj.title} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Announcement {instance.title} deleted')
        instance.delete()
