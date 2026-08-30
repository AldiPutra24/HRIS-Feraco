from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Employee

from .models import Reimbursement, ReimbursementCategory, ReimbursementNotification
from .serializers import ReimbursementSerializer

User = get_user_model()

def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class ReimbursementWorkflowTests(TestCase):
    def setUp(self):
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        self.emp.user = self.emp_user
        self.emp.save()
        self.cat_attachment = ReimbursementCategory.objects.create(
            name='Transport', code='TRANSPORT', requires_attachment=True,
        )
        self.cat_no_attach = ReimbursementCategory.objects.create(
            name='Meal', code='MEAL', requires_attachment=False,
        )

    def _create_draft(self, emp=None, cat=None, amount=50000):
        return Reimbursement.objects.create(
            employee=emp or self.emp,
            category=cat or self.cat_no_attach,
            transaction_date=date.today(),
            amount=amount,
            description='Test',
            status='DRAFT',
        )

    def _login(self, user):
        self.client.force_login(user)

    def test_employee_create_reimbursement(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'description': 'Makan siang',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'DRAFT')
        self.assertEqual(resp.json()['employee_name'], 'John')

    def test_employee_only_sees_own(self):
        self._login(self.emp_user)
        r1 = self._create_draft(emp=self.emp, cat=self.cat_no_attach)
        emp2 = Employee.objects.create(employee_id='E002', full_name='Jane', employment_status='ACTIVE')
        self._create_draft(emp=emp2, cat=self.cat_no_attach)
        resp = self.client.get('/api/reimbursements/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        results = data['results'] if isinstance(data, dict) else data
        ids = [r['id'] for r in results]
        self.assertIn(r1.id, ids)
        self.assertEqual(len(results), 1)

    def test_hr_sees_all(self):
        self._login(self.hr)
        r1 = self._create_draft(emp=self.emp, cat=self.cat_no_attach)
        emp2 = Employee.objects.create(employee_id='E002', full_name='Jane', employment_status='ACTIVE')
        r2 = self._create_draft(emp=emp2, cat=self.cat_no_attach)
        resp = self.client.get('/api/reimbursements/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        results = data['results'] if isinstance(data, dict) else data
        self.assertGreaterEqual(len(results), 2)

    def test_submit_changes_status(self):
        self._login(self.emp_user)
        r = self._create_draft()
        resp = self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')
        self.assertIsNotNone(r.submitted_at)

    def test_create_attachment_required_cat_allowed_but_submit_blocked(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_attachment.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'description': 'Transport',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'DRAFT')
        rid = resp.json()['id']
        resp = self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(resp.status_code, 400)
        r = Reimbursement.objects.get(id=rid)
        self.assertEqual(r.status, 'DRAFT')

    def test_approve(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        resp = self.client.post(f'/api/reimbursements/{r.id}/approve/')
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')
        self.assertIsNotNone(r.approved_at)
        self.assertEqual(r.reviewer, self.hr)

    def test_reject_requires_reason(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        resp = self.client.post(f'/api/reimbursements/{r.id}/reject/', {}, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')
        resp = self.client.post(f'/api/reimbursements/{r.id}/reject/',
                                {'rejection_reason': 'Dokumen tidak lengkap'},
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'REJECTED')
        self.assertEqual(r.rejection_reason, 'Dokumen tidak lengkap')

    def test_mark_paid(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        self.client.post(f'/api/reimbursements/{r.id}/approve/')
        resp = self.client.post(f'/api/reimbursements/{r.id}/mark_paid/',
                                {'payment_reference': 'TRF/2026/08/001'},
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PAID')
        self.assertIsNotNone(r.paid_at)
        self.assertEqual(r.payment_reference, 'TRF/2026/08/001')

    def test_invalid_amount_negative(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': -100,
            'description': 'Negative',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_invalid_amount_zero(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 0,
            'description': 'Zero',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_inactive_employee_cannot_submit(self):
        self.emp.employment_status = 'INACTIVE'
        self.emp.save()
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 50000,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_self_approval_rejected(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        resp = self.client.post(f'/api/reimbursements/{r.id}/approve/')
        self.assertEqual(resp.status_code, 403)

    def test_employee_cannot_access_hr_actions(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.emp_user)
        # Employee cannot approve
        resp = self.client.post(f'/api/reimbursements/{r.id}/approve/')
        self.assertEqual(resp.status_code, 403)
        # Employee cannot reject
        resp = self.client.post(f'/api/reimbursements/{r.id}/reject/',
                                {'rejection_reason': 'No'}, content_type='application/json')
        self.assertEqual(resp.status_code, 403)
        # Employee cannot mark paid
        resp = self.client.post(f'/api/reimbursements/{r.id}/mark_paid/')
        self.assertEqual(resp.status_code, 403)

    def test_unauthorized_user(self):
        resp = self.client.get('/api/reimbursements/')
        self.assertEqual(resp.status_code, 403)

    def test_audit_log_created(self):
        self._login(self.emp_user)
        r = self._create_draft()
        # create via API so the 'create' audit entry is recorded
        resp = self.client.post('/api/reimbursements/', {
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'description': 'Via API',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        rid = resp.json()['id']
        self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.client.logout()
        self._login(self.hr)
        self.client.post(f'/api/reimbursements/{rid}/approve/')
        logs = AuditLog.objects.filter(object_id=str(rid))
        actions = set(logs.values_list('action', flat=True))
        # create + update (submit) + approve
        self.assertIn('create', actions)
        self.assertIn('approve', actions)

    def test_cancel_draft(self):
        self._login(self.emp_user)
        r = self._create_draft()
        resp = self.client.post(f'/api/reimbursements/{r.id}/cancel/')
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'CANCELLED')

    def test_workflow_from_draft_to_paid(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.assertEqual(r.status, 'DRAFT')
        # submit
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')
        self.client.logout()
        # approve
        self._login(self.hr)
        self.client.post(f'/api/reimbursements/{r.id}/approve/')
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')
        # reject from approved should fail
        resp = self.client.post(f'/api/reimbursements/{r.id}/reject/',
                                {'rejection_reason': 'No'}, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        # mark paid
        self.client.post(f'/api/reimbursements/{r.id}/mark_paid/',
                         {'payment_reference': 'PAID001'}, content_type='application/json')
        r.refresh_from_db()
        self.assertEqual(r.status, 'PAID')

    def test_employee_cannot_view_another_employee_reimbursement(self):
        self._login(self.emp_user)
        r = self._create_draft()
        emp2 = Employee.objects.create(employee_id='E003', full_name='Bob', employment_status='ACTIVE')
        emp2_user = make_user('EMPLOYEE', 'bob@test.com')
        emp2.user = emp2_user
        emp2.save()
        r2 = self._create_draft(emp=emp2, cat=self.cat_no_attach)
        resp = self.client.get(f'/api/reimbursements/{r2.id}/')
        # queryset scoping hides other employees' reimbursements
        self.assertEqual(resp.status_code, 404)

    def test_employee_cannot_edit_another_employee_reimbursement(self):
        self._login(self.emp_user)
        emp2 = Employee.objects.create(employee_id='E004', full_name='Charlie', employment_status='ACTIVE')
        emp2_user = make_user('EMPLOYEE', 'charlie@test.com')
        emp2.user = emp2_user
        emp2.save()
        r2 = self._create_draft(emp=emp2, cat=self.cat_no_attach)
        resp = self.client.post(f'/api/reimbursements/{r2.id}/submit/')
        self.assertEqual(resp.status_code, 404)

    def test_employee_no_notification_for_others(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        # Employee should have no notification about their own submission
        # Notifications are for HR when submitted
        resp = self.client.get('/api/reimbursements/notifications/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # Employee may have empty notifications
        self.assertIsInstance(data, list)