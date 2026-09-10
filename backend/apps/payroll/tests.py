import json
from datetime import date

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.leaves.models import LeaveRequest, LeaveType
from apps.personnel.models import Employee
from apps.reimbursement.models import Reimbursement, ReimbursementCategory

from .models import (
    EmployeeTaxProfile,
    Payroll,
    PayrollComponent,
    PayrollItem,
    PayrollPeriod,
    SalaryStructure,
    TaxConfig,
    TerBracket,
)
from .services import calculate_period

User = get_user_model()


def make_tax_config(year=2026, rate='0', threshold='10000000', is_active=True):
    """Minimal active TER table: one bracket 0..inf per category at `rate` %."""
    config = TaxConfig.objects.create(
        year=year, is_active=is_active, dtp_threshold=threshold,
    )
    for category in ('A', 'B', 'C'):
        TerBracket.objects.create(
            tax_config=config, ter_category=category,
            bruto_lower=0, bruto_upper=None, rate_pct=rate,
        )
    return config


def make_user(key, username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class PayrollComponentTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)

    def test_list_components(self):
        PayrollComponent.objects.create(code='BASIC', name='Gaji Pokok', category='EARNING_FIXED')
        res = self.client.get(reverse('payroll-component-list'))
        self.assertEqual(res.status_code, 200)
        codes = [c['code'] for c in res.json()]
        self.assertIn('BASIC', codes)

    def test_create_component(self):
        payload = {
            'code': 'TEST',
            'name': 'Test Component',
            'category': 'EARNING_FIXED',
            'calculation_type': 'FIXED_AMOUNT',
            'default_amount': '100000',
            'description': 'test',
        }
        res = self.client.post(reverse('payroll-component-list'), payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(PayrollComponent.objects.count(), 1)

    def test_create_component_non_admin_forbidden(self):
        emp = make_user('EMPLOYEE', 'emp@test.com')
        self.client.force_login(emp)
        payload = {'code': 'TEST', 'name': 'Test', 'category': 'EARNING_FIXED'}
        res = self.client.post(reverse('payroll-component-list'), payload, format='json')
        self.assertEqual(res.status_code, 403)

    def test_management_can_read_components(self):
        PayrollComponent.objects.create(code='BASIC', name='Gaji Pokok', category='EARNING_FIXED')
        mgmt = make_user('MANAGEMENT', 'mgmt@test.com')
        self.client.force_login(mgmt)
        res = self.client.get(reverse('payroll-component-list'))
        self.assertEqual(res.status_code, 200)

    def test_seed_idempotent(self):
        from django.core.management import call_command
        call_command('seed_payroll_components')
        count = PayrollComponent.objects.count()
        self.assertGreater(count, 0)
        call_command('seed_payroll_components')
        self.assertEqual(PayrollComponent.objects.count(), count)


class SalaryStructureTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )

    def test_create_salary_structure(self):
        payload = {
            'employee': self.emp.id,
            'effective_from': '2026-01-01',
            'basic_salary': '5000000',
            'components': [],
        }
        res = self.client.post(reverse('salary-structure-list'), payload, format='json')
        self.assertEqual(res.status_code, 201)
        ss = SalaryStructure.objects.first()
        self.assertEqual(ss.basic_salary, 5000000)

    def test_overlap_rejected(self):
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=4000000,
        )
        payload = {
            'employee': self.emp.id,
            'effective_from': '2026-06-01',
            'basic_salary': '5000000',
            'components': [],
        }
        res = self.client.post(reverse('salary-structure-list'), payload, format='json')
        # Different effective_from with no effective_to on first => overlap.
        self.assertEqual(res.status_code, 400)
        self.assertIn('tumpang tindih', str(res.data))

    def test_non_overlap_allowed(self):
        ss = SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2025, 1, 1),
            effective_to=date(2025, 12, 31), basic_salary=4000000,
        )
        payload = {
            'employee': self.emp.id,
            'effective_from': '2026-01-01',
            'basic_salary': '5000000',
            'components': [],
        }
        res = self.client.post(reverse('salary-structure-list'), payload, format='json')
        self.assertEqual(res.status_code, 201)

    def test_employee_self_service(self):
        emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp.user = emp_user
        self.emp.save()
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )
        self.client.force_login(emp_user)
        res = self.client.get(reverse('salary-structure-list'))
        self.assertEqual(res.status_code, 200)
        data = res.json() if isinstance(res.json(), list) else res.json().get('results', [])
        self.assertEqual(len(data), 1)

    def test_employee_cannot_see_others(self):
        other = Employee.objects.create(
            employee_id='E002', full_name='Jane', employment_status='ACTIVE',
        )
        SalaryStructure.objects.create(
            employee=other, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )
        emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp.user = emp_user
        self.emp.save()
        self.client.force_login(emp_user)
        res = self.client.get(reverse('salary-structure-list'))
        data = res.json() if isinstance(res.json(), list) else res.json().get('results', [])
        self.assertEqual(len(data), 0)

    def test_history_endpoint(self):
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2025, 1, 1), basic_salary=4000000,
        )
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )
        res = self.client.get(
            reverse('salary-structure-history', args=[self.emp.id])
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 2)

    def test_history_forbidden_non_hr(self):
        emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.client.force_login(emp_user)
        res = self.client.get(
            reverse('salary-structure-history', args=[self.emp.id])
        )
        self.assertEqual(res.status_code, 403)


class PayrollPeriodTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config()

    def payload(self, month=6, year=2026):
        return {
            'period_month': month,
            'period_year': year,
            'period_start': f'{year}-{month:02d}-01',
            'period_end': f'{year}-{month:02d}-30',
        }

    def test_create_period(self):
        res = self.client.post(reverse('payroll-period-list'), self.payload(), format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(PayrollPeriod.objects.count(), 1)
        self.assertEqual(PayrollPeriod.objects.first().status, 'DRAFT')

    def test_duplicate_month_year_rejected(self):
        self.client.post(reverse('payroll-period-list'), self.payload(), format='json')
        res = self.client.post(reverse('payroll-period-list'), self.payload(), format='json')
        self.assertEqual(res.status_code, 400)

    def test_transition_flow(self):
        period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        self.client.post(reverse('payroll-period-calculate', args=[period.id]))
        period.refresh_from_db()
        self.assertEqual(period.status, 'CALCULATED')
        self.client.post(reverse('payroll-period-review', args=[period.id]))
        period.refresh_from_db()
        self.assertEqual(period.status, 'REVIEW')
        self.client.post(reverse('payroll-period-approve', args=[period.id]))
        period.refresh_from_db()
        self.assertEqual(period.status, 'APPROVED')
        self.client.post(reverse('payroll-period-mark-paid', args=[period.id]))
        period.refresh_from_db()
        self.assertEqual(period.status, 'PAID')
        self.client.post(reverse('payroll-period-lock', args=[period.id]))
        period.refresh_from_db()
        self.assertEqual(period.status, 'LOCKED')

    def test_invalid_transition_rejected(self):
        period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        res = self.client.post(reverse('payroll-period-approve', args=[period.id]))
        self.assertEqual(res.status_code, 400)
        period.refresh_from_db()
        self.assertEqual(period.status, 'DRAFT')

    def test_destroy_not_locked(self):
        period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        res = self.client.delete(reverse('payroll-period-detail', args=[period.id]))
        self.assertEqual(res.status_code, 204)
        self.assertEqual(PayrollPeriod.objects.count(), 0)

    def test_non_hr_cannot_create(self):
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.post(reverse('payroll-period-list'), self.payload(), format='json')
        self.assertEqual(res.status_code, 403)

    def test_management_read_only(self):
        PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        self.client.force_login(make_user('MANAGEMENT', 'mgmt@test.com'))
        res = self.client.get(reverse('payroll-period-list'))
        self.assertEqual(res.status_code, 200)


class PayrollCalculateTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config()
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        self.comp_basic = PayrollComponent.objects.create(
            code='BASIC', name='Gaji Pokok', category='EARNING_FIXED',
            calculation_type='FIXED_AMOUNT', default_amount=5000000,
        )
        self.comp_fixed = PayrollComponent.objects.create(
            code='TUNJANGAN', name='Tunjangan', category='EARNING_FIXED',
            calculation_type='FIXED_AMOUNT', default_amount=1000000,
        )
        self.comp_var = PayrollComponent.objects.create(
            code='LEMBUR', name='Lembur', category='EARNING_VARIABLE',
            calculation_type='VARIABLE',
        )
        self.comp_deduct = PayrollComponent.objects.create(
            code='KASBON', name='Kasbon', category='DEDUCTION',
            calculation_type='VARIABLE',
        )
        self.period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )

    def _structure(self, basic=5000000, comps=None):
        return SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1),
            basic_salary=basic, components=comps or [],
        )

    def test_calculate_basic_and_fixed(self):
        self._structure(comps=[{'code': 'TUNJANGAN', 'name': 'Tunjangan', 'amount': '1000000'}])
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.basic_salary, 5000000)
        self.assertEqual(payroll.total_fixed_earning, 1000000)
        self.assertEqual(payroll.gross_salary, 6000000)
        self.assertEqual(payroll.net_salary, 6000000)

    def test_manual_variable_item(self):
        self._structure()
        # Add a manual variable item then calculate.
        payroll = Payroll.objects.create(
            period=self.period, employee=self.emp, basic_salary=5000000,
        )
        PayrollItem.objects.create(
            payroll=payroll, payroll_component=self.comp_var,
            component_name='Lembur', component_code='LEMBUR',
            category='EARNING_VARIABLE', amount=200000, source='MANUAL',
        )
        calculate_period(self.period)
        payroll.refresh_from_db()
        self.assertEqual(payroll.total_variable_earning, 200000)
        self.assertEqual(payroll.gross_salary, 5200000)

    def test_manual_deduction(self):
        self._structure()
        payroll = Payroll.objects.create(
            period=self.period, employee=self.emp, basic_salary=5000000,
        )
        PayrollItem.objects.create(
            payroll=payroll, payroll_component=self.comp_deduct,
            component_name='Kasbon', component_code='KASBON',
            category='DEDUCTION', amount=300000, source='MANUAL',
        )
        calculate_period(self.period)
        payroll.refresh_from_db()
        self.assertEqual(payroll.total_deduction, 300000)
        self.assertEqual(payroll.net_salary, 4700000)

    def test_reimbursement_approved_only(self):
        self._structure()
        cat = ReimbursementCategory.objects.create(code='MED', name='Medical')
        Reimbursement.objects.create(
            employee=self.emp, category=cat, transaction_date=date(2026, 6, 10),
            amount=500000, status='APPROVED',
        )
        Reimbursement.objects.create(
            employee=self.emp, category=cat, transaction_date=date(2026, 6, 11),
            amount=700000, status='PENDING',
        )
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.reimbursement_total, 500000)
        self.assertEqual(payroll.gross_salary, 5500000)

    def test_unpaid_leave_deduction(self):
        self._structure()
        leave_type = LeaveType.objects.create(name='Cuti Tidak Dibayar', code='UNPAID', is_paid=False)
        LeaveRequest.objects.create(
            employee=self.emp, leave_type=leave_type,
            start_date=date(2026, 6, 1), end_date=date(2026, 6, 3),
            total_days=3, status='APPROVED',
        )
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        items = payroll.items.filter(component_code='UNPAID_LEAVE')
        self.assertEqual(items.count(), 1)
        # (basic 5.000.000 + fixed 0) / 30 x 3 hari = 500.000
        self.assertEqual(items.first().amount, 500000)
        self.assertEqual(payroll.unpaid_leave_days, 3)
        self.assertEqual(payroll.total_deduction, 500000)
        self.assertEqual(payroll.net_salary, 4500000)
        self.assertIn('3 hari', items.first().description)

    def test_snapshot_frozen(self):
        self._structure(comps=[{'code': 'TUNJANGAN', 'name': 'Tunjangan', 'amount': '1000000'}])
        calculate_period(self.period)
        item = PayrollItem.objects.get(
            payroll__period=self.period, component_code='TUNJANGAN'
        )
        self.assertEqual(item.component_name, 'Tunjangan')
        # Rename component after calc; snapshot unchanged.
        self.comp_fixed.name = 'Tunjangan Baru'
        self.comp_fixed.save()
        item.refresh_from_db()
        self.assertEqual(item.component_name, 'Tunjangan')

    def test_recalculate_replaces_system_items_keeps_manual(self):
        self._structure(comps=[{'code': 'TUNJANGAN', 'name': 'Tunjangan', 'amount': '1000000'}])
        payroll = Payroll.objects.create(
            period=self.period, employee=self.emp, basic_salary=5000000,
        )
        PayrollItem.objects.create(
            payroll=payroll, payroll_component=self.comp_var,
            component_name='Lembur', component_code='LEMBUR',
            category='EARNING_VARIABLE', amount=200000, source='MANUAL',
        )
        calculate_period(self.period)
        self.assertEqual(
            PayrollItem.objects.filter(payroll__period=self.period, source='MANUAL').count(), 1
        )
        self.assertEqual(
            PayrollItem.objects.filter(payroll__period=self.period, source='SYSTEM').count(), 1
        )
        # Recalculate again → still 1 manual + system items replaced.
        calculate_period(self.period)
        self.assertEqual(
            PayrollItem.objects.filter(payroll__period=self.period, source='MANUAL').count(), 1
        )

    def test_no_salary_structure_zero_basic(self):
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.basic_salary, 0)
        self.assertEqual(payroll.gross_salary, 0)

    def test_employee_payroll_uniqueness(self):
        self._structure()
        calculate_period(self.period)
        self.assertEqual(Payroll.objects.filter(period=self.period).count(), 1)
        # Direct duplicate insert should be rejected by DB constraint.
        with self.assertRaises(Exception):
            Payroll.objects.create(
                period=self.period, employee=self.emp, basic_salary=0,
            )


class PayrollManualItemApiTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config()
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        self.comp_var = PayrollComponent.objects.create(
            code='BONUS', name='Bonus', category='EARNING_VARIABLE',
            calculation_type='VARIABLE',
        )
        self.period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )
        calculate_period(self.period)
        self.payroll = Payroll.objects.get(period=self.period, employee=self.emp)

    def test_add_manual_item_via_api(self):
        res = self.client.post(
            reverse('payroll-manual-item', args=[self.payroll.id]),
            {'component_code': 'BONUS', 'amount': '250000'}, format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.payroll.refresh_from_db()
        self.assertEqual(self.payroll.total_variable_earning, 250000)
        self.assertEqual(self.payroll.gross_salary, 5250000)

    def test_remove_manual_item(self):
        self.client.post(
            reverse('payroll-manual-item', args=[self.payroll.id]),
            {'component_code': 'BONUS', 'amount': '250000'}, format='json',
        )
        res = self.client.post(
            reverse('payroll-remove-manual-item', args=[self.payroll.id]),
            {'component_code': 'BONUS'}, format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.payroll.refresh_from_db()
        self.assertEqual(self.payroll.total_variable_earning, 0)

    def test_manual_item_locked_forbidden(self):
        for action in ('calculate', 'review', 'approve', 'mark-paid', 'lock'):
            self.client.post(reverse(f'payroll-period-{action}', args=[self.period.id]))
        self.period.refresh_from_db()
        self.assertEqual(self.period.status, 'LOCKED')
        res = self.client.post(
            reverse('payroll-manual-item', args=[self.payroll.id]),
            {'component_code': 'BONUS', 'amount': '100000'}, format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_non_hr_cannot_add_manual(self):
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.post(
            reverse('payroll-manual-item', args=[self.payroll.id]),
            {'component_code': 'BONUS', 'amount': '100000'}, format='json',
        )
        self.assertEqual(res.status_code, 403)


class ManagementPayrollScopeTests(TestCase):
    """MANAGEMENT sees ONLY their own payroll slips (never reports/others)."""

    def setUp(self):
        self.mgr_user = make_user('MANAGEMENT', 'mgr@test.com')
        self.mgr = Employee.objects.create(employee_id='M001', full_name='Manager', employment_status='ACTIVE')
        self.mgr.user = self.mgr_user
        self.mgr.save()
        self.rep = Employee.objects.create(
            employee_id='E001', full_name='Direct Report', employment_status='ACTIVE', manager=self.mgr
        )
        self.outsider = Employee.objects.create(employee_id='E002', full_name='Outsider', employment_status='ACTIVE')
        self.period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        self.payroll_mgr = Payroll.objects.create(
            period=self.period, employee=self.mgr,
            basic_salary=10000000, gross_salary=10000000, net_salary=10000000,
        )
        self.payroll_rep = Payroll.objects.create(
            period=self.period, employee=self.rep,
            basic_salary=5000000, gross_salary=5000000, net_salary=5000000,
        )
        self.payroll_out = Payroll.objects.create(
            period=self.period, employee=self.outsider,
            basic_salary=4000000, gross_salary=4000000, net_salary=4000000,
        )

    def test_management_sees_only_own_payroll(self):
        self.client.force_login(self.mgr_user)
        res = self.client.get(reverse('payroll-list'))
        self.assertEqual(res.status_code, 200)
        ids = {p['id'] for p in res.json()}
        self.assertIn(self.payroll_mgr.id, ids)
        self.assertNotIn(self.payroll_rep.id, ids)
        self.assertNotIn(self.payroll_out.id, ids)

    def test_management_own_payroll_detail_ok(self):
        self.client.force_login(self.mgr_user)
        res = self.client.get(reverse('payroll-detail', args=[self.payroll_mgr.id]))
        self.assertEqual(res.status_code, 200)

    def test_management_other_payroll_detail_404(self):
        self.client.force_login(self.mgr_user)
        for p in (self.payroll_rep, self.payroll_out):
            res = self.client.get(reverse('payroll-detail', args=[p.id]))
            self.assertEqual(res.status_code, 404)

    def test_management_filtered_by_report_employee_still_excluded(self):
        """?employee=<report id> must not leak the report's payroll."""
        self.client.force_login(self.mgr_user)
        res = self.client.get(reverse('payroll-list'), {'employee': self.rep.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), [])

    def test_hr_still_sees_all_payrolls(self):
        hr = make_user('HR_STAFF', 'hr@test.com')
        self.client.force_login(hr)
        res = self.client.get(reverse('payroll-list'))
        self.assertEqual(res.status_code, 200)
        ids = {p['id'] for p in res.json()}
        self.assertEqual(ids, {self.payroll_mgr.id, self.payroll_rep.id, self.payroll_out.id})


class EngineTahap3aTests(TestCase):
    """Tahap 3a engine: TER PPh 21, DTP split, pro-rata, ACTIVE-only, config guard."""

    def setUp(self):
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        self.period = PayrollPeriod.objects.create(
            period_month=6, period_year=2026,
            period_start=date(2026, 6, 1), period_end=date(2026, 6, 30),
        )
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )

    def test_inactive_config_blocks_calculate(self):
        make_tax_config(is_active=False)
        with self.assertRaises(ValidationError):
            calculate_period(self.period)
        self.assertEqual(Payroll.objects.count(), 0)

    def test_missing_config_blocks_calculate(self):
        # No TaxConfig at all for 2026.
        with self.assertRaises(ValidationError):
            calculate_period(self.period)

    def test_monthly_pph21_with_rate(self):
        # 1% flat over taxable 5.000.000 -> 50.000. Threshold 0 disables DTP
        # so this test isolates the TER computation.
        make_tax_config(rate='1', threshold='0')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.gross_salary, 5000000)
        self.assertEqual(payroll.total_deduction, 50000)
        self.assertEqual(payroll.net_salary, 4950000)
        self.assertFalse(payroll.is_dtp)
        self.assertEqual(payroll.transfer_amount, 4950000)
        self.assertEqual(payroll.ptkp_status_snapshot, 'TK/0')
        self.assertEqual(payroll.ter_category_snapshot, 'A')
        pph_item = payroll.items.get(component_code='PPh21')
        self.assertEqual(pph_item.source, 'SYSTEM')
        self.assertEqual(pph_item.amount, 50000)

    def test_zero_rate_no_pph(self):
        make_tax_config(rate='0')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertFalse(payroll.items.filter(component_code='PPh21').exists())
        self.assertEqual(payroll.net_salary, 5000000)

    def test_dtp_under_threshold(self):
        # 1% -> PPh 50.000, THP 4.950.000 <= 10 jt -> DTP: transfer = full THP + PPh.
        make_tax_config(rate='1', threshold='10000000')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertTrue(payroll.is_dtp)
        self.assertEqual(payroll.net_salary, 4950000)          # printed THP (slip)
        self.assertEqual(payroll.transfer_amount, 5000000)     # actually transferred

    def test_no_dtp_over_threshold(self):
        # THP 19.800.000 > 10 jt threshold -> DTP inactive, PPh really deducted.
        SalaryStructure.objects.filter(employee=self.emp).update(basic_salary=20000000)
        make_tax_config(rate='1', threshold='10000000')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertFalse(payroll.is_dtp)
        self.assertEqual(payroll.gross_salary, 20000000)
        self.assertEqual(payroll.total_deduction, 200000)
        self.assertEqual(payroll.net_salary, 19800000)
        self.assertEqual(payroll.transfer_amount, 19800000)

    def test_pro_rata_join_mid_month(self):
        # Join 10 Juni (21 of 30 days) -> basic = 5jt x 21/30 = 3.500.000.
        self.emp.join_date = date(2026, 6, 10)
        self.emp.save()
        make_tax_config(rate='1')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.basic_salary, 3500000)
        self.assertEqual(payroll.gross_salary, 3500000)

    def test_inactive_employee_excluded(self):
        Employee.objects.create(
            employee_id='E002', full_name='Old', employment_status='INACTIVE',
        )
        make_tax_config()
        calculate_period(self.period)
        self.assertEqual(
            Payroll.objects.filter(period=self.period).count(), 1,
            'Only the ACTIVE employee gets a payroll row',
        )

    def test_inactive_with_recent_termination_included(self):
        # INACTIVE employee whose contract terminated 20 Juni is paid 1-20 Juni.
        ex = Employee.objects.create(
            employee_id='E003', full_name='Ex', employment_status='INACTIVE',
        )
        from apps.personnel.models import EmployeeContract
        EmployeeContract.objects.create(
            employee=ex, contract_type='PKWT', contract_number='CTR-1',
            start_date=date(2025, 1, 1), status='TERMINATED',
            termination_date=date(2026, 6, 20),
        )
        SalaryStructure.objects.create(
            employee=ex, effective_from=date(2026, 1, 1), basic_salary=6000000,
        )
        make_tax_config()
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=ex)
        # 20/30 x 6.000.000 = 4.000.000
        self.assertEqual(payroll.basic_salary, 4000000)

    def test_is_taxable_false_excluded_from_base(self):
        comp = PayrollComponent.objects.create(
            code='ALLOW_TAX', name='Tunjangan Non-Kena Pajak',
            category='EARNING_FIXED', calculation_type='FIXED_AMOUNT',
            is_taxable=False,
        )
        SalaryStructure.objects.filter(employee=self.emp).update(
            basic_salary=5000000,
            components=[{'code': 'ALLOW_TAX', 'name': comp.name, 'amount': '2000000'}],
        )
        make_tax_config(rate='1')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.gross_salary, 7000000)
        # Taxable base excludes the non-taxable allowance: 1% x 5.000.000.
        self.assertEqual(payroll.items.get(component_code='PPh21').amount, 50000)

    def test_tax_profile_snapshot_and_category(self):
        EmployeeTaxProfile.objects.create(
            employee=self.emp, ptkp_status='K/2',
        )
        make_tax_config(rate='1')
        calculate_period(self.period)
        payroll = Payroll.objects.get(period=self.period, employee=self.emp)
        self.assertEqual(payroll.ptkp_status_snapshot, 'K/2')
        self.assertEqual(payroll.ter_category_snapshot, 'B')


