from rest_framework import viewsets

from .models import AuditLog
from .permissions import IsAuditViewer
from .serializers import AuditLogSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related('user', 'content_type').all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuditViewer]
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
