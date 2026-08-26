from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.softdelete import SoftHardDeleteMixin

from .models import AuditLog
from .permissions import IsAuditViewer
from .serializers import AuditLogSerializer


class AuditLogViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    queryset = AuditLog.objects.select_related('user', 'content_type').filter(deleted_at__isnull=True)
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuditViewer]
    http_method_names = ['get', 'head', 'options', 'delete']
    search_fields = ['user__username', 'description']
    filterset_fields = ['action', 'user']
    ordering_fields = ['created_at', 'action']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        module = self.request.query_params.get('module')
        if module:
            qs = qs.filter(content_type__app_label=module)
        entity_type = self.request.query_params.get('entity_type')
        if entity_type:
            qs = qs.filter(content_type__model=entity_type)
        entity_id = self.request.query_params.get('entity_id')
        if entity_id:
            qs = qs.filter(object_id=entity_id)
        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    def soft_delete(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['deleted_at'])

    def hard_delete(self, instance):
        instance.delete()

    @action(detail=False, methods=['delete'], url_path='clear-all')
    def clear_all(self, request):
        if getattr(getattr(request.user, 'role', None), 'key', None) != 'ADMIN':
            return Response({'detail': 'Only admin.'}, status=status.HTTP_403_FORBIDDEN)
        deleted, _ = AuditLog.objects.all().delete()
        return Response({'deleted': deleted}, status=status.HTTP_200_OK)
