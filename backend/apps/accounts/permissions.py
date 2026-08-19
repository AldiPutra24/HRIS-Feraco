from rest_framework.permissions import BasePermission

def _role(user):
    return getattr(getattr(user, 'role', None), 'key', None) if user and user.is_authenticated else None

class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return _role(request.user) == 'ADMIN'
