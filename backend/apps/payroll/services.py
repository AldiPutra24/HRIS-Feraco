import calendar
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.leaves.models import LeaveRequest
from apps.personnel.models import Employee
from apps.reimbursement.models import Reimbursement

from . import tax as tax_mod
from .models import (
    EmployeeTaxProfile,
    Payroll,
    PayrollComponent,
    PayrollItem,
    PayrollPeriod,
    SalaryStructure,
)

ZERO = Decimal('0')
DAYS_IN_MONTH_DENOM = Decimal('30')  # gaji/30 convention (agreed with PO)


def _effective_structure(employee, on_date):
    """SalaryStructure covering `on_date` (None end = open-ended)."""
    return SalaryStructure.objects.filter(
        employee=employee,
        is_active=True,
        effective_from__lte=on_date,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=on_date),
    ).order_by('-effective_from').first()


def _unpaid_leave_days(employee, period_start, period_end):
    """Approved unpaid-leave days overlapping the period."""
    qs = LeaveRequest.objects.filter(
        employee=employee,
        status='APPROVED',
        start_date__lte=period_end,
        end_date__gte=period_start,
        leave_type__is_paid=False,
    )
    total_days = 0
    for req in qs:
        start = max(req.start_date, period_start)
        end = min(req.end_date, period_end)
        total_days += (end - start).days + 1
    return total_days


def _unpaid_leave_item(days):
    return {
        'code': 'UNPAID_LEAVE',
        'name': 'Cuti Tidak Dibayar',
        'category': PayrollComponent.Category.DEDUCTION,
        'amount': ZERO,
        'source': PayrollItem.Source.SYSTEM,
        'description': f'{days} hari cuti tidak dibayar',
    }


def _approved_reimbursements(employee, period_start, period_end):
    """APPROVED reimbursements whose transaction date falls in the period."""
    qs = Reimbursement.objects.filter(
        employee=employee,
        status='APPROVED',
        transaction_date__gte=period_start,
        transaction_date__lte=period_end,
    ).select_related('category')
    out = []
    for r in qs:
        out.append({
            'code': f'REIMBURSEMENT_{r.category.code}',
            'name': f'Reimbursement {r.category.name}',
            'category': PayrollComponent.Category.EARNING_VARIABLE,
            'amount': r.approved_amount if r.approved_amount is not None else r.amount,
            'source': PayrollItem.Source.SYSTEM,
            'description': f'Reimbursement disetujui #{r.id}',
        })
    return out


def _component_available(code):
    return PayrollComponent.objects.filter(code=code, is_active=True).first()


def _employment_window(employee, period_start, period_end):
    """Clamp (start, end) of paid employment within the period.

    Join date prorates the first month. End of employment comes from
    EmployeeContract.termination_date (latest TERMINATED contract) when the
    employee is INACTIVE; INACTIVE without a termination date is not payable.
    Returns None when the employee has no payable window in the period.
    """
    start = period_start
    if employee.join_date and employee.join_date > period_start:
        start = employee.join_date

    end = period_end
    if employee.employment_status != 'ACTIVE':
        term_dates = [
            c.termination_date for c in employee.contracts.filter(
                status='TERMINATED', termination_date__isnull=False,
            )
        ]
        if not term_dates:
            return None
        term_date = max(term_dates)
        if term_date < period_start:
            return None  # employment already ended before this period
        end = min(term_date, period_end)
    if start > end:
        return None
    return start, end


def _pro_rata_factor(window, period_start, period_end):
    """Paid calendar days / days in month, capped at 1 (PRD Section 5 example)."""
    start, end = window
    if start == period_start and end == period_end:
        return Decimal('1')
    paid_days = Decimal((end - start).days + 1)
    if paid_days <= 0:
        return ZERO
    days_in_month = Decimal(calendar.monthrange(period_end.year, period_end.month)[1])
    return min(paid_days / days_in_month, Decimal('1'))


def _month_pph_items_sum(employee, year, months):
    """Sum of SYSTEM PPh21 item amounts for the given months (December true-up)."""
    total = ZERO
    qs = PayrollItem.objects.filter(
        payroll__period__period_year=year,
        payroll__period__period_month__in=months,
        payroll__employee=employee,
        component_code='PPh21',
        source=PayrollItem.Source.SYSTEM,
    )
    for it in qs:
        total += it.amount
    return total


