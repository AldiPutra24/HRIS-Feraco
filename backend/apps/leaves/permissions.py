from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

# HR/admin can read everything and manage leave types + balances.
LEAVE_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
# Approvers = HR roles + MANAGEMENT (manager approves direct reports).
APPROVER_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT'}


def _employee_for(user):
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)


class IsLeaveAdmin(BasePermission):
    """Leave types + balance management: HR/admin write, authenticated read."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return _role(request.user) in LEAVE_ADMIN_ROLES


class LeaveRequestPermission(BasePermission):
    """Employees submit/view their own; approvers + HR view pending/all."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        role = _role(request.user)
        if role in LEAVE_ADMIN_ROLES:
            return True
        employee = _employee_for(request.user)
        # Owner may read their own request.
        if employee is not None and obj.employee_id == employee.id:
            return request.method in SAFE_METHODS or request.method in ('POST', 'DELETE')
        # Manager approver may act on requests of their direct reports.
        if role == 'MANAGEMENT' and employee is not None:
            return obj.employee.manager_id == employee.id
        return False
