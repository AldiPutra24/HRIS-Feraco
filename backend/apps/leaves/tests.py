from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.personnel.models import Employee

from .models import LeaveBalance, LeaveRequest, LeaveType
from .services import apply_approval_deduction, compute_total_days, get_balance

User = get_user_model()


def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class LeaveWorkflowTests(TestCase):
    def setUp(self):
        self.manager = make_user('MANAGEMENT', 'manager@test.com')
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.manager_emp = Employee.objects.create(
            employee_id='M001', full_name='Manager', employment_status='ACTIVE',
        )
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE', manager=self.manager_emp,
        )
        self.emp.user = self.emp_user
        self.emp.save()
        self.annual = LeaveType.objects.create(name='Annual Leave', code='ANNUAL', default_quota=12)

    def test_compute_total_days(self):
        self.assertEqual(compute_total_days(date(2026, 1, 1), date(2026, 1, 3)), 3)

    def test_create_leave_type(self):
        lt = LeaveType.objects.create(name='Sick', code='SICK', default_quota=0)
        self.assertEqual(lt.code, 'SICK')

    def test_create_balance(self):
        bal = get_balance(self.emp, self.annual, 2026)
        self.assertEqual(bal.remaining_days, 12)

    def test_submit_request_default_pending(self):
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        self.assertEqual(lr.status, 'PENDING')

    def test_approve_deducts_balance_once(self):
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        apply_approval_deduction(lr)
        bal = get_balance(self.emp, self.annual, 2026)
        self.assertEqual(bal.used_days, 3)
        self.assertEqual(bal.remaining_days, 9)
        # Idempotent: second call must not double-deduct.
        apply_approval_deduction(lr)
        bal.refresh_from_db()
        self.assertEqual(bal.used_days, 3)

    def test_insufficient_balance_rejected(self):
        lr = LeaveRequest(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 20), total_days=16,
        )
        bal = get_balance(self.emp, self.annual, 2026)
        self.assertGreater(lr.total_days, bal.remaining_days)

    def test_invalid_date_range(self):
        self.assertEqual(compute_total_days(date(2026, 1, 10), date(2026, 1, 5)), 0)

    def test_inactive_employee_cannot_submit_via_serializer(self):
        self.emp.employment_status = 'INACTIVE'
        self.emp.save()
        from .serializers import LeaveRequestSerializer

        serializer = LeaveRequestSerializer(
            data={
                'leave_type': self.annual.id,
                'start_date': '2026-01-05',
                'end_date': '2026-01-07',
            },
            context={'request': None},
        )
        self.assertFalse(serializer.is_valid())

    def test_kind_mismatch_rejected(self):
        from .serializers import LeaveRequestSerializer

        LeaveType.objects.create(name='Izin Pribadi', code='PERSONAL', kind='PERMISSION')
        # Leave (annual) with kind=PERMISSION => mismatch.
        serializer = LeaveRequestSerializer(
            data={
                'leave_type': self.annual.id,
                'kind': 'PERMISSION',
                'start_date': '2026-01-05',
                'end_date': '2026-01-07',
                'reason': 'Keperluan pribadi',
            },
            context={'request': None},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('kind', serializer.errors)

    def test_duplicate_submission_rejected(self):
        import json
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(self.emp_user)
        payload = {
            'leave_type': self.annual.id,
            'kind': 'LEAVE',
            'start_date': '2026-01-05',
            'end_date': '2026-01-07',
            'reason': 'Same request',
        }
        resp1 = client.post('/api/leaves/requests/', payload, format='json')
        self.assertEqual(resp1.status_code, 201)
        resp2 = client.post('/api/leaves/requests/', payload, format='json')
        self.assertEqual(resp2.status_code, 400)
        self.assertIn('Pengajuan yang sama sudah ada', json.dumps(resp2.data))

    def test_self_approval_rejected(self):
        # Employee (non-approver) cannot approve any request, incl. their own.
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        self.client.force_login(self.emp_user)
        url = reverse('leave-request-approve', args=[lr.id])
        res = self.client.post(url)
        self.assertEqual(res.status_code, 403)

    def test_audit_log_on_submit(self):
        from apps.audit.models import AuditLog

        before = AuditLog.objects.count()
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        self.assertGreaterEqual(AuditLog.objects.count(), before)

    def test_hard_delete_non_admin_forbidden(self):
        """HR_STAFF is not ADMIN → hard delete forbidden (403)."""
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        self.client.force_login(self.hr)  # HR_STAFF in LEAVE_ADMIN_ROLES but not ADMIN
        url = reverse('leave-request-hard-delete', args=[lr.id])
        res = self.client.delete(url)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(LeaveRequest.objects.filter(pk=lr.id).exists())

    def test_hard_delete_admin_ok_superadmin(self):
        """Superuser can hard-delete."""
        admin = make_user('ADMIN', 'admin@test.com')
        admin.is_superuser = True
        admin.save()
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        self.client.force_login(admin)
        url = reverse('leave-request-hard-delete', args=[lr.id])
        res = self.client.delete(url)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(LeaveRequest.objects.filter(pk=lr.id).exists())

    def test_hard_delete_restores_balance(self):
        """Hard-deleting an approved request restores the deducted quota."""
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        lr.status = 'APPROVED'
        lr.save(update_fields=['status'])
        apply_approval_deduction(lr)
        bal = get_balance(self.emp, self.annual, 2026)
        self.assertEqual(bal.used_days, 3)
        admin = make_user('ADMIN', 'admin@test.com')
        admin.is_superuser = True
        admin.save()
        self.client.force_login(admin)
        url = reverse('leave-request-hard-delete', args=[lr.id])
        self.client.delete(url)
        bal.refresh_from_db()
        self.assertEqual(bal.used_days, 0)
        self.assertEqual(bal.remaining_days, 12)

    def test_hard_delete_destroy_endpoint_only_admin(self):
        """Plain DELETE /requests/{id}/ also restricted to admin."""
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.annual,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 7), total_days=3,
        )
        # Employee owner cannot delete
        self.client.force_login(self.emp_user)
        url = reverse('leave-request-detail', args=[lr.id])
        res = self.client.delete(url)
        self.assertEqual(res.status_code, 403)
        # Admin can
        admin = make_user('ADMIN', 'admin@test.com')
        admin.is_superuser = True
        admin.save()
        self.client.force_login(admin)
        res = self.client.delete(url)
        self.assertEqual(res.status_code, 204)


