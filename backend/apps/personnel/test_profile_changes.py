"""Employee self-service data: direct contact edits + change requests
approved by HR Staff / HR Lead / Admin."""
import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.notifications.models import Notification

from .models import Employee, EmployeeChangeRequest

User = get_user_model()
PDF = b'%PDF-1.4 ktp scan'
ME = '/api/auth/me/employee/'
MY_CR = '/api/auth/me/employee/change-requests/'
HR_CR = '/api/employee-change-requests/'


def make_user(key, username):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='x')
    user.role = role
    user.save()
    return user


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', NOTIFICATION_EMAIL_ASYNC=False)
class ProfileChangeTests(TestCase):
    def setUp(self):
        self.emp_user = make_user('EMPLOYEE', 'budi@test.com')
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='Budi', nik='3201000000000001', phone='0811', address='Jl. Lama',
            personal_email='budi.lama@gmail.com', bank_account_number='1234567890', bank_account_name='Budi',
            religion='ISLAM', user=self.emp_user,
        )
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.lead = make_user('HR_LEAD', 'lead@test.com')
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.mgmt = make_user('MANAGEMENT', 'mgmt@test.com')

    def _submit(self, changes, attach=True, note='Ganti KTP baru', user=None):
        self.client.force_login(user or self.emp_user)
        data = {'changes': json.dumps(changes), 'note': note}
        if attach:
            data['attachment'] = SimpleUploadedFile('ktp.pdf', PDF, content_type='application/pdf')
        with mock.patch('apps.personnel.profile_changes.upload_bytes') as up:
            res = self.client.post(MY_CR, data)
        return res, up

    # --- direct edit ---
    def test_direct_edit_contact_fields_with_audit(self):
        self.client.force_login(self.emp_user)
        res = self.client.patch(ME, {'phone': '0822', 'address': 'Jl. Baru 1', 'emergency_contact_name': 'Ani'},
                                content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.emp.refresh_from_db()
        self.assertEqual((self.emp.phone, self.emp.address, self.emp.emergency_contact_name), ('0822', 'Jl. Baru 1', 'Ani'))
        log = AuditLog.objects.filter(description__contains='updated own contact data').latest('id')
        self.assertEqual(log.changes_before.get('phone'), '0811')

    def test_direct_edit_rejects_protected_fields(self):
        self.client.force_login(self.emp_user)
        for field, value in (('nik', '3201000000000009'), ('bank_account_number', '999'), ('department', 1)):
            res = self.client.patch(ME, {field: value}, content_type='application/json')
            self.assertEqual(res.status_code, 400, field)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.nik, '3201000000000001')

    def test_personal_email_change_notifies_old_and_new_address(self):
        self.client.force_login(self.emp_user)
        res = self.client.patch(ME, {'personal_email': 'budi.baru@gmail.com'}, content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual({m.to[0] for m in mail.outbox}, {'budi.lama@gmail.com', 'budi.baru@gmail.com'})

    # --- submit ---
    def test_submit_requires_attachment_for_identity_but_not_religion(self):
        res, _ = self._submit({'nik': '3201000000000002'}, attach=False)
        self.assertEqual(res.status_code, 400)
        self.assertIn('attachment', res.json())
        res, up = self._submit({'religion': 'PROTESTAN'}, attach=False)
        self.assertEqual(res.status_code, 201, res.content)
        up.assert_not_called()

    def test_submit_validation(self):
        cases = (
            ({'department': 2}, 'changes'),                 # HR-only field
            ({'nik': '3201000000000001'}, 'changes'),       # same as current
            ({'nik': '32-01'}, 'nik'),                      # serializer validation (digits only)
            ({}, 'changes'),
        )
        for changes, key in cases:
            res, _ = self._submit(changes)
            self.assertEqual(res.status_code, 400, changes)
            self.assertIn(key, res.json(), changes)

    def test_submit_rejects_non_pdf_image_attachment(self):
        self.client.force_login(self.emp_user)
        res = self.client.post(MY_CR, {'changes': json.dumps({'nik': '3201000000000002'}),
                                       'attachment': SimpleUploadedFile('ktp.pdf', b'<html>x', content_type='application/pdf')})
        self.assertEqual(res.status_code, 400)
        self.assertIn('attachment', res.json())

    def test_submit_creates_pending_notifies_hr_and_blocks_duplicate_field(self):
        res, up = self._submit({'nik': '3201000000000002', 'full_name': 'Budi Santoso'})
        self.assertEqual(res.status_code, 201, res.content)
        up.assert_called_once()
        cr = EmployeeChangeRequest.objects.get()
        self.assertEqual(cr.changes['nik'], {'old': '3201000000000001', 'new': '3201000000000002'})
        self.assertTrue(cr.attachment_path.startswith(f'change-requests/{self.emp.pk}/{cr.pk}-'))
        recipients = set(Notification.objects.filter(kind='PROFILE_CHANGE_SUBMITTED').values_list('recipient_id', flat=True))
        self.assertEqual(recipients, {self.hr.id, self.lead.id, self.admin.id})
        # Data not changed yet.
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.nik, '3201000000000001')
        res, _ = self._submit({'nik': '3201000000000003'})
        self.assertEqual(res.status_code, 400)
        self.assertIn('menunggu persetujuan', res.json()['changes'])

    def test_employee_sees_masked_values_hr_sees_full(self):
        self._submit({'nik': '3201000000000002'})
        self.client.force_login(self.emp_user)
        item = self.client.get(MY_CR).json()[0]['items'][0]
        self.assertNotIn('3201000000000002', item['new'])
        self.assertTrue(item['new'].endswith('0002'))
        self.client.force_login(self.hr)
        rows = self.client.get(HR_CR).json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        self.assertEqual(rows[0]['items'][0]['new'], '3201000000000002')

    # --- review ---
    def test_hr_staff_lead_admin_can_approve_and_values_are_applied(self):
        for reviewer, nik in ((self.hr, '3201000000000002'), (self.lead, '3201000000000003'), (self.admin, '3201000000000004')):
            self._submit({'nik': nik})
            cr = EmployeeChangeRequest.objects.filter(status='PENDING').get()
            self.client.force_login(reviewer)
            res = self.client.post(f'{HR_CR}{cr.pk}/approve/')
            self.assertEqual(res.status_code, 200, res.content)
            self.emp.refresh_from_db()
            self.assertEqual(self.emp.nik, nik)
            cr.refresh_from_db()
            self.assertEqual((cr.status, cr.reviewed_by_id), ('APPROVED', reviewer.id))
        self.assertEqual(Notification.objects.filter(kind='PROFILE_CHANGE_APPROVED', recipient=self.emp_user).count(), 3)

    def test_bank_change_approval_sends_security_email(self):
        self._submit({'bank_account_number': '5555666677'})
        cr = EmployeeChangeRequest.objects.get()
        self.client.force_login(self.hr)
        self.client.post(f'{HR_CR}{cr.pk}/approve/')
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.bank_account_number, '5555666677')
        self.assertIn('budi.lama@gmail.com', [m.to[0] for m in mail.outbox])
        self.assertIn('Rekening bank', mail.outbox[-1].subject)

    def test_reject_requires_reason_and_keeps_data(self):
        self._submit({'nik': '3201000000000002'})
        cr = EmployeeChangeRequest.objects.get()
        self.client.force_login(self.hr)
        self.assertEqual(self.client.post(f'{HR_CR}{cr.pk}/reject/').status_code, 400)
        res = self.client.post(f'{HR_CR}{cr.pk}/reject/', {'rejection_reason': 'KTP buram'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.emp.refresh_from_db()
        self.assertEqual(self.emp.nik, '3201000000000001')
        self.assertTrue(Notification.objects.filter(kind='PROFILE_CHANGE_REJECTED', recipient=self.emp_user).exists())
        # Already processed.
        self.assertEqual(self.client.post(f'{HR_CR}{cr.pk}/approve/').status_code, 400)

    def test_hr_cannot_approve_own_request(self):
        hr_emp = Employee.objects.create(employee_id='E002', full_name='HR Person', nik='3201000000000010', user=self.hr)
        res, _ = self._submit({'nik': '3201000000000011'}, user=self.hr)
        self.assertEqual(res.status_code, 201, res.content)
        cr = EmployeeChangeRequest.objects.get(employee=hr_emp)
        self.client.force_login(self.hr)
        self.assertEqual(self.client.post(f'{HR_CR}{cr.pk}/approve/').status_code, 400)
        self.client.force_login(self.lead)
        self.assertEqual(self.client.post(f'{HR_CR}{cr.pk}/approve/').status_code, 200)

    def test_non_hr_roles_cannot_use_review_endpoints(self):
        self._submit({'religion': 'PROTESTAN'}, attach=False)
        cr = EmployeeChangeRequest.objects.get()
        for user in (self.emp_user, self.mgmt):
            self.client.force_login(user)
            self.assertEqual(self.client.get(HR_CR).status_code, 403)
            self.assertEqual(self.client.post(f'{HR_CR}{cr.pk}/approve/').status_code, 403)

    def test_approve_revalidates_against_current_data(self):
        self._submit({'nik': '3201000000000002'})
        cr = EmployeeChangeRequest.objects.get()
        # Another employee took that NIK meanwhile -> approval must fail.
        Employee.objects.create(employee_id='E003', full_name='Other', nik='3201000000000002')
        self.client.force_login(self.hr)
        res = self.client.post(f'{HR_CR}{cr.pk}/approve/')
        self.assertEqual(res.status_code, 400)
        cr.refresh_from_db()
        self.assertEqual(cr.status, 'PENDING')

    def test_employee_can_cancel_own_pending_and_stream_attachment(self):
        self._submit({'nik': '3201000000000002'})
        cr = EmployeeChangeRequest.objects.get()
        self.client.force_login(self.emp_user)
        upstream = mock.Mock()
        upstream.iter_content.return_value = iter([PDF])
        with mock.patch('apps.personnel.storage.open_object', return_value=upstream):
            res = self.client.get(f'{MY_CR}{cr.pk}/attachment/')
            self.assertEqual(b''.join(res.streaming_content), PDF)
        res = self.client.post(f'{MY_CR}{cr.pk}/cancel/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['status'], 'CANCELLED')
        # Other employees cannot see it.
        other = make_user('EMPLOYEE', 'other@test.com')
        Employee.objects.create(employee_id='E009', full_name='Other', user=other)
        self.client.force_login(other)
        self.assertEqual(self.client.post(f'{MY_CR}{cr.pk}/cancel/').status_code, 404)
