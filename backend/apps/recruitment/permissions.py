from rest_framework.permissions import BasePermission

from apps.personnel.permissions import _role

RECRUITMENT_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}


class IsRecruitmentAdmin(BasePermission):
    """HR roles can manage jobs and view candidates."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return _role(request.user) in RECRUITMENT_ADMIN_ROLES

    def has_object_permission(self, request, view, obj):
        return _role(request.user) in RECRUITMENT_ADMIN_ROLES