def _summarize(employee, period, structure, config, tax_profile):
    """Build items dict + totals for one employee (no DB writes)."""
    period_start, period_end = period.period_start, period.period_end
    window = _employment_window(employee, period_start, period_end)
    if window is None:
        return None
    pro_rata = _pro_rata_factor(window, period_start, period_end)

    basic_full = structure.basic_salary if structure else ZERO
    basic = (basic_full * pro_rata).quantize(Decimal('1'))

    fixed_total = ZERO
    fixed_items = []
    if structure:
        for comp in structure.components or []:
            comp_obj = PayrollComponent.objects.filter(
                code=comp.get('code'),
                category=PayrollComponent.Category.EARNING_FIXED,
            ).first()
            if not comp_obj:
                continue
            amount = Decimal(str(comp.get('amount') or 0))
            fixed_total += amount
            fixed_items.append({
                'code': comp_obj.code, 'name': comp_obj.name,
                'category': comp_obj.category, 'amount': amount,
                'source': PayrollItem.Source.SYSTEM,
                'description': 'Dari salary structure',
                'is_taxable': comp_obj.is_taxable,
            })

    # Re-read manual items from DB (persisted across recalcs).
    manual_items = []
    variable_total = ZERO
    deduction_total = ZERO
    for it in PayrollItem.objects.filter(
        payroll__period=period, payroll__employee=employee,
        source=PayrollItem.Source.MANUAL,
    ):
        if it.category == PayrollComponent.Category.DEDUCTION:
            deduction_total += it.amount
        else:
            variable_total += it.amount
        manual_items.append({
            'code': it.component_code, 'name': it.component_name,
            'category': it.category, 'amount': it.amount,
            'source': PayrollItem.Source.MANUAL,
            'description': it.description,
        })

    reimb_items = []
    reimb_total = ZERO
    for item in _approved_reimbursements(employee, period_start, period_end):
        amount = Decimal(str(item['amount']))
        reimb_total += amount
        reimb_items.append(item)

    # Unpaid leave: monetary deduction (basic + fixed)/30 x days (PO decision).
    unpaid_days = _unpaid_leave_days(employee, period_start, period_end)
    unpaid_items = []
    if unpaid_days > 0:
        daily = (basic_full + fixed_total) / DAYS_IN_MONTH_DENOM
        unpaid_amount = (daily * unpaid_days).quantize(Decimal('1'))
        deduction_total += unpaid_amount
        item = _unpaid_leave_item(unpaid_days)
        item['amount'] = unpaid_amount
        unpaid_items.append(item)

    gross = basic + fixed_total + variable_total + reimb_total
    net = gross - deduction_total

    # --- PPh 21 via TER (Jan-Nov); December carries prior months (3b refines) ---
    pph = ZERO
    ter_category = ''
    ptkp_status = tax_profile.ptkp_status if tax_profile else 'TK/0'
    if gross > 0 and pro_rata > 0:
        # Taxable base excludes is_taxable=False components (PRD 4.2 "Kena Pajak?").
        taxable_fixed = sum(
            (it['amount'] for it in fixed_items if it.get('is_taxable', True)), ZERO,
        )
        taxable_earnings = basic + taxable_fixed + variable_total
        pph, ter_category, _rate = tax_mod.compute_monthly_pph21(
            config, ptkp_status, taxable_earnings,
        )
        if period.period_month == 12:
            prior = _month_pph_items_sum(employee, period.period_year, range(1, 12))
            pph = pph + prior

    pph_item = None
    if pph > 0:
        pph_item = {
            'code': 'PPh21',
            'name': 'Potongan Pajak (PPh 21)',
            'category': PayrollComponent.Category.DEDUCTION,
            'amount': pph,
            'source': PayrollItem.Source.SYSTEM,
            'description': f'PPh 21 TER {ter_category} ({ptkp_status})',
        }
        deduction_total += pph
        net = net - pph

    # DTP (PRD 6.2): THP <= threshold -> PPh printed but NOT taken from transfer.
    transfer_amount = net
    is_dtp = False
    if pph > 0 and net <= config.dtp_threshold:
        is_dtp = True
        transfer_amount = net + pph

    return {
        'basic_salary': basic,
        'total_fixed_earning': fixed_total,
        'total_variable_earning': variable_total,
        'total_deduction': deduction_total,
        'reimbursement_total': reimb_total,
        'gross_salary': gross,
        'net_salary': net,
        'pro_rata_factor': pro_rata,
        'unpaid_leave_days': unpaid_days,
        'ptkp_status_snapshot': ptkp_status,
        'ter_category_snapshot': ter_category,
        'is_dtp': is_dtp,
        'transfer_amount': transfer_amount,
        'items': fixed_items + manual_items + reimb_items + unpaid_items
        + ([pph_item] if pph_item else []),
    }


