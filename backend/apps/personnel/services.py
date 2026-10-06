"""Contract status lifecycle — the single source of truth for status transitions."""
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import EmployeeContract, months_between, months_display


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
    """Accumulated contract period (masa kontrak) up to today.

    Rules:
    - Only real periods count: DRAFT contracts and contracts that have not
      started yet (start_date > today, e.g. a prepared renewal) are excluded.
    - A TERMINATED contract ends at its termination_date.
    - The running contract counts up to today (not its planned future end).
    - Periods are merged first (overlapping or back-to-back contracts form one
      span) and each span is converted to months once — no double counting
      and no extra month from rounding each short contract separately. Gaps
      between contracts are not counted.

    Returns {months, display, current_id, contracts:[{id, duration_months,
    duration_display, overlap, counted}]}. Per-contract duration is the
    contract's own length; `overlap` flags a counted contract fully inside an
    earlier span; `counted` is False for DRAFT / not-yet-started contracts.
    """
    contracts = list(
        employee.contracts.filter(deleted_at__isnull=True)
        .exclude(start_date__isnull=True)
        .order_by('start_date', 'id')
    )
    today = timezone.localdate()
    spans = []  # merged [start, end] periods
    current_id = None
    result = []
    for c in contracts:
        row = {
            'id': c.id,
            'duration_months': c.duration_months,
            'duration_display': c.duration_display,
            'overlap': False,
            'counted': True,
        }
        result.append(row)
        if c.status == 'DRAFT' or c.start_date > today:
            row['counted'] = False
            continue
        real_end = c.effective_end_date
        if real_end is None or real_end >= today:
            current_id = c.id  # running contract
        end = min(real_end or today, today)
        if end < c.start_date:
            row['counted'] = False
            continue
        if spans and c.start_date <= spans[-1][1] + timedelta(days=1):
            # Overlapping or back-to-back with the previous span: merge.
            if end <= spans[-1][1]:
                row['overlap'] = c.start_date <= spans[-1][1]
            spans[-1][1] = max(spans[-1][1], end)
        else:
            spans.append([c.start_date, end])
    total = sum(months_between(start, end) for start, end in spans)
    return {
        'months': total,
        'display': months_display(total),
        'current_id': current_id,
        'contracts': result,
    }