class SeedLeaveTypesTests(TestCase):
    def test_seed_creates_all_types(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        self.assertEqual(LeaveType.objects.count(), 13)
        self.assertTrue(all(t.is_active for t in LeaveType.objects.all()))

    def test_seed_idempotent(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        call_command('seed_leave_types')
        self.assertEqual(LeaveType.objects.count(), 13)

    def test_seed_kinds(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        self.assertEqual(LeaveType.objects.filter(kind='LEAVE').count(), 9)
        self.assertEqual(LeaveType.objects.filter(kind='PERMISSION').count(), 4)

    def test_seed_business_rules(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        annual = LeaveType.objects.get(code='ANNUAL')
        self.assertEqual(annual.max_days_per_request, 3)
        self.assertEqual(annual.min_tenure_months, 3)
        self.assertEqual(annual.carry_forward_max, 3)
        self.assertTrue(annual.is_paid)
        # Cuti Berobat deducts from Cuti Tahunan.
        medical = LeaveType.objects.get(code='MEDICAL')
        self.assertEqual(medical.deducts_from_id, annual.id)
        # Izin Sakit: 1 day free, >1 day needs doctor's note.
        sick = LeaveType.objects.get(code='SICK')
        self.assertEqual(sick.max_days_without_attachment, 1)
        self.assertFalse(sick.is_paid)
        self.assertEqual(sick.kind, 'PERMISSION')
        # Exactly 13 categories; no duplicates.
        self.assertEqual(LeaveType.objects.filter(name='Cuti Menikah').count(), 1)

    def test_api_returns_active_types(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        LeaveType.objects.filter(code='SICK').update(is_active=False)
        self.client.force_login(make_user('EMPLOYEE', 'emp2@test.com'))
        res = self.client.get(reverse('leave-type-list'))
        self.assertEqual(res.status_code, 200)
        codes = {t['code'] for t in res.json()}
        self.assertIn('ANNUAL', codes)
        self.assertNotIn('SICK', codes)


class BusinessRuleTests(TestCase):
    """Serialized business validations for leave categories."""

    def setUp(self):
        from types import SimpleNamespace

        from .serializers import LeaveRequestSerializer

        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.emp = Employee.objects.create(
            employee_id='E001', full_name='John', employment_status='ACTIVE',
        )
        self.emp.user = self.emp_user
        self.emp.join_date = date(2024, 1, 1)  # long enough tenure
        self.emp.save()
        self.SR = LeaveRequestSerializer
        self.req = SimpleNamespace(user=self.emp_user)

    def _valid(self, lt, start='2026-01-05', end='2026-01-07', extra=None):
        data = {'leave_type': lt.id, 'start_date': start, 'end_date': end, 'kind': lt.kind, 'reason': 'x'}
        if extra:
            data.update(extra)
        return self.SR(data=data, context={'request': self.req})

    def test_max_days_cap(self):
        annual = LeaveType.objects.create(
            name='Annual', code='ANNUAL', kind='LEAVE', default_quota=12,
            max_days_per_request=3, min_tenure_months=3,
        )
        s = self._valid(annual, '2026-01-05', '2026-01-09')  # 5 days > 3
        self.assertFalse(s.is_valid())
        self.assertIn('end_date', s.errors)

    def test_min_tenure(self):
        annual = LeaveType.objects.create(
            name='Annual', code='ANNUAL', kind='LEAVE', default_quota=12,
            max_days_per_request=3, min_tenure_months=3,
        )
        self.emp.join_date = date(2026, 1, 1)  # only 1 month tenure
        self.emp.save()
        s = self._valid(annual)
        self.assertFalse(s.is_valid())
        self.assertIn('start_date', s.errors)

    def test_sick_doctor_note_required(self):
        sick = LeaveType.objects.create(
            name='Sick', code='SICK', kind='PERMISSION',
            max_days_without_attachment=1, is_paid=False,
        )
        # 1 day, no attachment: OK.
        s = self._valid(sick, '2026-01-05', '2026-01-05')
        self.assertTrue(s.is_valid(), s.errors)
        # 2 days, no attachment: rejected.
        s = self._valid(sick, '2026-01-05', '2026-01-06')
        self.assertFalse(s.is_valid())
        self.assertIn('attachment_name', s.errors)
        # 2 days WITH attachment: OK.
        s = self._valid(sick, '2026-01-05', '2026-01-06', {'attachment_name': 'surat_dokter.pdf'})
        self.assertTrue(s.is_valid(), s.errors)

    def test_requires_attachment(self):
        misc = LeaveType.objects.create(
            name='Miscarriage', code='MISCARRIAGE', kind='LEAVE',
            requires_attachment=True, is_paid=True,
        )
        s = self._valid(misc, '2026-01-05', '2026-01-05')
        self.assertFalse(s.is_valid())
        self.assertIn('attachment_name', s.errors)

    def test_medical_deducts_from_annual(self):
        annual = LeaveType.objects.create(
            name='Annual', code='ANNUAL', kind='LEAVE', default_quota=12,
            max_days_per_request=3, min_tenure_months=3,
        )
        medical = LeaveType.objects.create(
            name='Medical', code='MEDICAL', kind='LEAVE',
            deducts_from=annual, is_paid=True,
        )
        # Approved Medical leave deducts from ANNUAL balance, not MEDICAL.
        lr = LeaveRequest.objects.create(
            employee=self.emp, leave_type=medical,
            start_date=date(2026, 1, 5), end_date=date(2026, 1, 6), total_days=2,
        )
        apply_approval_deduction(lr)
        annual_bal = get_balance(self.emp, annual, 2026)
        self.assertEqual(annual_bal.used_days, 2)
        self.assertEqual(annual_bal.remaining_days, 10)
        med_bal = get_balance(self.emp, medical, 2026)
        self.assertEqual(med_bal.used_days, 0)

    def test_carry_forward_capped(self):
        annual = LeaveType.objects.create(
            name='Annual', code='ANNUAL', kind='LEAVE', default_quota=12,
            max_days_per_request=3, min_tenure_months=3, carry_forward_max=3,
        )
        # 2025: use 10 of 12 -> 2 remaining (under cap).
        b25 = get_balance(self.emp, annual, 2025)
        b25.used_days = 10
        b25.remaining_days = 2
        b25.save(update_fields=['used_days', 'remaining_days'])
        # 2026: 12 + carry min(2, 3) = 14.
        b26 = get_balance(self.emp, annual, 2026)
        self.assertEqual(b26.allocated_days, 14)
        self.assertEqual(b26.remaining_days, 14)
        # Cap at 3: 5 remaining -> carry 3 -> 15.
        b25.remaining_days = 5
        b25.save(update_fields=['remaining_days'])
        b26.delete()
        b26b = get_balance(self.emp, annual, 2026)
        self.assertEqual(b26b.allocated_days, 15)

    def test_unpaid_permission(self):
        personal = LeaveType.objects.create(
            name='Personal', code='PERSONAL', kind='PERMISSION', is_paid=False,
        )
        s = self._valid(personal, '2026-01-05', '2026-01-05')
        self.assertTrue(s.is_valid(), s.errors)
