from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.leaves.models import LeaveRequest, LeaveType
from apps.personnel.models import Employee
from apps.reimbursement.models import Reimbursement, ReimbursementCategory

from .models import Payroll, PayrollComponent, PayrollItem, PayrollPeriod, SalaryStructure
from .services import calculate_period

User = get_user_model()


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

    def test_unpaid_leave_snapshotted(self):
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
        self.assertEqual(items.first().amount, 0)  # placeholder only
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