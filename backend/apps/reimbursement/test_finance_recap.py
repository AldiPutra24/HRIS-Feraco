"""Finance recap: employees in a position flagged `can_recap_reimbursement`."""
from datetime import date

from django.test import TestCase
from django.utils import timezone

from apps.notifications.models import Notification
from apps.personnel.models import Department, Employee, Position

from .models import Reimbursement, ReimbursementCategory
from .tests import BANK, make_user


class FinanceRecapTests(TestCase):
    def setUp(self):
        dept = Department.objects.create(name='Finance')
        self.fat = Position.objects.create(name='FAT Admin', department=dept, can_recap_reimbursement=True)
        plain = Position.objects.create(name='Staff', department=dept)

        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.lead = make_user('HR_LEAD', 'lead@test.com')
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.fin_user = make_user('EMPLOYEE', 'fin@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.fin = Employee.objects.create(employee_id='F001', full_name='Fina', employment_status='ACTIVE',
                                           user=self.fin_user, position=self.fat)
        self.emp = Employee.objects.create(employee_id='E001', full_name='Budi', employment_status='ACTIVE',
                                           user=self.emp_user, position=plain)
        self.cat = ReimbursementCategory.objects.create(name='Transport', code='TRK')

        def make(emp, status, **extra):
            return Reimbursement.objects.create(
                employee=emp, category=self.cat, transaction_date=date(2026, 10, 1), amount=100000,
                approved_amount=90000 if status in ('APPROVED', 'PAID') else None, status=status,
                paid_at=timezone.now() if status == 'PAID' else None, description='Taksi', **BANK, **extra,
            )

        self.paid = make(self.emp, 'PAID')
        self.pending = make(self.emp, 'PENDING')
        self.approved = make(self.emp, 'APPROVED')
        self.own_pending = make(self.fin, 'PENDING')

    def ids(self, res):
        data = res.json()
        rows = data['results'] if isinstance(data, dict) else data
        return {r['id'] for r in rows}

    def test_recap_scope_lists_only_paid_for_finance(self):
        self.client.force_login(self.fin_user)
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap'})), {self.paid.id})
        # "Pengajuan Saya" stays own-only for the Finance employee.
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'mine': '1'})), {self.own_pending.id})

    def test_recap_scope_empty_without_position_flag(self):
        self.client.force_login(self.emp_user)
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap'})), set())
        self.assertEqual(self.client.post(f'/api/reimbursements/{self.paid.id}/recap/').status_code, 403)

    def test_access_follows_position(self):
        self.client.force_login(self.fin_user)
        self.assertTrue(self.client.get('/api/auth/me/').json()['can_recap_reimbursement'])
        Employee.objects.filter(pk=self.fin.pk).update(position=None)  # moved out of FAT Admin
        self.assertFalse(self.client.get('/api/auth/me/').json()['can_recap_reimbursement'])
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap'})), set())

    def test_recap_and_unrecap(self):
        self.client.force_login(self.fin_user)
        res = self.client.post(f'/api/reimbursements/{self.paid.id}/recap/')
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.json()['recapped_at'])
        self.assertEqual(res.json()['recapped_by_name'], 'fin@test.com')
        self.paid.refresh_from_db()
        self.assertEqual(self.paid.recapped_by, self.fin_user)
        self.assertEqual(
            self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap', 'recapped': 'false'})), set(),
        )
        res = self.client.post(f'/api/reimbursements/{self.paid.id}/unrecap/')
        self.assertIsNone(res.json()['recapped_at'])
        self.assertEqual(
            self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap', 'recapped': 'false'})), {self.paid.id},
        )

    def test_only_paid_can_be_recapped(self):
        self.client.force_login(self.fin_user)
        self.assertEqual(self.client.post(f'/api/reimbursements/{self.approved.id}/recap/').status_code, 400)

    def test_admin_may_recap(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.post(f'/api/reimbursements/{self.paid.id}/recap/').status_code, 200)

    def test_finance_is_read_only_on_others(self):
        self.client.force_login(self.fin_user)
        self.assertEqual(self.client.get(f'/api/reimbursements/{self.paid.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/reimbursements/{self.pending.id}/').status_code, 404)
        self.assertIn(
            self.client.patch(f'/api/reimbursements/{self.paid.id}/', {'description': 'x'},
                              content_type='application/json').status_code, (403, 404),
        )
        self.assertIn(self.client.delete(f'/api/reimbursements/{self.paid.id}/').status_code, (403, 404))
        # APPROVED rows are not even visible to Finance (404); either way refused.
        self.assertIn(self.client.post(f'/api/reimbursements/{self.approved.id}/mark_paid/').status_code, (403, 404))
        self.paid.refresh_from_db()
        self.assertEqual(self.paid.description, 'Taksi')

    def test_paid_month_filter_and_summary_scope(self):
        self.client.force_login(self.fin_user)
        month = timezone.localdate().strftime('%Y-%m')
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap', 'paid_month': month})), {self.paid.id})
        self.assertEqual(self.ids(self.client.get('/api/reimbursements/', {'scope': 'recap', 'paid_month': '2020-01'})), set())
        summary = self.client.get('/api/reimbursements/summary/', {'scope': 'recap'}).json()
        self.assertEqual(summary['total'], 1)
        self.assertEqual(summary['counts']['PAID'], 1)

    def test_mark_paid_notifies_finance_in_app(self):
        self.client.force_login(self.lead)
        res = self.client.post(f'/api/reimbursements/{self.approved.id}/mark_paid/', {'payment_reference': 'TRF-1'},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        note = Notification.objects.get(recipient=self.fin_user, title='Reimbursement siap direkap')
        self.assertIn('Budi', note.message)
        self.assertIn('Rp90.000', note.message)
        self.assertEqual(note.link, f'/dashboard/employee/rekap-reimbursement?id={self.approved.id}')
        self.assertFalse(Notification.objects.filter(recipient=self.emp_user, title='Reimbursement siap direkap').exists())

    def test_position_flag_editable_via_api(self):
        self.client.force_login(self.hr)
        res = self.client.get(f'/api/positions/{self.fat.id}/')
        self.assertTrue(res.json()['can_recap_reimbursement'])
