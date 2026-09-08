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


def contract_accumulation(employee):
    """Sum contract durations from the first contract up to (and including) the
    current one, merging overlapping periods so they are not double-counted.

    Returns a dict: {months, display, current_id, contracts:[{id, duration_months, duration_display, overlap}]}.
    `overlap` flags contracts whose period is fully inside an already-counted span.
    """
    contracts = list(
        employee.contracts.filter(deleted_at__isnull=True)
        .exclude(start_date__isnull=True)
        .order_by('start_date', 'id')
    )
    today = timezone.localdate()
    counted_end = None  # end of the running merged span
    total = 0
    current_id = None
    result = []
    for c in contracts:
        end = c.end_date
        if end is None or end > today:
            end = today
        # Running contract = the latest one whose span reaches today.
        if c.end_date is None or c.end_date >= today:
            current_id = c.id
        # Skip zero/negative spans.
        if end < c.start_date:
            result.append({
                'id': c.id,
                'duration_months': 0,
                'duration_display': '0 bulan',
                'overlap': False,
            })
            continue
        if counted_end is None:
            # First span: count full length.
            counted_end = end
            total += c.duration_months
            result.append({
                'id': c.id,
                'duration_months': c.duration_months,
                'duration_display': c.duration_display,
                'overlap': False,
            })
        elif end <= counted_end:
            # Fully inside the already-counted span → no double count.
            result.append({
                'id': c.id,
                'duration_months': c.duration_months,
                'duration_display': c.duration_display,
                'overlap': True,
            })
        else:
            # Extends beyond counted span: count only the new tail.
            added = (end.year - counted_end.year) * 12 + (end.month - counted_end.month)
            if end.day < counted_end.day:
                added -= 1
            counted_end = end
            total += max(added, 0)
            result.append({
                'id': c.id,
                'duration_months': c.duration_months,
                'duration_display': c.duration_display,
                'overlap': False,
            })
    years, rem = divmod(total, 12)
    parts = []
    if years:
        parts.append(f'{years} tahun' if years > 1 else '1 tahun')
    if rem:
        parts.append(f'{rem} bulan')
    return {
        'months': total,
        'display': ' '.join(parts) if parts else '0 bulan',
        'current_id': current_id,
        'contracts': result,
    }
