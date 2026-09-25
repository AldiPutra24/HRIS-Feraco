from rest_framework.permissions import BasePermission, SAFE_METHODS

from apps.personnel.permissions import _role

PAYROLL_ADMIN_ROLES = {'ADMIN', 'HR_LEAD'}
# HR_STAFF is excluded from payroll ADMIN: no payment types, structures,
# processing or tax configuration. HR_STAFF only keeps SELF-SERVICE access
# (own payslips via my-payslips / own payslip / own salary structure).
# MANAGEMENT likewise self-service only.
# GENERAL_MANAGER is strictly READ-ONLY: in VIEW_ROLES only, every mutation 403.
PAYROLL_VIEW_ROLES = {'ADMIN', 'HR_LEAD', 'GENERAL_MANAGER'}


class IsPayrollAdmin(BasePermission):
    """Read for HR/management, write for HR/admin."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return _role(request.user) in PAYROLL_VIEW_ROLES
        return _role(request.user) in PAYROLL_ADMIN_ROLES


class PayrollSelfPermission(BasePermission):
    """Payroll records: ADMIN/HR_LEAD/GM read all; MANAGEMENT/EMPLOYEE/HR_STAFF
    only via self-scoped queryset (get_queryset filters to their own employee).
    Writes: ADMIN/HR_LEAD only (GM read-only). Admin/configuration viewsets use
    IsPayrollAdmin and therefore reject MANAGEMENT, HR_STAFF, EMPLOYEE, GM."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return _role(request.user) in PAYROLL_VIEW_ROLES | {'EMPLOYEE', 'MANAGEMENT', 'HR_STAFF'}
        return _role(request.user) in PAYROLL_ADMIN_ROLES


class SalaryStructurePermission(BasePermission):
    """ADMIN/HR_LEAD manage all; other roles only read their own structure."""

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True  # scoped in get_queryset (own structure for self-service roles)
        return _role(request.user) in PAYROLL_ADMIN_ROLES

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