def make_month_period(month, year=2026):
    import calendar as _cal
    last_day = _cal.monthrange(year, month)[1]
    return PayrollPeriod.objects.create(
        period_month=month, period_year=year,
        period_start=date(year, month, 1), period_end=date(year, month, last_day),
    )


class EngineTahap3bTests(TestCase):
    """Tahap 3b: December annual true-up (Pasal 17 + biaya jabatan + PTKP)."""

    def setUp(self):
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )

    def _calc_through(self, last_month, year=2026):
        for m in range(1, last_month + 1):
            period = PayrollPeriod.objects.filter(
                period_month=m, period_year=year,
            ).first()
            if period is None:
                period = make_month_period(m, year)
            calculate_period(period)

    def test_annual_pph21_progressive_layers(self):
        from .tax import annual_pph21
        from decimal import Decimal
        # 100 jt PKP: 5% x 60jt + 15% x 40jt = 3jt + 6jt = 9jt.
        self.assertEqual(annual_pph21(Decimal('100000000')), Decimal('9000000'))
        # PKP 0 → 0; PKP 50jt stays fully in layer 1 → 5% = 2.5jt.
        self.assertEqual(annual_pph21(Decimal('0')), Decimal('0'))
        self.assertEqual(annual_pph21(Decimal('50000000')), Decimal('2500000'))
        # First-layer boundary: exactly 60 jt → 3jt.
        self.assertEqual(annual_pph21(Decimal('60000000')), Decimal('3000000'))
        # 60jt + 1 → 3jt + 15% × 1 = 3.000.000,15.
        self.assertEqual(annual_pph21(Decimal('60000001')), Decimal('3000000.15'))

    def test_compute_december_trueup_full_year(self):
        """5jt/month, full year: gross 60jt − BJ 3jt (5%) − PTKP 54jt = 3jt PKP."""
        from .tax import compute_december_trueup
        config = make_tax_config()
        dec, annual, pkp, _bj = compute_december_trueup(
            config, 'TK/0', 60000000, 0,
        )
        self.assertEqual(pkp, 3000000)
        self.assertEqual(annual, 150000)
        self.assertEqual(dec, 150000)

    def test_compute_december_trueup_with_surplus(self):
        """6jt/month → PKP 14,4jt → annual 720.000; Jan-Nov TER 0 → Dec = annual."""
        from .tax import compute_december_trueup
        config = make_tax_config()
        dec, annual, pkp, _bj = compute_december_trueup(
            config, 'TK/0', 72000000, 0,
        )
        # PKP = 72jt − BJ 3,6jt (5%, cap 6jt not reached) − 54jt = 14,4jt → 5%.
        self.assertEqual(pkp, 14400000)
        self.assertEqual(annual, 720000)
        self.assertEqual(dec, 720000)

    def test_december_deducts_prior_withholding(self):
        """Jan-Nov PPh (TER 1%) is subtracted from the annual amount."""
        from .tax import compute_december_trueup
        config = make_tax_config()
        # Annual 720.000; Jan-Nov TER 1% × 6jt × 11 = 660.000 → Dec = 60.000.
        dec, annual, pkp, _bj = compute_december_trueup(
            config, 'TK/0', 72000000, 660000,
        )
        self.assertEqual(dec, 60000)

    def test_december_negative_trueup_floored_at_zero(self):
        """Overpayment via TER months → December withholds 0 (refund elsewhere)."""
        from .tax import compute_december_trueup
        config = make_tax_config()
        dec, _a, _p, _bj = compute_december_trueup(
            config, 'TK/0', 72000000, 2000000,
        )
        self.assertEqual(dec, 0)

    def test_december_engine_with_prior_months(self):
        """Full engine: Jun calc (TER 1% = 50rb), then December true-up.

        Annual: gross 60jt (12×5jt) − BJ 6jt − PTKP 54jt = PKP 0 → annual 0;
        Dec true-up = max(0 − 50rb, 0) = 0. Only the June month has PPh 21.
        """
        make_tax_config(rate='1', threshold='0')
        self._calc_through(6)
        dec_period = make_month_period(12)
        calculate_period(dec_period)
        dec_payroll = Payroll.objects.get(period=dec_period, employee=self.emp)
        # Jan-Jun TER 1% x 5jt = 50rb x 6 = 300rb already withheld.
        self.assertEqual(dec_payroll.pph_prior_months, 300000)
        self.assertEqual(dec_payroll.pph_annual, 0)
        self.assertFalse(dec_payroll.items.filter(component_code='PPh21').exists())

    def test_december_engine_trueup_extra_withholding(self):
        """Employee whose annual progressive exceeds TER months pays extra in Dec.

        Salary structure changes in July (Jan-Jun 8jt, Jul-Des 25jt):
        gross year = 6×8jt + 6×25jt = 198jt; BJ capped 6jt; PTKP 54jt →
        PKP 138jt → annual = 3jt + 15%×78jt = 14.700.000. TER months (rate 1%):
        Jan-Jun 80rb×6 = 480rb; Jul-Nov 250rb×5 = 1.250.000 → prior 1.730.000
        → December PPh = 12.970.000.
        """
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 7, 1), basic_salary=25000000,
        )
        SalaryStructure.objects.filter(effective_from=date(2026, 1, 1)).update(
            effective_to=date(2026, 6, 30), basic_salary=8000000,
        )
        make_tax_config(rate='1', threshold='0')
        self._calc_through(11)
        dec_period = make_month_period(12)
        calculate_period(dec_period)
        dec_payroll = Payroll.objects.get(period=dec_period, employee=self.emp)
        self.assertEqual(dec_payroll.pph_prior_months, 1730000)
        self.assertEqual(dec_payroll.pph_annual, 14700000)
        dec_item = dec_payroll.items.get(component_code='PPh21')
        self.assertEqual(dec_item.amount, 12970000)
        self.assertIn('true-up', dec_item.description)

    def test_december_recap_pays_missing_months(self):
        """June-Dec calculated only: annual covers Jan-May missing months.

        gross year = 7×5jt = 35jt; months worked 7 → BJ = min(5%×35jt,
        500rb×7) = 1.750.000; PTKP 54jt → PKP negative → 0 → Dec = 0.
        """
        make_tax_config(rate='1', threshold='0')
        self._calc_through(6)
        dec_period = make_month_period(12)
        calculate_period(dec_period)
        dec_payroll = Payroll.objects.get(period=dec_period, employee=self.emp)
        self.assertEqual(dec_payroll.pph_annual, 0)
        self.assertFalse(dec_payroll.items.filter(component_code='PPh21').exists())

    def test_midyear_termination_trueup_in_final_month(self):
        """PMK "masa pajak terakhir": termination June → true-up runs in June.

        10jt/month Jan-Jun, terminated 20 Jun (pro-rata 20/30):
        gross year = 5×10jt + 10jt×20/30 = 56.666.667; months worked
        5 + 20/30 → BJ = min(2.833.333, 500rb×5.667=2.833.333) → PKP ≈ 0
        → no true-up item; June PPh is TER-only.
        """
        from apps.personnel.models import EmployeeContract
        from decimal import Decimal
        self.emp.employment_status = 'INACTIVE'
        self.emp.save()
        EmployeeContract.objects.create(
            employee=self.emp, contract_type='PKWT', contract_number='CTR-1',
            start_date=date(2025, 1, 1), status='TERMINATED',
            termination_date=date(2026, 6, 20),
        )
        SalaryStructure.objects.filter(employee=self.emp).update(basic_salary=10000000)
        make_tax_config(rate='1', threshold='0')
        for m in range(1, 6):
            calculate_period(make_month_period(m))
        june = make_month_period(6)
        calculate_period(june)
        june_payroll = Payroll.objects.get(period=june, employee=self.emp)
        # Annual: gross 56.666.667 − BJ 2.833.333 − PTKP 54jt < 0 → PKP 0 →
        # annual 0; Jan-May already withheld 5 × 100rb = 500rb → June withholds
        # max(0 − 500rb, 0) = 0 (overpayment refunded via SPT, not in payroll).
        self.assertFalse(june_payroll.items.filter(component_code='PPh21').exists())
        self.assertEqual(june_payroll.pph_prior_months, 500000)
        self.assertEqual(june_payroll.pph_annual, 0)

    def test_biaya_jabatan_monthly_cap(self):
        from .tax import biaya_jabatan_with_months
        from decimal import Decimal
        # 50jt in 6 months: 5% = 2.5jt but 500rb×6 = 3jt → 2.5jt.
        self.assertEqual(
            biaya_jabatan_with_months(Decimal('50000000'), Decimal('6')),
            Decimal('2500000'),
        )
        # 50jt in 2 months: 500rb×2 = 1jt < 2.5jt → 1jt.
        self.assertEqual(
            biaya_jabatan_with_months(Decimal('50000000'), Decimal('2')),
            Decimal('1000000'),
        )

    def test_annual_layer_override(self):
        """AnnualTaxBracket rows replace the statutory layer for that order."""
        from .tax import annual_pph21
        from decimal import Decimal
        config = make_tax_config()
        from .models import AnnualTaxBracket
        AnnualTaxBracket.objects.create(
            tax_config=config, layer_order=1,
            pkp_lower=0, pkp_upper=50000000, rate_pct=Decimal('0'),
        )
        # 100jt: layer 1 (0-50jt) 0% + layer 2 (50-250jt) 15% × 50jt = 7.5jt.
        self.assertEqual(annual_pph21(Decimal('100000000'), config), Decimal('7500000'))


