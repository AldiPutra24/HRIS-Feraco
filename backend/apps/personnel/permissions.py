from apps.personnel.models import Employee
from rest_framework.permissions import BasePermission, SAFE_METHODS

# Roles allowed to read/write employee data. EMPLOYEE/MANAGEMENT are denied
# unless they are the subject (enforced where relevant). Backend is source of truth.
WRITE_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD'}
DELETE_ROLES = {'ADMIN', 'HR_LEAD'}
READ_ROLES = {'ADMIN', 'HR_STAFF', 'HR_LEAD', 'MANAGEMENT', 'GENERAL_MANAGER'}

# Roles with team/dashboard scope. MANAGEMENT = direct reports only;
# GENERAL_MANAGER = full reporting hierarchy below them (transitive).
TEAM_ROLES = {'MANAGEMENT', 'GENERAL_MANAGER'}


def _role(user):
    return getattr(getattr(user, 'role', None), 'key', None) if user and user.is_authenticated else None


def employee_for(user):
    """Employee record linked to a user via personnel, or None."""
    personnel = getattr(user, 'personnel', None)
    return getattr(personnel, 'employee', None)


def team_scope_ids(user):
    """IDs of employees within the user's team scope.

    MANAGEMENT: direct reports only (Employee.manager = their Employee).
    GENERAL_MANAGER: the full reporting hierarchy below them — direct reports,
    Management below them, and everyone reporting under that Management.
    Implemented as a transitive manager walk (BFS), never department or
    parent_position. Non-team roles get an empty set.
    """
    employee = employee_for(user)
    role = _role(user)
    if employee is None or role not in TEAM_ROLES:
        return set()
    if role == 'MANAGEMENT':
        return set(
            Employee.objects.filter(manager=employee).values_list('id', flat=True)
        )
    # GENERAL_MANAGER: transitive closure of the reporting tree.
    scope: set[int] = set()
    frontier = [employee.id]
    while frontier:
        children = list(
            Employee.objects.filter(manager_id__in=frontier)
            .exclude(id__in=scope)
            .values_list('id', flat=True)
        )
        children = [c for c in children if c not in scope and c != employee.id]
        if not children:
            break
        scope.update(children)
        frontier = children
    return scope


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


def has_team_scope(user):
    """True for MANAGEMENT / GENERAL_MANAGER with a linked Employee."""
    return _role(user) in TEAM_ROLES and employee_for(user) is not None


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
