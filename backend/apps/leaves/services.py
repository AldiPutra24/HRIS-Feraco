"""Leave workflow helpers — balance accounting and in-app notifications."""
from datetime import date

from django.db import transaction
from django.utils import timezone

from .models import LeaveBalance, LeaveNotification, LeaveType


ANNUAL_CODE = 'ANNUAL'
CARRY_FORWARD_MAX = 3
BASIC_QUOTA = 12


def _eligible_date(join_date):
    """Eligibility date = join_date + exactly 3 calendar months (day-precision).

    Join 15 Des 2025 -> eligible 15 Mar 2026. Uses a safe month-add that
    clamps day overflow (e.g. 31 Aug + 3 months -> 30 Nov).
    """
    month_index = join_date.month - 1 + 3
    year = join_date.year + month_index // 12
    month = month_index % 12 + 1
    # Clamp day to the last day of the target month.
    if month == 12:
        last_day = 31
    else:
        last_day = (date(year, month + 1, 1) - date(year, month, 1)).days
    return date(year, month, min(join_date.day, last_day))


def _add_months(d, n):
    """Add n calendar months to a date, clamping the day to the target month end."""
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    if month == 12:
        last_day = 31
    else:
        last_day = (date(year, month + 1, 1) - date(year, month, 1)).days
    return date(year, month, min(d.day, last_day))


def _inclusive_months(start, end):
    """Whole months covered by [start, end] (1-indexed months of service).

    Counts complete month boundaries from `start` fully contained in `end`:
    1 Aug..31 Dec -> 5; 1 Jan..30 Jun -> 6; 15 Des..5 Mar -> 2 (whole Dec..Feb).
    """
    if end < start:
        return 0
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day >= start.day:
        months += 1
    return max(months, 0)


def _effective_end(employee, year):
    """Effective employment end for `year`: contract end if the (current or
    last) contract ends within the year, else Dec 31 of the year."""
    from apps.personnel.models import EmployeeContract

    end_of_year = date(year, 12, 31)
    contract = (
        EmployeeContract.objects.filter(employee=employee, start_date__lte=end_of_year)
        .order_by('-start_date')
        .first()
    )
    if contract:
        end = contract.end_date or contract.termination_date
        if end is not None and date(year, 1, 1) <= end <= end_of_year:
            return end
    return end_of_year


def _cumulative_service_months(employee, up_to=None):
    """Total months worked across ALL contracts (join_date -> up_to, default today).

    Uses join_date as the authoritative start of employment, so gaps between
    consecutive PKWTs do not reduce the accumulation.
    """
    if up_to is None:
        up_to = timezone.localdate()
    if employee.join_date is None:
        return 0
    return _inclusive_months(employee.join_date, up_to)


def compute_annual_quota(employee, year):
    """Centralized Cuti Tahunan quota computation for `employee` in `year`.

    Policy:
      1. Eligible after exactly 3 months since join_date (day-precision).
      2. First-year quota = months from the eligibility month through December
         (or through the contract end month if the contract ends earlier),
         1 month = 1 day.
      3. Subsequent years = duration of the contract active in that year,
         1 month = 1 day; if cumulative service across all contracts since
         join >= 12 months, the basic quota is 12 days (never less for the
         months reason alone).
      4. Carry-forward (max 3 days) is added by `get_balance`, not here.

    Returns 0 before eligibility. None-cutoff: employees with no join_date
    get the flat basic quota (legacy behavior, e.g. seeded admin records).
    """
    if employee.join_date is None:
        return BASIC_QUOTA

    join = employee.join_date
    eligible = _eligible_date(join)
    if eligible.year > year:
        return 0  # not yet eligible

    effective_end = _effective_end(employee, year)
    start_of_year = max(date(year, 1, 1), eligible)
    if effective_end < start_of_year:
        return 0

    # First eligible year: eligible month..December (or contract end) x 1 day.
    if eligible.year == year:
        months = _inclusive_months(start_of_year, effective_end)
        return min(months, BASIC_QUOTA)

    # Later years: quota = duration of the contract active in this year,
    # clipped to the year (and to the eligibility date for late-year hires
    # whose eligibility falls into this year), 1 month = 1 day.
    from apps.personnel.models import EmployeeContract

    contract = (
        EmployeeContract.objects.filter(employee=employee, start_date__lte=effective_end)
        .order_by('-start_date')
        .first()
    )
    if contract:
        c_start = max(contract.start_date, start_of_year)
        c_end = effective_end
        if contract.end_date or contract.termination_date:
            c_end = min(c_end, contract.end_date or contract.termination_date)
        months = _inclusive_months(c_start, c_end) if c_end >= c_start else 0
    else:
        months = _inclusive_months(start_of_year, effective_end)

    # Cumulative service across all contracts >= 12 months -> basic 12.
    if _cumulative_service_months(employee, effective_end) >= 12:
        return BASIC_QUOTA

    return max(min(months, BASIC_QUOTA), 0)


