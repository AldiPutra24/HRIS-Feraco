from rest_framework.permissions import BasePermission

from apps.personnel.permissions import _role

# HR/Admin/User/PIC who manage the freelance database (read + write).
# GENERAL_MANAGER: read-only — may browse the full Freelancer/Talent Pool
# (list, detail, search, filter, document download) but every mutation is
# rejected with 403 by IsFreelanceManager. Deliberately NOT team-scoped
# (freelancers are not Employees, so the reporting hierarchy does not apply).
# MANAGEMENT: no access — Talent Pool is managed by HR only.
FREELANCE_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'EMPLOYEE', 'GENERAL_MANAGER'}


class IsFreelanceManager(BasePermission):
    """Freelance-management roles read/write; GENERAL_MANAGER reads only."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if _role(request.user) == 'GENERAL_MANAGER':
            return request.method in ('GET', 'HEAD', 'OPTIONS')
        return _role(request.user) in FREELANCE_ROLES

    def has_object_permission(self, request, view, obj):
        if _role(request.user) == 'GENERAL_MANAGER':
            return request.method in ('GET', 'HEAD', 'OPTIONS')
        return _role(request.user) in FREELANCE_ROLES
