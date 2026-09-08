from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import WRITE_ROLES, _role

# HR/admin can create/update/delete; any authenticated user may read.
ANNOUNCEMENT_ADMIN_ROLES = WRITE_ROLES


class IsAnnouncementAdmin(BasePermission):
    """HR/admin write; authenticated read."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request.user) in ANNOUNCEMENT_ADMIN_ROLES