def refresh_payroll_totals(payroll):
    """Recalc totals after HR edits manual items.

    Engine-owned SYSTEM deductions (PPh 21, unpaid leave) are preserved inside
    total_deduction; the DTP transfer split uses the stored is_dtp flag. A full
    calculate_period run recomputes everything from scratch.
    """
    variable_total = ZERO
    manual_deduction = ZERO
    system_deduction = ZERO
    pph_system = ZERO
    for it in payroll.items.all():
        if it.category != PayrollComponent.Category.DEDUCTION:
            if it.source == PayrollItem.Source.MANUAL:
                variable_total += it.amount
            continue
        if it.source == PayrollItem.Source.MANUAL:
            manual_deduction += it.amount
        else:
            system_deduction += it.amount
            if it.component_code == 'PPh21':
                pph_system += it.amount
    payroll.total_variable_earning = variable_total
    payroll.total_deduction = manual_deduction + system_deduction
    payroll.gross_salary = (
        payroll.basic_salary
        + payroll.total_fixed_earning
        + variable_total
        + payroll.reimbursement_total
    )
    payroll.net_salary = payroll.gross_salary - payroll.total_deduction
    if payroll.is_dtp:
        payroll.transfer_amount = payroll.net_salary + pph_system
    else:
        payroll.transfer_amount = payroll.net_salary
    payroll.save()
    return payroll


def calculate_period(period):
    """(Re)calculate all payrolls for a period from DRAFT.

    Preserves MANUAL items across recalculation.
    """
    if period.status != PayrollPeriod.Status.DRAFT:
        raise ValidationError('Hanya periode status DRAFT yang dapat dihitung ulang.')

    try:
        config = tax_mod.get_active_config(period.period_year)
    except tax_mod.TaxConfigError as exc:
        raise ValidationError(str(exc))

    with transaction.atomic():
        # ACTIVE employees plus recently-terminated employees (INACTIVE with a
        # TERMINATED contract ending inside/after the period) get final pay.
        employees = Employee.objects.filter(
            Q(employment_status='ACTIVE')
            | Q(
                contracts__status='TERMINATED',
                contracts__termination_date__gte=period.period_start,
            )
        ).distinct()
        for employee in employees:
            structure = _effective_structure(employee, period.period_start)
            tax_profile = EmployeeTaxProfile.objects.filter(employee=employee).first()
            data = _summarize(employee, period, structure, config, tax_profile)
            if data is None:
                continue  # not payable in this window (e.g. ended before period)

            existing = period.payrolls.filter(employee=employee)
            if existing.exists():
                payroll = existing.first()
                for fld in ('basic_salary', 'total_fixed_earning', 'total_variable_earning',
                            'total_deduction', 'reimbursement_total', 'gross_salary', 'net_salary',
                            'pro_rata_factor', 'unpaid_leave_days', 'ptkp_status_snapshot',
                            'ter_category_snapshot', 'is_dtp', 'transfer_amount'):
                    setattr(payroll, fld, data[fld])
                payroll.save()
            else:
                payroll = Payroll.objects.create(period=period, employee=employee, **{
                    k: v for k, v in data.items() if k != 'items'
                })

            # Replace only SYSTEM items.
            payroll.items.filter(source=PayrollItem.Source.SYSTEM).delete()
            for item in data['items']:
                if item['source'] == PayrollItem.Source.MANUAL:
                    continue  # already persisted
                PayrollItem.objects.create(
                    payroll=payroll,
                    payroll_component=_component_available(item['code']),
                    component_name=item['name'], component_code=item['code'],
                    category=item['category'], amount=item['amount'],
                    source=item['source'], description=item.get('description', ''),
                )
    return period.payrolls.select_related('employee').all()