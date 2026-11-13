from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

# HR/admin can see everything and manage reimbursements.
REIMBURSEMENT_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
# Approval layers (ADMIN may act on either layer as superadmin fallback).
REVIEW_ROLES = {'HR_STAFF', 'ADMIN'}        # set Nominal Disetujui
FINAL_APPROVER_ROLES = {'HR_LEAD', 'ADMIN'}  # approve/reject payment

def _employee_for(user):
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)


def can_recap(user):
    """Finance recap access: ADMIN, or an employee whose position is flagged
    `can_recap_reimbursement` (Settings -> Positions). Role stays unchanged."""
    if not getattr(user, 'is_authenticated', False):
        return False
    if _role(user) == 'ADMIN':
        return True
    employee = _employee_for(user)
    position = getattr(employee, 'position', None)
    return bool(position and position.can_recap_reimbursement)


def may_self_finalize(user, obj):
    """An HR Lead gives the final approval / rejection of their OWN
    reimbursement (company rule). Every other self-decision stays blocked,
    and the amount is still reviewed by HR Staff first."""
    employee = _employee_for(user)
    return _role(user) == 'HR_LEAD' and employee is not None and obj.employee_id == employee.id

class ReimbursementPermission(BasePermission):
    """Employees AND Management see/act on their OWN reimbursements only;
    HR/admin manage all."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        role = _role(request.user)
        if role in REIMBURSEMENT_ADMIN_ROLES:
            return True
        employee = _employee_for(request.user)
        if employee is not None and obj.employee_id == employee.id:
            return True
        # Finance may read other people's PAID reimbursements and toggle the
        # recap mark, nothing else (no edit/delete).
        if obj.status == 'PAID' and can_recap(request.user):
            return request.method in SAFE_METHODS or getattr(view, 'action', None) in ('recap', 'unrecap')
        return False
