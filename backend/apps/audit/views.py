from datetime import datetime, time, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.softdelete import SoftHardDeleteMixin

from .models import AuditLog
from .permissions import IsAuditViewer
from .serializers import AuditLogSerializer


def _parse_day(raw, field):
    """Parse a YYYY-MM-DD query param; invalid input -> 400 (never a 500)."""
    day = parse_date(raw) if raw else None
    if raw and day is None:
        raise ValidationError({field: 'Format tanggal harus YYYY-MM-DD.'})
    return day


def _day_start(day):
    """Start of `day` in the project timezone (Asia/Jakarta) as aware datetime."""
    return timezone.make_aware(datetime.combine(day, time.min))


class AuditLogViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    queryset = AuditLog.objects.select_related('user', 'content_type').filter(deleted_at__isnull=True)
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuditViewer]
    http_method_names = ['get', 'head', 'options', 'delete']
    search_fields = ['user__username', 'description']
    # `action` is filtered manually (case-insensitive, any value): log_event
    # also records actions outside ACTION_CHOICES (e.g. payroll_calculate),
    # which a choice filter would reject with 400.
    filterset_fields = ['user']
    ordering_fields = ['created_at', 'action']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        action_param = (params.get('action') or '').strip()
        if action_param:
            qs = qs.filter(action__iexact=action_param)
        actor = (params.get('actor') or '').strip()
        if actor:
            qs = qs.filter(user__username__icontains=actor)
        module = (params.get('module') or '').strip()
        if module:
            qs = qs.filter(content_type__app_label__iexact=module)
        entity_type = params.get('entity_type')
        if entity_type:
            qs = qs.filter(content_type__model=entity_type)
        entity_id = params.get('entity_id')
        if entity_id:
            if not entity_id.isdigit():
                raise ValidationError({'entity_id': 'entity_id harus angka.'})
            qs = qs.filter(object_id=entity_id)
        # Date range in local time (Asia/Jakarta), both ends inclusive:
        # [date_from 00:00, date_to + 1 day 00:00). Explicit bounds keep the
        # created_at index usable and avoid day-boundary timezone shifts.
        date_from = _parse_day(params.get('date_from'), 'date_from')
        date_to = _parse_day(params.get('date_to'), 'date_to')
        if date_from and date_to and date_from > date_to:
            raise ValidationError({'date_to': 'Tanggal akhir tidak boleh sebelum tanggal mulai.'})
        if date_from:
            qs = qs.filter(created_at__gte=_day_start(date_from))
        if date_to:
            qs = qs.filter(created_at__lt=_day_start(date_to + timedelta(days=1)))
        return qs

    def soft_delete(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['deleted_at'])

    def hard_delete(self, instance):
        instance.delete()

    @action(detail=False, methods=['get'])
    def actions(self, request):
        """Action values for the filter dropdown: known choices + any custom
        action actually recorded (e.g. payroll_period_approved)."""
        recorded = (
            AuditLog.objects.filter(deleted_at__isnull=True)
            .values_list('action', flat=True)
            .distinct()
        )
        values = {key for key, _ in AuditLog.ACTION_CHOICES} | {a.lower() for a in recorded if a}
        return Response(sorted(values))

    @action(detail=False, methods=['delete'], url_path='clear-all')
    def clear_all(self, request):
        if getattr(getattr(request.user, 'role', None), 'key', None) != 'ADMIN':
            return Response({'detail': 'Only admin.'}, status=status.HTTP_403_FORBIDDEN)
        deleted, _ = AuditLog.objects.all().delete()
        return Response({'deleted': deleted}, status=status.HTTP_200_OK)