class TaxConfigApiTests(TestCase):
    """Tax config + bracket + tax profile CRUD API (ADMIN/HR only)."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)

    def test_create_tax_config(self):
        res = self.client.post(
            reverse('payroll-tax-config-list'),
            {'year': 2027, 'dtp_threshold': '10000000'}, format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertFalse(TaxConfig.objects.get(year=2027).is_active)

    def test_duplicate_year_rejected(self):
        TaxConfig.objects.create(year=2026)
        res = self.client.post(
            reverse('payroll-tax-config-list'), {'year': 2026}, format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_employee_cannot_access_tax_config(self):
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.get(reverse('payroll-tax-config-list'))
        self.assertEqual(res.status_code, 403)

    def test_brackets_bulk_replace(self):
        config = make_tax_config(rate='1')
        res = self.client.post(
            reverse('payroll-tax-config-brackets', args=[config.id]),
            data=json.dumps({'brackets': [
                {'ter_category': 'A', 'bruto_lower': '0', 'bruto_upper': '5000000', 'rate_pct': '0.5'},
                {'ter_category': 'A', 'bruto_lower': '5000000', 'bruto_upper': None, 'rate_pct': '2'},
                {'ter_category': 'B', 'bruto_lower': '0', 'bruto_upper': None, 'rate_pct': '1'},
                {'ter_category': 'C', 'bruto_lower': '0', 'bruto_upper': None, 'rate_pct': '1.5'},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200, getattr(res, 'data', None))
        self.assertEqual(config.ter_brackets.count(), 4)

    def test_brackets_invalid_payload(self):
        config = make_tax_config()
        res = self.client.post(
            reverse('payroll-tax-config-brackets', args=[config.id]),
            data=json.dumps({'brackets': [
                {'ter_category': 'A', 'bruto_lower': '5000000',
                 'bruto_upper': '1000000', 'rate_pct': '1'},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)

    def test_annual_brackets_bulk_replace(self):
        config = make_tax_config()
        res = self.client.post(
            reverse('payroll-tax-config-annual-brackets', args=[config.id]),
            data=json.dumps({'brackets': [
                {'layer_order': 1, 'pkp_lower': '0',
                 'pkp_upper': '50000000', 'rate_pct': '0'},
                {'layer_order': 5, 'pkp_lower': '5000000000',
                 'pkp_upper': None, 'rate_pct': '36'},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200, getattr(res, 'data', None))
        self.assertEqual(config.annual_brackets.count(), 2)
        # Replace with empty list resets to statutory defaults.
        res = self.client.post(
            reverse('payroll-tax-config-annual-brackets', args=[config.id]),
            data=json.dumps({'brackets': []}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(config.annual_brackets.count(), 0)

    def test_annual_brackets_invalid_payload(self):
        config = make_tax_config()
        res = self.client.post(
            reverse('payroll-tax-config-annual-brackets', args=[config.id]),
            data=json.dumps({'brackets': [
                {'layer_order': 9, 'pkp_lower': '0',
                 'pkp_upper': '50000000', 'rate_pct': '0'},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)

    def test_annual_brackets_employee_forbidden(self):
        config = make_tax_config()
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.post(
            reverse('payroll-tax-config-annual-brackets', args=[config.id]),
            data=json.dumps({'brackets': []}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 403)

    def test_tax_profile_crud(self):
        emp = Employee.objects.create(employee_id='E010', full_name='Taxed', employment_status='ACTIVE')
        res = self.client.post(
            reverse('payroll-tax-profile-list'),
            {'employee': emp.id, 'ptkp_status': 'K/1', 'tax_scheme': 'NORMAL'}, format='json',
        )
        self.assertEqual(res.status_code, 201)
        profile_id = res.json()['id']
        # Invalid PTKP rejected.
        res = self.client.patch(
            reverse('payroll-tax-profile-detail', args=[profile_id]),
            data=json.dumps({'ptkp_status': 'ZZ/9'}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)
        # Valid update.
        res = self.client.patch(
            reverse('payroll-tax-profile-detail', args=[profile_id]),
            data=json.dumps({'ptkp_status': 'K/3'}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(EmployeeTaxProfile.objects.get(pk=profile_id).ptkp_status, 'K/3')

    def test_tax_profile_upsert_via_post(self):
        emp = Employee.objects.create(employee_id='E012', full_name='Upsert', employment_status='ACTIVE')
        url = reverse('payroll-tax-profile-list')
        # 1. create
        res = self.client.post(url, {'employee': emp.id, 'ptkp_status': 'TK/0'}, format='json')
        self.assertEqual(res.status_code, 201)
        profile_id = res.json()['id']
        # 2. update same profile via POST (no duplicate)
        res = self.client.post(url, {'employee': emp.id, 'ptkp_status': 'K/1'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['id'], profile_id)
        self.assertEqual(EmployeeTaxProfile.objects.filter(employee=emp).count(), 1)
        # 3. update several times
        for status in ('K/2', 'K/3', 'TK/2'):
            res = self.client.post(url, {'employee': emp.id, 'ptkp_status': status}, format='json')
            self.assertEqual(res.status_code, 200)
        self.assertEqual(EmployeeTaxProfile.objects.get(pk=profile_id).ptkp_status, 'TK/2')
        self.assertEqual(EmployeeTaxProfile.objects.filter(employee=emp).count(), 1)
        # 4. reset (delete) -> back to default
        res = self.client.delete(reverse('payroll-tax-profile-reset', args=[profile_id]))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(EmployeeTaxProfile.objects.filter(employee=emp).exists())
        # 5. create again after reset
        res = self.client.post(url, {'employee': emp.id, 'ptkp_status': 'K/0'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(EmployeeTaxProfile.objects.get(employee=emp).ptkp_status, 'K/0')

    def test_tax_profile_upsert_invalid_ptkp_rejected(self):
        emp = Employee.objects.create(employee_id='E013', full_name='Invalid', employment_status='ACTIVE')
        url = reverse('payroll-tax-profile-list')
        res = self.client.post(url, {'employee': emp.id, 'ptkp_status': 'ZZ/9'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(EmployeeTaxProfile.objects.filter(employee=emp).exists())
        # Existing profile + invalid payload -> rejected, profile untouched.
        profile = EmployeeTaxProfile.objects.create(employee=emp, ptkp_status='K/1')
        res = self.client.post(url, {'employee': emp.id, 'ptkp_status': 'ZZ/9'}, format='json')
        self.assertEqual(res.status_code, 400)
        profile.refresh_from_db()
        self.assertEqual(profile.ptkp_status, 'K/1')

    def test_tax_profile_employee_forbidden(self):
        emp = Employee.objects.create(employee_id='E011', full_name='Taxed2', employment_status='ACTIVE')
        self.client.force_login(make_user('EMPLOYEE', 'emp2@test.com'))
        res = self.client.post(
            reverse('payroll-tax-profile-list'),
            {'employee': emp.id, 'ptkp_status': 'K/1'}, format='json',
        )
        self.assertEqual(res.status_code, 403)


class TaxHelperUnitTests(TestCase):
    def test_ter_category_mapping(self):
        from .tax import TaxConfigError, ter_category_for
        self.assertEqual(ter_category_for('TK/0'), 'A')
        self.assertEqual(ter_category_for('K/0'), 'A')
        self.assertEqual(ter_category_for('TK/2'), 'B')
        self.assertEqual(ter_category_for('K/2'), 'B')
        self.assertEqual(ter_category_for('K/3'), 'C')
        with self.assertRaises(TaxConfigError):
            ter_category_for('ZZ/9')

    def test_round_pph_down_to_thousand(self):
        from .tax import round_pph
        from decimal import Decimal
        self.assertEqual(round_pph(Decimal('999')), Decimal('0'))
        self.assertEqual(round_pph(Decimal('4999')), Decimal('4000'))
        self.assertEqual(round_pph(Decimal('5001')), Decimal('5000'))
        self.assertEqual(round_pph(Decimal('1999.9')), Decimal('1000'))


class Tahap3cTests(TestCase):
    """Tahap 3c: terbilang, slip numbering, payslip PDF, recap XLSX."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config(rate='1', threshold='0')
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
            bank_account_name='BCA', bank_account_number='1234567890',
        )
        SalaryStructure.objects.create(
            employee=self.emp, effective_from=date(2026, 1, 1), basic_salary=5000000,
        )
        self.period = make_month_period(6)
        calculate_period(self.period)
        self.payroll = Payroll.objects.get(period=self.period, employee=self.emp)

    def _to_paid(self):
        # Walk the state machine (DRAFT→CALCULATED→REVIEW→APPROVED→PAID).
        self.period.status = PayrollPeriod.Status.CALCULATED
        self.period.save(update_fields=['status'])
        for target in (PayrollPeriod.Status.REVIEW, PayrollPeriod.Status.APPROVED,
                       PayrollPeriod.Status.PAID):
            self.period.status = target
            self.period.save(update_fields=['status'])

    def test_terbilang(self):
        from .terbilang import terbilang
        self.assertEqual(terbilang(0), 'Nol Rupiah')
        self.assertEqual(terbilang(1), 'Satu Rupiah')
        self.assertEqual(terbilang(11), 'Sebelas Rupiah')
        self.assertEqual(terbilang(150000), 'Seratus Lima Puluh Ribu Rupiah')
        self.assertEqual(terbilang(250000), 'Dua Ratus Lima Puluh Ribu Rupiah')
        self.assertEqual(terbilang(9039000), 'Sembilan Juta Tiga Puluh Sembilan Ribu Rupiah')
        self.assertEqual(terbilang(1000000), 'Satu Juta Rupiah')
        self.assertEqual(terbilang(1100000), 'Satu Juta Seratus Ribu Rupiah')
        self.assertEqual(terbilang(175000), 'Seratus Tujuh Puluh Lima Ribu Rupiah')

    def test_slip_number_sequential_and_monthly_reset(self):
        from .exports import assign_slip_number
        self.assertEqual(assign_slip_number(self.payroll), '001/HRGA/06/2026')
        # Idempotent.
        self.assertEqual(assign_slip_number(self.payroll), '001/HRGA/06/2026')
        # Second employee in same period -> 002.
        emp2 = Employee.objects.create(employee_id='E002', full_name='Jane', employment_status='ACTIVE')
        SalaryStructure.objects.create(
            employee=emp2, effective_from=date(2026, 1, 1), basic_salary=4000000,
        )
        payroll2 = Payroll.objects.create(period=self.period, employee=emp2, basic_salary=4000000)
        self.assertEqual(assign_slip_number(payroll2), '002/HRGA/06/2026')
        # New month resets to 001.
        july = make_month_period(7)
        calculate_period(july)
        p2 = Payroll.objects.get(period=july, employee=self.emp)
        self.assertEqual(assign_slip_number(p2), '001/HRGA/07/2026')

    def test_payslip_requires_paid_period(self):
        res = self.client.get(reverse('payroll-payslip', args=[self.payroll.id]))
        self.assertEqual(res.status_code, 400)

    def test_payslip_pdf_ok(self):
        self._to_paid()
        res = self.client.get(reverse('payroll-payslip', args=[self.payroll.id]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'application/pdf')
        self.assertTrue(res.content.startswith(b'%PDF'))
        self.payroll.refresh_from_db()
        self.assertEqual(self.payroll.slip_number, '001/HRGA/06/2026')

    def test_payslip_employee_forbidden(self):
        self._to_paid()
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.get(reverse('payroll-payslip', args=[self.payroll.id]))
        self.assertEqual(res.status_code, 403)

    def test_recap_xlsx_ok(self):
        self._to_paid()
        res = self.client.get(reverse('payroll-period-recap', args=[self.period.id]))
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res['Content-Type'])
        self.assertTrue(res.content.startswith(b'PK'))  # xlsx zip magic
        import io
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(res.content))
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        self.assertEqual(rows[0], ('No', 'Nama Karyawan', 'Bank', 'No Rekening', 'Nominal Transfer'))
        self.assertEqual(rows[1][1], 'John')
        self.assertEqual(rows[1][3], '1234567890')
        self.assertEqual(rows[1][4], int(self.payroll.transfer_amount))

    def test_recap_employee_forbidden(self):
        self.client.force_login(make_user('EMPLOYEE', 'emp@test.com'))
        res = self.client.get(reverse('payroll-period-recap', args=[self.period.id]))
        self.assertEqual(res.status_code, 403)