from django.db.models import Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.permissions import WRITE_ROLES, _role

from .models import Announcement, AnnouncementRead
from .permissions import IsAnnouncementAdmin
from .serializers import AnnouncementSerializer


class AnnouncementViewSet(viewsets.ModelViewSet):
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAnnouncementAdmin]
    search_fields = ['title', 'body']

    def get_queryset(self):
        # Expired announcements must not linger as ACTIVE on any read path.
        Announcement.deactivate_expired()
        qs = Announcement.objects.annotate(
            is_read=Exists(AnnouncementRead.objects.filter(announcement=OuterRef('pk'), user=self.request.user))
        )
        # Employees (non-admin) only see currently visible announcements.
        if _role(self.request.user) not in WRITE_ROLES:
            qs = [a for a in qs if a.is_visible]
        return qs

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def read(self, request, pk=None):
        """Mark one announcement as read by the caller (any role)."""
        obj = get_object_or_404(Announcement, pk=pk)
        if _role(request.user) not in WRITE_ROLES and not obj.is_visible:
            return Response(status=404)
        AnnouncementRead.objects.get_or_create(announcement=obj, user=request.user)
        return Response(status=204)

    @action(detail=False, methods=['post'], url_path='mark-all-read', permission_classes=[IsAuthenticated])
    def mark_all_read(self, request):
        """Mark every currently visible announcement as read by the caller."""
        Announcement.deactivate_expired()
        done = set(AnnouncementRead.objects.filter(user=request.user).values_list('announcement_id', flat=True))
        new = [
            AnnouncementRead(announcement=a, user=request.user)
            for a in Announcement.objects.all()
            if a.is_visible and a.id not in done
        ]
        AnnouncementRead.objects.bulk_create(new, ignore_conflicts=True)
        return Response({'marked': len(new)})

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'Announcement {obj.title} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Announcement {obj.title} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Announcement {instance.title} deleted')
        instance.delete()
