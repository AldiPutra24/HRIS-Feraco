from rest_framework.permissions import BasePermission

from apps.personnel.permissions import _role

AUDIT_ROLES = {'ADMIN', 'HR_LEAD'}


class IsAuditViewer(BasePermission):
    """Audit log is restricted to Admin and HR Lead."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and _role(request.user) in AUDIT_ROLES)
