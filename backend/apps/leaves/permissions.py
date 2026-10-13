from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

# HR/admin can read everything and manage leave types + balances.
LEAVE_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
# Fallback approvers when the Reporting To has not acted yet.
HR_APPROVER_ROLES = {'HR_STAFF', 'HR_LEAD'}


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
        # Manager approver may act on requests within their team scope.
        if role in ('MANAGEMENT', 'GENERAL_MANAGER') and employee is not None:
            from apps.personnel.permissions import team_scope_ids

            return obj.employee_id in team_scope_ids(request.user)
        return False


def leave_decision_error(user, leave, verb='memutuskan'):
    """Why `user` may NOT approve/reject `leave`, or None if allowed.

    Primary approver = the employee's Reporting To (direct manager only —
    a General Manager does not decide for people deeper in the hierarchy).
    HR Staff / HR Lead may decide as a fallback. Nobody decides their own
    request. Single source of truth for the approve/reject actions and the
    `can_decide` flag shown in the UI.
    """
    from apps.personnel.permissions import _role

    actor = _employee_for(user)
    if actor is not None and leave.employee_id == actor.id:
        return f'Tidak dapat {verb} pengajuan sendiri.'
    is_manager = actor is not None and leave.employee.manager_id == actor.id
    if not is_manager and _role(user) not in HR_APPROVER_ROLES:
        return f'Hanya atasan langsung atau HR Staff/HR Lead yang dapat {verb}.'
    return None
