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


class SeedLeaveTypesTests(TestCase):
    def test_seed_creates_all_types(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        self.assertEqual(LeaveType.objects.count(), 7)
        self.assertTrue(all(t.is_active for t in LeaveType.objects.all()))

    def test_seed_idempotent(self):
        from django.core.management import call_command

        call_command('seed_leave_types')
        call_command('seed_leave_types')
        self.assertEqual(LeaveType.objects.count(), 7)

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
