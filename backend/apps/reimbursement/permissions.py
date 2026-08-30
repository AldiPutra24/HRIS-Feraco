from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

# HR/admin can see everything and manage reimbursements.
REIMBURSEMENT_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}

def _employee_for(user):
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)

class ReimbursementPermission(BasePermission):
    """Employees submit/view their own; HR/admin manage all."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        role = _role(request.user)
        if role in REIMBURSEMENT_ADMIN_ROLES:
            return True
        employee = _employee_for(request.user)
        return employee is not None and obj.employee_id == employee.id
