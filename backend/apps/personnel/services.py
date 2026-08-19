"""Contract status lifecycle — the single source of truth for status transitions."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import EmployeeContract


def sync_contract_status():
    """Ensure contract status reflects business rules.

    1. ACTIVE contracts whose end_date has passed → EXPIRED.
    2. Employees left with no ACTIVE contract get their latest valid RENEWED
       contract promoted to ACTIVE (covers expiry, termination, or deletion).

    Idempotent; safe to run from any scheduler or on request. Returns the
    number of contracts transitioned. Never touches employee.employment_status.
    """
    today = timezone.localdate()
    expired = EmployeeContract.objects.filter(
        status='ACTIVE', end_date__isnull=False, end_date__lt=today
    )
    count = expired.update(status='EXPIRED', updated_at=timezone.now())

    # Promote RENEWED → ACTIVE for any employee with no current contract.
    emp_ids = (
        EmployeeContract.objects.filter(
            status='RENEWED',
            start_date__lte=today,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
        .exclude(employee__contracts__status='ACTIVE')
        .values_list('employee_id', flat=True)
        .distinct()
    )
    for emp_id in emp_ids:
        contract = (
            EmployeeContract.objects.filter(
                employee_id=emp_id,
                status='RENEWED',
                start_date__lte=today,
            )
            .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
            .order_by('-start_date', '-id')
            .first()
        )
        if contract:
            contract.status = 'ACTIVE'
            contract.save(update_fields=['status', 'updated_at'])
            count += 1
    return count


def set_current_contract(contract):
    """Make `contract` the current contract for its employee.

    If the employee already has an ACTIVE contract that has not expired yet,
    the new contract is marked RENEWED instead — it becomes ACTIVE later via
    sync_contract_status once the current one expires. Otherwise it becomes
    ACTIVE and any other ACTIVE contract is demoted to RENEWED.
    """
    today = timezone.localdate()
    with transaction.atomic():
        has_unexpired_active = EmployeeContract.objects.filter(
            employee=contract.employee,
            status='ACTIVE',
        ).filter(Q(end_date__isnull=True) | Q(end_date__gte=today)).exclude(pk=contract.pk).exists()
        if has_unexpired_active:
            contract.status = 'RENEWED'
            contract.save(update_fields=['status', 'updated_at'])
            return
        EmployeeContract.objects.filter(
            employee=contract.employee, status='ACTIVE'
        ).exclude(pk=contract.pk).update(status='RENEWED', updated_at=timezone.now())
        contract.status = 'ACTIVE'
        contract.save(update_fields=['status', 'updated_at'])
