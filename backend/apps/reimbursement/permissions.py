from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

# HR/admin can see everything and manage reimbursements.
REIMBURSEMENT_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
# Approval layers (ADMIN may act on either layer as superadmin fallback).
REVIEW_ROLES = {'HR_STAFF', 'ADMIN'}        # set Nominal Disetujui
FINAL_APPROVER_ROLES = {'HR_LEAD', 'ADMIN'}  # approve/reject payment
# An HR Lead's own reimbursement: final approval moves to the General Manager
# (HR Lead may not approve it, not even a fellow HR Lead).
HR_LEAD_FINAL_APPROVER_ROLES = {'GENERAL_MANAGER', 'ADMIN'}
# Statuses the GM sees for HR Lead reimbursements (not drafts/cancelled).
GM_VISIBLE_STATUSES = ('PENDING', 'WAITING_HR_LEAD', 'APPROVED', 'REJECTED', 'PAID')

def _employee_for(user):
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)


def requester_role(obj):
    """Current role key of the user who owns the reimbursement (or None)."""
    return _role(getattr(obj.employee, 'user', None))


def final_approver_roles(obj):
    """Roles allowed to approve/reject this reimbursement at WAITING_HR_LEAD."""
    return HR_LEAD_FINAL_APPROVER_ROLES if requester_role(obj) == 'HR_LEAD' else FINAL_APPROVER_ROLES


def final_approver_key(obj):
    """'GENERAL_MANAGER' for HR Lead requests, else 'HR_LEAD' (UI label)."""
    return 'GENERAL_MANAGER' if requester_role(obj) == 'HR_LEAD' else 'HR_LEAD'


def gm_approval_q():
    """Reimbursements the General Manager may see as final approver."""
    from django.db.models import Q
    return Q(employee__user__role__key='HR_LEAD', status__in=GM_VISIBLE_STATUSES)

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
        return role == 'GENERAL_MANAGER' and requester_role(obj) == 'HR_LEAD' and obj.status in GM_VISIBLE_STATUSES
