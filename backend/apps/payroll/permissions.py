from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

PAYROLL_ADMIN_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
PAYROLL_VIEW_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT'}


class IsPayrollAdmin(BasePermission):
    """Read for HR/management, write for HR/admin."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return _role(request.user) in PAYROLL_VIEW_ROLES
        return _role(request.user) in PAYROLL_ADMIN_ROLES


class SalaryStructurePermission(BasePermission):
    """HR can manage all; employees only read their own."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        if _role(request.user) in PAYROLL_ADMIN_ROLES:
            return True
        personnel = getattr(request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return False
        if request.method in SAFE_METHODS:
            return obj.employee_id == employee.id
        return False


class PayrollPeriodPermission(BasePermission):
    """HR writes/transitions payroll periods; MANAGEMENT read-only."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return _role(request.user) in PAYROLL_VIEW_ROLES
        return _role(request.user) in PAYROLL_ADMIN_ROLES

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)
