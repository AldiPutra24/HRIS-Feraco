from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from apps.audit.services import log_event
from apps.personnel.permissions import WRITE_ROLES, _role

from .models import (
    Notification,
    NotificationDeliveryLog,
    NotificationEventConfig,
    NotificationSetting,
)
from .serializers import (
    NotificationDeliveryLogSerializer,
    NotificationEventConfigSerializer,
    NotificationSerializer,
    NotificationSettingSerializer,
)

EVENT_KEYS = (
    'LEAVE_SUBMITTED',
    'LEAVE_APPROVED',
    'LEAVE_REJECTED',
    'CONTRACT',
    'BIRTHDAY_HR',
    'BIRTHDAY_EMPLOYEE',
)


class IsHRAdmin(permissions.BasePermission):
    """Notification settings: HR/Admin only (read+write)."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return _role(request.user) in WRITE_ROLES or request.user.is_superuser


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """Bell popover: own notifications only + unread count + mark read."""

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        # Isolation: a user can only ever see their own notifications.
        return Notification.objects.filter(recipient=self.request.user)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()[:50]
        unread = self.get_queryset().filter(is_read=False).count()
        return Response({'results': NotificationSerializer(qs, many=True).data, 'unread': unread})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        return Response({'unread': self.get_queryset().filter(is_read=False).count()})

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        notif = self.get_object()  # 404 if not owned
        if not notif.is_read:
            notif.is_read = True
            notif.save(update_fields=['is_read'])
        return Response(NotificationSerializer(notif).data)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        updated = self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response({'marked': updated})


class NotificationSettingViewSet(viewsets.ModelViewSet):
    """Singleton settings (HR/Admin): HR recipients, toggles, offsets."""

    queryset = NotificationSetting.objects.all()
    serializer_class = NotificationSettingSerializer
    permission_classes = [IsHRAdmin]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_object(self):
        return NotificationSetting.get_solo()

    def list(self, request, *args, **kwargs):
        return self.retrieve(request, pk=1)

    def perform_update(self, serializer):
        obj = serializer.save(
            updated_by=self.request.user if self.request.user.is_authenticated else None
        )
        log_event(self.request, 'update', obj=obj, description='Notification settings updated')

    @action(detail=False, methods=['get'])
    def hr_candidates(self, request):
        """Users eligible as additional HR recipients (HR_STAFF/HR_LEAD)."""
        users = User.objects.filter(
            role__key__in=('HR_STAFF', 'HR_LEAD'), is_active=True,
        ).select_related('role').order_by('username')
        return Response([
            {'id': u.id, 'username': u.username, 'email': u.email, 'role': getattr(u.role, 'key', '')}
            for u in users
        ])


class NotificationDeliveryLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Delivery history (HR/Admin): email + in-app delivery outcomes.

    Read-only ledger written by services._send_email/_deliver_inapp; the UI
    can filter by channel/status/event/recipient and date range.
    """

    queryset = NotificationDeliveryLog.objects.select_related('recipient').all()
    serializer_class = NotificationDeliveryLogSerializer
    permission_classes = [IsHRAdmin]
    filterset_fields = ['channel', 'status', 'event']
    search_fields = ['recipient_email', 'subject', 'key']
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Per-status counts, optionally scoped to the same filters."""
        qs = self.get_queryset()
        return Response({
            'total': qs.count(),
            'sent': qs.filter(status='SENT').count(),
            'failed': qs.filter(status='FAILED').count(),
            'skipped': qs.filter(status='SKIPPED').count(),
        })


class NotificationEventConfigViewSet(viewsets.ModelViewSet):
    """Per-event config: enable/disable + email subject/body overrides."""

    queryset = NotificationEventConfig.objects.all()
    serializer_class = NotificationEventConfigSerializer
    permission_classes = [IsHRAdmin]
    http_method_names = ['get', 'patch', 'head', 'options']
    pagination_class = None

    def get_queryset(self):
        return NotificationEventConfig.objects.all()

    def list(self, request, *args, **kwargs):
        # Ensure all six config rows exist so the UI gets a complete list.
        for event in EVENT_KEYS:
            NotificationEventConfig.objects.get_or_create(event=event)
        return super().list(request, *args, **kwargs)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Notification config {obj.event} updated')

