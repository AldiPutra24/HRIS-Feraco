from rest_framework.permissions import BasePermission

from apps.personnel.permissions import _role

# HR/Admin/User/PIC who manage the freelance database.
# GENERAL_MANAGER: read access to the full Freelancer/Talent Pool list —
# deliberately NOT team-scoped (freelancers are not Employees, so the
# reporting hierarchy does not apply). No other module gains access.
FREELANCE_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT', 'EMPLOYEE', 'GENERAL_MANAGER'}


class IsFreelanceManager(BasePermission):
    """Anyone with a freelance-management role may read/write."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return _role(request.user) in FREELANCE_ROLES

    def has_object_permission(self, request, view, obj):
        return _role(request.user) in FREELANCE_ROLES
