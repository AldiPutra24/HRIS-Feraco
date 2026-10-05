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

BANK = {
    'bank_name': 'BCA',
    'bank_account_name': 'John Doe',
    'bank_account_number': '1234567890',
    'contact_email': 'john.transfer@gmail.com',
}
PDF_BYTES = b'%PDF-1.4\n%test\n'


def _approve_two_step(client, rid, data):
    """Semi-hierarchical approval: the logged-in HR Staff reviews (sets
    Nominal Disetujui), then an HR Lead approves payment. Returns the first
    failing response, else the HR Lead approve response; restores the
    original session user."""
    uid = client.session.get('_auth_user_id')
    res = client.post(f'/api/reimbursements/{rid}/review/', data, content_type='application/json')
    if res.status_code != 200:
        return res
    lead = User.objects.filter(role__key='HR_LEAD').first() or make_user('HR_LEAD', 'lead.helper@test.com')
    client.force_login(lead)
    res = client.post(f'/api/reimbursements/{rid}/approve/')
    if uid:
        client.force_login(User.objects.get(pk=uid))
    return res

def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class ReimbursementWorkflowTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
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
            **BANK,
            attachment_name='nota.pdf',
            attachment_path='reimbursements/test/attachments/nota.pdf',
        )

    def _login(self, user):
        self.client.force_login(user)

    def test_employee_create_reimbursement(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
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
        resp = self.client.post('/api/reimbursements/', {**BANK,
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
        resp = _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')
        self.assertIsNotNone(r.approved_at)
        self.assertEqual(r.amount_set_by, self.hr)  # HR Staff set the amount
        self.assertEqual(r.reviewer.role.key, 'HR_LEAD')  # HR Lead approved payment

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
        _approve_two_step(self.client, r.id, {'approved_amount': 40000})
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
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': -100,
            'description': 'Negative',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_invalid_amount_zero(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 0,
            'description': 'Zero',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_inactive_employee_cannot_submit(self):
        self.emp.employment_status = 'INACTIVE'
        self.emp.save()
        # Neutralize employee->user sync so this test isolates reimbursement rules
        # (employee inactive must still yield a 400 from the reimbursement validator,
        # not a 403 from the now-deactivated account).
        self.emp_user.is_active = True
        self.emp_user.inactive_by_employee = False
        self.emp_user.save(update_fields=['is_active', 'inactive_by_employee'])
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
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
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'description': 'Via API',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        rid = resp.json()['id']
        _attach(rid)
        self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.client.logout()
        self._login(self.hr)
        _approve_two_step(self.client, rid, {'approved_amount': 40000})
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
        _approve_two_step(self.client, r.id, {'approved_amount': 40000})
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

    def test_mark_paid_without_storage_returns_503(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        from io import BytesIO
        from django.core.files.uploadedfile import SimpleUploadedFile
        resp = self.client.post(f'/api/reimbursements/{r.id}/mark_paid/',
                                {'payment_reference': 'TRF001', 'file': SimpleUploadedFile('proof.jpg', b'x', content_type='image/jpeg')})
        # storage not configured in tests -> 503, status stays APPROVED
        self.assertEqual(resp.status_code, 503)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')

    def test_payment_proof_fields_exposed(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        self.client.post(f'/api/reimbursements/{r.id}/mark_paid/',
                         {'payment_reference': 'TRF/2026/08/001'}, content_type='application/json')
        resp = self.client.get(f'/api/reimbursements/{r.id}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['payment_proof_name'], '')
        self.assertIsNone(data['payment_proof_url'])

    def test_payment_proof_requires_paid_status(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.client.logout()
        self._login(self.hr)
        resp = self.client.post(f'/api/reimbursements/{r.id}/payment_proof/', {}, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('PAID', resp.json()['detail'])

    def test_admin_can_delete_reimbursement(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.logout()
        self._login(self.admin)
        resp = self.client.delete(f'/api/reimbursements/{r.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Reimbursement.objects.filter(id=r.id).exists())

    def test_admin_delete_creates_audit_log(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.logout()
        self._login(self.admin)
        self.client.delete(f'/api/reimbursements/{r.id}/')
        self.assertTrue(AuditLog.objects.filter(object_id=str(r.id), action='delete').exists())

    def test_hr_staff_cannot_delete_reimbursement(self):
        self._login(self.emp_user)
        r = self._create_draft()
        self.client.logout()
        self._login(self.hr)
        resp = self.client.delete(f'/api/reimbursements/{r.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Reimbursement.objects.filter(id=r.id).exists())

    # --- approved_amount + project_category ---

    def _submit_as_emp(self, r=None):
        self._login(self.emp_user)
        r = r or self._create_draft()
        resp = self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.assertEqual(resp.status_code, 200)
        self.client.logout()
        return r

    def test_employee_cannot_set_approved_amount(self):
        self._login(self.emp_user)
        r = self._create_draft()
        resp = self.client.patch(f'/api/reimbursements/{r.id}/', {'approved_amount': 10000}, content_type='application/json')
        # PATCH not routed on this viewset (list only POST/GET) — use POST create instead
        # Employee attempting approved_amount on create must be rejected.
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'approved_amount': 50000,
            'project_category': 'GPFE',
            'description': 'X',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('approved_amount', resp.json())

    def test_hr_can_set_approved_amount(self):
        r = self._submit_as_emp()
        self._login(self.hr)
        resp = _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')
        self.assertEqual(float(r.approved_amount), 40000)

    def test_approve_without_approved_amount_rejected(self):
        r = self._submit_as_emp()
        self._login(self.hr)
        resp = _approve_two_step(self.client, r.id, {})
        self.assertEqual(resp.status_code, 400)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')

    def test_approved_amount_cannot_exceed_amount(self):
        r = self._submit_as_emp()
        self._login(self.hr)
        resp = _approve_two_step(self.client, r.id, {'approved_amount': 999999})
        self.assertEqual(resp.status_code, 400)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')

    def test_project_category_valid_choices(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'project_category': 'BOGUS',
            'description': 'X',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('project_category', resp.json())

    def test_other_requires_other_text(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'project_category': 'OTHER',
            'project_category_other': '',
            'description': 'X',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('project_category_other', resp.json())

    def test_non_other_rejects_other_text(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'project_category': 'GPFE',
            'project_category_other': 'Should be cleared',
            'description': 'X',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        rid = resp.json()['id']
        r = Reimbursement.objects.get(id=rid)
        self.assertEqual(r.project_category_other, '')

    def test_other_with_text_ok(self):
        self._login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat_no_attach.id,
            'transaction_date': '2026-08-01',
            'amount': 75000,
            'project_category': 'OTHER',
            'project_category_other': 'Project ABC',
            'description': 'X',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        r = Reimbursement.objects.get(id=resp.json()['id'])
        self.assertEqual(r.project_category, 'OTHER')
        self.assertEqual(r.project_category_other, 'Project ABC')

    def test_audit_approved_amount_change(self):
        r = self._submit_as_emp()
        self._login(self.hr)
        _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        log = AuditLog.objects.filter(object_id=str(r.id), action='approve').latest('created_at')
        self.assertEqual(log.changes_after['approved_amount'], '40000.00')
        review = AuditLog.objects.filter(object_id=str(r.id), description__icontains='reviewed').get()
        self.assertEqual(review.changes_after['approved_amount'], '40000')


class ManagementScopeTests(TestCase):
    """Management reimbursement: self-service flow like Employee - own
    reimbursements only, never direct reports' or other users' data."""

    def setUp(self):
        self.mgr_user = make_user('MANAGEMENT', 'mgr@test.com')
        self.mgr = Employee.objects.create(employee_id='M001', full_name='Manager', employment_status='ACTIVE')
        self.mgr.user = self.mgr_user
        self.mgr.save()
        self.rep_user = make_user('EMPLOYEE', 'rep@test.com')
        self.rep = Employee.objects.create(
            employee_id='E001', full_name='Direct Report', employment_status='ACTIVE', manager=self.mgr
        )
        self.rep.user = self.rep_user
        self.rep.save()
        self.mgr2_user = make_user('MANAGEMENT', 'mgr2@test.com')
        self.mgr2 = Employee.objects.create(employee_id='M002', full_name='Manager Two', employment_status='ACTIVE')
        self.mgr2.user = self.mgr2_user
        self.mgr2.save()
        self.cat = ReimbursementCategory.objects.create(name='Transport', code='TRANSPORT')

    def _create(self, emp, status='PENDING'):
        return Reimbursement.objects.create(
            employee=emp, category=self.cat,
            transaction_date=date.today(), amount=50000, status=status, **BANK,
        )

    def test_management_sees_only_own(self):
        mine = self._create(self.mgr)
        self._create(self.rep)      # direct report
        self._create(self.mgr2)     # another manager
        self.client.force_login(self.mgr_user)
        resp = self.client.get('/api/reimbursements/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        results = data['results'] if isinstance(data, dict) else data
        ids = {r['id'] for r in results}
        self.assertEqual(ids, {mine.id})

    def test_management_detail_of_other_404(self):
        r = self._create(self.rep)
        r2 = self._create(self.mgr2)
        self.client.force_login(self.mgr_user)
        self.assertEqual(self.client.get(f'/api/reimbursements/{r.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/reimbursements/{r2.id}/').status_code, 404)

    def test_management_can_create_own(self):
        self.client.force_login(self.mgr_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat.id,
            'transaction_date': '2026-09-01',
            'amount': 10000,
            'project_category': 'GPFE',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['employee'], self.mgr.id)
        self.assertEqual(data['employee_name'], 'Manager')

    def test_management_cannot_set_other_requester(self):
        self.client.force_login(self.mgr_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat.id,
            'transaction_date': '2026-09-01',
            'amount': 10000,
            'employee': self.rep.id,
            'project_category': 'GPFE',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['employee'], self.mgr.id)
        r = Reimbursement.objects.get(id=resp.json()['id'])
        self.assertEqual(r.employee_id, self.mgr.id)

    def test_management_can_edit_and_submit_own_draft(self):
        self.client.force_login(self.mgr_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat.id,
            'transaction_date': '2026-09-01',
            'amount': 10000,
            'project_category': 'GPFE',
        }, content_type='application/json')
        rid = resp.json()['id']
        resp = self.client.patch(f'/api/reimbursements/{rid}/',
                                 {'amount': 15000}, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        _attach(rid)
        resp = self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'PENDING')

    def test_management_cannot_approve_reject_mark_paid(self):
        r = self._create(self.mgr, status='PENDING')
        self.client.force_login(self.mgr_user)
        resp = _approve_two_step(self.client, r.id, {'approved_amount': 40000})
        self.assertEqual(resp.status_code, 403)
        resp = self.client.post(
            f'/api/reimbursements/{r.id}/reject/',
            {'rejection_reason': 'no'}, content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)
        r2 = self._create(self.mgr, status='APPROVED')
        self.assertEqual(self.client.post(f'/api/reimbursements/{r2.id}/mark_paid/').status_code, 403)
        r.refresh_from_db()
        self.assertEqual(r.status, 'PENDING')

    def test_management_cannot_touch_other_users_reimbursement(self):
        r = self._create(self.rep)
        self.client.force_login(self.mgr_user)
        self.assertEqual(self.client.patch(
            f'/api/reimbursements/{r.id}/', {'amount': 1},
            content_type='application/json').status_code, 404)
        self.assertEqual(self.client.post(f'/api/reimbursements/{r.id}/submit/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/reimbursements/{r.id}/cancel/').status_code, 404)

    def test_hr_still_sees_all_and_can_approve(self):
        r = self._create(self.mgr)
        hr = make_user('HR_STAFF', 'hr2@test.com')
        self.client.force_login(hr)
        resp = _approve_two_step(self.client, r.id, {'approved_amount': 50000})
        self.assertEqual(resp.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')


def _attach(reimbursement_or_id):
    """Mark a draft as having an uploaded attachment (storage is mocked out)."""
    rid = getattr(reimbursement_or_id, 'pk', reimbursement_or_id)
    Reimbursement.objects.filter(pk=rid).update(
        attachment_name='nota.pdf', attachment_path=f'reimbursements/{rid}/attachments/nota.pdf',
    )


from django.test import override_settings  # noqa: E402


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class ReimbursementRevisionTests(TestCase):
    """Mandatory attachment, HR notification via the centralized engine,
    and live status summary for the Employee Overview."""

    def setUp(self):
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.lead = make_user('HR_LEAD', 'lead@test.com')
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp = Employee.objects.create(employee_id='E001', full_name='John', employment_status='ACTIVE')
        self.emp.user = self.emp_user
        self.emp.save()
        self.cat = ReimbursementCategory.objects.create(name='Meal', code='MEAL', requires_attachment=False)

    def _draft(self):
        self.client.force_login(self.emp_user)
        resp = self.client.post('/api/reimbursements/', {**BANK,
            'category': self.cat.id, 'transaction_date': '2026-09-01', 'amount': 75000,
            'description': 'Makan klien',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        return resp.json()['id']

    def test_submit_without_attachment_rejected_for_any_category(self):
        rid = self._draft()
        resp = self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Bukti Payment', resp.json()['attachment'])
        self.assertEqual(Reimbursement.objects.get(pk=rid).status, 'DRAFT')

    def test_submit_with_attachment_notifies_hr_staff_and_admin(self):
        from django.core import mail

        from apps.notifications.models import Notification

        rid = self._draft()
        _attach(rid)
        resp = self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(resp.status_code, 200, resp.content)
        notifs = Notification.objects.filter(kind='REIMBURSEMENT_SUBMITTED')
        # Stage 1 (review) -> HR Staff + Admin; HR Lead is notified after review.
        self.assertEqual({n.recipient_id for n in notifs}, {self.admin.id, self.hr.id})
        self.assertTrue(all(n.link == f'/dashboard/reimbursements?id={rid}' for n in notifs))
        self.assertTrue(all(not n.is_read for n in notifs))
        self.assertEqual(len(mail.outbox), 1)  # default HR email from settings
        self.assertIn('John', mail.outbox[0].body)
        # Bell unread count increments for HR and Admin.
        for user in (self.hr, self.admin):
            self.client.force_login(user)
            self.assertEqual(self.client.get('/api/notifications/notifications/unread_count/').json()['unread'], 1)

    def test_notification_idempotent(self):
        from django.core import mail

        from apps.notifications.models import Notification
        from apps.notifications.services import notify_reimbursement_submitted

        rid = self._draft()
        _attach(rid)
        self.client.post(f'/api/reimbursements/{rid}/submit/')
        notify_reimbursement_submitted(Reimbursement.objects.get(pk=rid))  # re-fired hook
        self.assertEqual(Notification.objects.filter(kind='REIMBURSEMENT_SUBMITTED').count(), 2)
        self.assertEqual(len(mail.outbox), 1)

    def test_summary_tracks_pending_through_approval(self):
        url = '/api/reimbursements/summary/?mine=1'
        rid = self._draft()
        self.assertEqual(self.client.get(url).json()['counts']['PENDING'], 0)
        _attach(rid)
        self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(self.client.get(url).json()['counts']['PENDING'], 1)
        self.client.force_login(self.hr)
        _approve_two_step(self.client, rid, {'approved_amount': 50000})
        self.client.force_login(self.emp_user)
        counts = self.client.get(url).json()['counts']
        self.assertEqual(counts['PENDING'], 0)
        self.assertEqual(counts['APPROVED'], 1)

    def test_summary_mine_scopes_to_own_records_for_hr(self):
        other = Employee.objects.create(employee_id='E002', full_name='Jane', employment_status='ACTIVE')
        Reimbursement.objects.create(employee=other, category=self.cat, transaction_date=date.today(),
                                     amount=1000, status='PENDING')
        self.client.force_login(self.hr)  # HR without employee record
        self.assertEqual(self.client.get('/api/reimbursements/summary/?mine=1').json()['total'], 0)
        self.assertEqual(self.client.get('/api/reimbursements/summary/').json()['counts']['PENDING'], 1)



@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class ReimbursementTwoLayerTests(TestCase):
    """Semi-hierarchical approval: HR Staff sets amount -> HR Lead approves
    payment; required bank/email fields; PDF-only evidence."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.hr = make_user('HR_STAFF', 'oci@test.com')
        self.lead = make_user('HR_LEAD', 'atika@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp = Employee.objects.create(employee_id='E001', full_name='John', employment_status='ACTIVE')
        self.emp.user = self.emp_user
        self.emp.save()
        self.cat = ReimbursementCategory.objects.create(name='Meal', code='MEAL')

    def _create(self, **over):
        self.client.force_login(self.emp_user)
        data = {'category': self.cat.id, 'transaction_date': '2026-09-01', 'amount': 100000,
                'description': 'Makan klien', **BANK}
        data.update(over)
        return self.client.post('/api/reimbursements/', data, content_type='application/json')

    def _submitted(self):
        rid = self._create().json()['id']
        _attach(rid)
        self.assertEqual(self.client.post(f'/api/reimbursements/{rid}/submit/').status_code, 200)
        return rid

    def _as(self, user, url, data=None):
        self.client.force_login(user)
        return self.client.post(url, data or {}, content_type='application/json')

    # --- required fields ---
    def test_bank_fields_and_email_required(self):
        for field in ('bank_name', 'bank_account_name', 'bank_account_number', 'contact_email'):
            res = self._create(**{field: ''})
            self.assertEqual(res.status_code, 400, field)
            self.assertIn(field, res.json())
        self.assertEqual(self._create(contact_email='bukan-email').status_code, 400)
        self.assertEqual(self._create(bank_account_number='12AB34').status_code, 400)
        res = self._create(bank_account_number='1234-5678 90')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()['bank_account_number'], '1234567890')

    def test_submit_blocks_legacy_draft_without_bank_data(self):
        r = Reimbursement.objects.create(employee=self.emp, category=self.cat, transaction_date=date(2026, 9, 1),
                                         amount=1000, status='DRAFT', attachment_path='x.pdf')
        self.client.force_login(self.emp_user)
        res = self.client.post(f'/api/reimbursements/{r.id}/submit/')
        self.assertEqual(res.status_code, 400)
        self.assertIn('bank_name', res.json())

    # --- PDF evidence ---
    def _upload(self, rid, name, content, ctype='application/pdf'):
        from unittest import mock

        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_login(self.emp_user)
        with mock.patch('apps.reimbursement.views.is_configured', return_value=True), \
             mock.patch('apps.reimbursement.views.upload_bytes') as up:
            res = self.client.post(f'/api/reimbursements/{rid}/attachment/',
                                   {'file': SimpleUploadedFile(name, content, content_type=ctype)})
        return res, up

    def test_evidence_must_be_pdf(self):
        rid = self._create().json()['id']
        res, up = self._upload(rid, 'nota.jpg', b'\xff\xd8jpeg', 'image/jpeg')
        self.assertEqual(res.status_code, 400)
        res, _ = self._upload(rid, 'nota.pdf', b'not really a pdf')  # wrong content
        self.assertEqual(res.status_code, 400)
        res, _ = self._upload(rid, 'nota.pdf', PDF_BYTES, 'image/png')  # wrong type
        self.assertEqual(res.status_code, 400)
        res, up = self._upload(rid, 'besar.pdf', PDF_BYTES + b'0' * (5 * 1024 * 1024))  # > 5 MB
        self.assertEqual(res.status_code, 400)
        self.assertIn('5 MB', res.json()['file'])
        up.assert_not_called()
        res, up = self._upload(rid, 'nota.pdf', PDF_BYTES)
        self.assertEqual(res.status_code, 200, res.content)
        up.assert_called_once()
        self.assertEqual(Reimbursement.objects.get(pk=rid).attachment_name, 'nota.pdf')

    def test_submit_requires_pdf_evidence(self):
        rid = self._create().json()['id']
        res = self.client.post(f'/api/reimbursements/{rid}/submit/')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Bukti Payment', res.json()['attachment'])

    # --- approval layers ---
    def test_full_flow_and_audit(self):
        rid = self._submitted()
        r = Reimbursement.objects.get(pk=rid)
        self.assertEqual(r.status, 'PENDING')
        res = self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 80000})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['status'], 'WAITING_HR_LEAD')
        self.assertEqual(res.json()['status_display'], 'Waiting HR Lead')
        res = self._as(self.lead, f'/api/reimbursements/{rid}/approve/')
        self.assertEqual(res.status_code, 200, res.content)
        r.refresh_from_db()
        self.assertEqual(r.status, 'APPROVED')
        self.assertEqual(float(r.approved_amount), 80000)
        self.assertEqual(r.amount_set_by, self.hr)  # who set the amount
        self.assertEqual(r.reviewer, self.lead)     # who approved payment
        self.assertTrue(AuditLog.objects.filter(object_id=str(rid), action='approve').exists())
        review_log = AuditLog.objects.filter(object_id=str(rid), description__icontains='reviewed').get()
        self.assertEqual(review_log.changes_after['approved_amount'], '80000')
        res = self._as(self.hr, f'/api/reimbursements/{rid}/mark_paid/', {'payment_reference': 'TRF-1'})
        self.assertEqual(res.status_code, 200, res.content)

    def test_hr_staff_is_not_final_approver(self):
        rid = self._submitted()
        self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 80000})
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid}/approve/').status_code, 403)
        self.assertEqual(Reimbursement.objects.get(pk=rid).status, 'WAITING_HR_LEAD')

    def test_hr_lead_cannot_set_or_change_amount(self):
        rid = self._submitted()
        # HR Lead cannot do the HR Staff review step.
        self.assertEqual(self._as(self.lead, f'/api/reimbursements/{rid}/review/', {'approved_amount': 1}).status_code, 403)
        # Cannot approve before HR Staff review.
        self.assertEqual(self._as(self.lead, f'/api/reimbursements/{rid}/approve/').status_code, 400)
        self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 80000})
        res = self._as(self.lead, f'/api/reimbursements/{rid}/approve/', {'approved_amount': 100000})
        self.assertEqual(res.status_code, 400)
        # No PATCH path either.
        self.client.force_login(self.lead)
        res = self.client.patch(f'/api/reimbursements/{rid}/', {'approved_amount': 100000}, content_type='application/json')
        self.assertIn(res.status_code, (400, 403))
        self.assertEqual(float(Reimbursement.objects.get(pk=rid).approved_amount), 80000)

    def test_review_amount_validation(self):
        rid = self._submitted()
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid}/review/', {}).status_code, 400)
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 999999}).status_code, 400)
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': -1}).status_code, 400)

    def test_reject_per_layer(self):
        rid = self._submitted()
        data = {'rejection_reason': 'Nota tidak valid'}
        self.assertEqual(self._as(self.lead, f'/api/reimbursements/{rid}/reject/', data).status_code, 403)
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid}/reject/', data).status_code, 200)
        rid2 = self._submitted()
        self._as(self.hr, f'/api/reimbursements/{rid2}/review/', {'approved_amount': 50000})
        self.assertEqual(self._as(self.hr, f'/api/reimbursements/{rid2}/reject/', data).status_code, 403)
        self.assertEqual(self._as(self.lead, f'/api/reimbursements/{rid2}/reject/', data).status_code, 200)
        self.assertEqual(Reimbursement.objects.get(pk=rid2).reviewer, self.lead)

    def test_employee_and_admin_layers(self):
        rid = self._submitted()
        self.assertEqual(self._as(self.emp_user, f'/api/reimbursements/{rid}/review/', {'approved_amount': 1}).status_code, 403)
        self.assertEqual(self._as(self.emp_user, f'/api/reimbursements/{rid}/approve/').status_code, 403)
        # Admin (superadmin fallback) may act on both layers.
        self.assertEqual(self._as(self.admin, f'/api/reimbursements/{rid}/review/', {'approved_amount': 10}).status_code, 200)
        self.assertEqual(self._as(self.admin, f'/api/reimbursements/{rid}/approve/').status_code, 200)

    def test_owner_edit_only_before_review(self):
        rid = self._submitted()
        self.client.force_login(self.emp_user)
        res = self.client.patch(f'/api/reimbursements/{rid}/', {'bank_name': 'Mandiri'}, content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)  # PENDING: still editable
        self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 50000})
        self.client.force_login(self.emp_user)
        res = self.client.patch(f'/api/reimbursements/{rid}/', {'amount': 1}, content_type='application/json')
        self.assertEqual(res.status_code, 400)
        # HR never edits via PATCH.
        self.client.force_login(self.hr)
        res = self.client.patch(f'/api/reimbursements/{rid}/', {'description': 'x'}, content_type='application/json')
        self.assertEqual(res.status_code, 403)

    def test_notifications_follow_stage(self):
        from django.core import mail

        from apps.notifications.models import Notification

        rid = self._submitted()
        stage1 = set(Notification.objects.filter(kind='REIMBURSEMENT_SUBMITTED').values_list('recipient_id', flat=True))
        self.assertEqual(stage1, {self.hr.id, self.admin.id})
        self._as(self.hr, f'/api/reimbursements/{rid}/review/', {'approved_amount': 80000})
        stage2 = set(Notification.objects.filter(kind='REIMBURSEMENT_REVIEWED').values_list('recipient_id', flat=True))
        self.assertEqual(stage2, {self.lead.id, self.admin.id})
        mail.outbox.clear()
        self._as(self.lead, f'/api/reimbursements/{rid}/approve/')
        self.assertTrue(Notification.objects.filter(kind='REIMBURSEMENT_APPROVED', recipient=self.emp_user).exists())
        self.assertEqual(mail.outbox[-1].to, ['john.transfer@gmail.com'])
        self._as(self.hr, f'/api/reimbursements/{rid}/mark_paid/', {'payment_reference': 'TRF-9'})
        paid = mail.outbox[-1]
        self.assertEqual(paid.to, ['john.transfer@gmail.com'])
        self.assertIn('TRF-9', paid.body)
        self.assertIn('BCA 1234567890', paid.body)
