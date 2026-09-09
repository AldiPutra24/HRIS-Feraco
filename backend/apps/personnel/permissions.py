from apps.personnel.models import Employee
from rest_framework.permissions import BasePermission, SAFE_METHODS

# Roles allowed to read/write employee data. EMPLOYEE/MANAGEMENT are denied
# unless they are the subject (enforced where relevant). Backend is source of truth.
WRITE_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
DELETE_ROLES = {'ADMIN', 'HR_LEAD'}
READ_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT'}


def _role(user):
    return getattr(getattr(user, 'role', None), 'key', None) if user and user.is_authenticated else None


def employee_for(user):
    """Employee record linked to a user via personnel, or None."""
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)


def direct_report_ids(user):
    """IDs of the user's direct reports (Employee.manager = their Employee).
    Scope source is Employee.manager (Reporting To) only — never department
    or parent_position. Non-MANAGEMENT users get an empty set.
    """
    employee = employee_for(user)
    if employee is None or _role(user) != 'MANAGEMENT':
        return set()
    return set(
        Employee.objects.filter(manager=employee).values_list('id', flat=True)
    )


class IsHRStaff(BasePermission):
    """Read for management+, write for HR/admin."""

    def has_permission(self, request, view):
        role = _role(request.user)
        if request.method in SAFE_METHODS:
            return role in READ_ROLES
        if request.method == 'DELETE':
            return role in DELETE_ROLES
        return role in WRITE_ROLES


class IsManagementViewer(BasePermission):
    """MANAGEMENT may read direct reports only (Employee.manager scope).
    Every non-safe method is denied — Management Karyawan access is view-only.
    """

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return _role(request.user) in READ_ROLES
        return False
