from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from apps.leaves.models import LeaveRequest
from apps.personnel.models import Employee
from apps.reimbursement.models import Reimbursement

from .models import Payroll, PayrollComponent, PayrollItem, PayrollPeriod, SalaryStructure


def _effective_structure(employee, on_date):
    """SalaryStructure covering `on_date` (None end = open-ended)."""
    return SalaryStructure.objects.filter(
        employee=employee,
        is_active=True,
        effective_from__lte=on_date,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=on_date),
    ).order_by('-effective_from').first()


def _unpaid_leave_data(employee, period_start, period_end):
    """Approved unpaid-leave days within the period (read-only from Leave module).

    Tahap 2 does NOT compute the monetary deduction (formula lives in the
    Calculation Engine phase) — we only snapshot the data so it can be filled
    later.
    """
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
    if total_days == 0:
        return []
    return [{
        'code': 'UNPAID_LEAVE',
        'name': 'Cuti Tidak Dibayar',
        'category': PayrollComponent.Category.DEDUCTION,
        'amount': Decimal('0'),
        'source': PayrollItem.Source.SYSTEM,
        'description': f'{total_days} hari cuti tidak dibayar (dihitung di engine)',
    }]


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


def _summarize(employee, period, structure):
    """Build items dict + totals for one employee (no DB writes)."""
    basic = structure.basic_salary if structure else Decimal('0')

    fixed_total = Decimal('0')
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
            })

    # Re-read manual items from DB (persisted across recalcs).
    manual_items = []
    variable_total = Decimal('0')
    deduction_total = Decimal('0')
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
    reimb_total = Decimal('0')
    for item in _approved_reimbursements(employee, period.period_start, period.period_end):
        amount = Decimal(str(item['amount']))
        reimb_total += amount
        reimb_items.append(item)

    unpaid_items = _unpaid_leave_data(employee, period.period_start, period.period_end)

    gross = basic + fixed_total + variable_total + reimb_total
    net = gross - deduction_total

    return {
        'basic_salary': basic,
        'total_fixed_earning': fixed_total,
        'total_variable_earning': variable_total,
        'total_deduction': deduction_total,
        'reimbursement_total': reimb_total,
        'gross_salary': gross,
        'net_salary': net,
        'items': fixed_items + manual_items + reimb_items + unpaid_items,
    }


def refresh_payroll_totals(payroll):
    """Recalc a single payroll's totals from its items (used when HR edits manual items)."""
    variable_total = Decimal('0')
    deduction_total = Decimal('0')
    for it in payroll.items.filter(source=PayrollItem.Source.MANUAL):
        if it.category == PayrollComponent.Category.DEDUCTION:
            deduction_total += it.amount
        else:
            variable_total += it.amount
    payroll.total_variable_earning = variable_total
    payroll.total_deduction = deduction_total
    payroll.gross_salary = (
        payroll.basic_salary
        + payroll.total_fixed_earning
        + variable_total
        + payroll.reimbursement_total
    )
    payroll.net_salary = payroll.gross_salary - deduction_total
    payroll.save()
    return payroll


def calculate_period(period):
    """(Re)calculate all payrolls for a period from DRAFT.

    Preserves MANUAL items across recalculation.
    """
    if period.status != PayrollPeriod.Status.DRAFT:
        raise ValidationError('Hanya periode status DRAFT yang dapat dihitung ulang.')

    with transaction.atomic():
        for employee in Employee.objects.all():
            structure = _effective_structure(employee, period.period_start)
            data = _summarize(employee, period, structure)

            keras = period.payrolls.filter(employee=employee)
            if keras.exists():
                payroll = keras.first()
                for fld in ('basic_salary', 'total_fixed_earning', 'total_variable_earning',
                            'total_deduction', 'reimbursement_total', 'gross_salary', 'net_salary'):
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