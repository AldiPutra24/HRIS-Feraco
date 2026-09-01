"""Leave workflow helpers — balance accounting and in-app notifications."""
from django.db import transaction
from django.utils import timezone

from .models import LeaveBalance, LeaveNotification


def compute_total_days(start_date, end_date):
    """Inclusive day count between two dates (min 1)."""
    if end_date < start_date:
        return 0
    return (end_date - start_date).days + 1


def get_balance(employee, leave_type, year):
    """Fetch or lazily create the balance row for an employee/type/year.

    On first creation, carries forward up to `carry_forward_max` unused days
    from the previous year's balance (e.g. Cuti Tahunan carry-forward).
    """
    defaults = {
        'allocated_days': leave_type.default_quota,
        'used_days': 0,
        'remaining_days': leave_type.default_quota,
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
