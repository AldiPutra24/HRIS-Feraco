from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.personnel.permissions import WRITE_ROLES, _role

# HR/admin manage the KMS; every other authenticated role is read-only.
KMS_ADMIN_ROLES = WRITE_ROLES


class IsKmsAdmin(BasePermission):
    """Authenticated read for all roles; write only for HR Staff/HR Lead/Admin."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request.user) in KMS_ADMIN_ROLES
