from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response


class SoftHardDeleteMixin:
    """DRF mixin: default DELETE = soft delete; extra `DELETE .../hard-delete/` = hard delete.

    Subclasses implement:
        soft_delete(instance)  -> soft delete (deactivate / mark deleted_at)
        hard_delete(instance)  -> optional; defaults to instance.delete()
    """

    def soft_delete(self, instance):
        raise NotImplementedError

    def hard_delete(self, instance):
        instance.delete()

    def perform_destroy(self, instance):
        self.soft_delete(instance)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete_action(self, request, pk=None):
        instance = self.get_object()
        self.hard_delete(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)
