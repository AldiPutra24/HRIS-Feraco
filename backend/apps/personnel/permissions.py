from rest_framework.permissions import BasePermission, SAFE_METHODS

# Roles allowed to read/write employee data. EMPLOYEE/MANAGEMENT are denied
# unless they are the subject (enforced where relevant). Backend is source of truth.
WRITE_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
DELETE_ROLES = {'ADMIN', 'HR_LEAD'}
READ_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT'}


def _role(user):
    return getattr(getattr(user, 'role', None), 'key', None) if user and user.is_authenticated else None


class IsHRStaff(BasePermission):
    """Read for management+, write for HR/admin."""

    def has_permission(self, request, view):
        role = _role(request.user)
        if request.method in SAFE_METHODS:
            return role in READ_ROLES
        if request.method == 'DELETE':
            return role in DELETE_ROLES
        return role in WRITE_ROLES