def compute_total_days(start_date, end_date):
    """Inclusive day count between two dates (min 1)."""
    if end_date < start_date:
        return 0
    return (end_date - start_date).days + 1


def get_balance(employee, leave_type, year):
    """Fetch or lazily create the balance row for an employee/type/year.

    For Cuti Tahunan the allocation follows the centralized quota policy
    (`compute_annual_quota`): eligibility after 3 months, first-year proration
    to December/contract end, contract-duration quota later, basic 12 once
    cumulative service >= 12 months.

    On first creation, carries forward up to `carry_forward_max` unused days
    from the previous year's balance (e.g. Cuti Tahunan carry-forward).
    """
    if leave_type.code == ANNUAL_CODE:
        allocated = compute_annual_quota(employee, year)
    else:
        allocated = leave_type.default_quota
    defaults = {
        'allocated_days': allocated,
        'used_days': 0,
        'remaining_days': allocated,
    }
    balance, created = LeaveBalance.objects.get_or_create(
        employee=employee,
        leave_type=leave_type,
        year=year,
        defaults=defaults,
    )
    if created and leave_type.carry_forward_max:
        prev = LeaveBalance.objects.filter(
            employee=employee, leave_type=leave_type, year=year - 1,
        ).first()
        if prev and prev.remaining_days > 0:
            carry = min(prev.remaining_days, leave_type.carry_forward_max)
            balance.allocated_days += carry
            balance.remaining_days += carry
            balance.save(update_fields=['allocated_days', 'remaining_days'])
    return balance


@transaction.atomic
def apply_approval_deduction(leave_request):
    """Deduct quota exactly once when a request becomes APPROVED.

    Idempotent via `balance_deducted` flag: re-processing never double-counts.
    Types with `deducts_from` (e.g. Cuti Berobat) deduct from that target
    type's balance (Cuti Tahunan).
    """
    if leave_request.balance_deducted:
        return get_balance(leave_request.employee, leave_request.leave_type, leave_request.start_date.year)
    target_type = leave_request.leave_type.deducts_from or leave_request.leave_type
    balance = get_balance(leave_request.employee, target_type, leave_request.start_date.year)
    balance.refresh_from_db()
    if balance.allocated_days == 0:
        # Unlimited quota types skip deduction entirely.
        leave_request.balance_deducted = True
        leave_request.save(update_fields=['balance_deducted', 'updated_at'])
        return balance
    balance.used_days += leave_request.total_days
    balance.remaining_days = balance.allocated_days - balance.used_days
    balance.save(update_fields=['used_days', 'remaining_days'])
    leave_request.balance_deducted = True
    leave_request.save(update_fields=['balance_deducted', 'updated_at'])
    return balance


def notify(recipient, leave_request, message):
    """Create an in-app notification record (no external integration)."""
    if recipient is None:
        return None
    return LeaveNotification.objects.create(
        recipient=recipient,
        leave_request=leave_request,
        message=message,
    )
