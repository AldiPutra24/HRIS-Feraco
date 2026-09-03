from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

ONBOARDING_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
ONBOARDING_VIEW_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT'}


class IsOnboardingAdmin(BasePermission):
    """HR/admin manage; MANAGEMENT read-only; EMPLOYEE denied."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = _role(request.user)
        if request.method in SAFE_METHODS:
            return role in ONBOARDING_VIEW_ROLES
        return role in ONBOARDING_ADMIN_ROLES
