from datetime import date

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.leaves.models import LeaveType
from apps.personnel.models import Employee, EmployeeContract


class QuotaSummaryQueryCountTests(TestCase):
    """HR quota list (dashboard/leave?tab=quota): DB queries per page must not
    grow with employees x quota types (Supabase round-trips are slow)."""

    def setUp(self):
        role, _ = Role.objects.get_or_create(key='HR_STAFF', defaults={'name': 'HR'})
        self.hr = User.objects.create_user(username='hr.perf@test.com', email='hr.perf@test.com', password='x')
        self.hr.role = role
        self.hr.save()
        LeaveType.objects.create(name='Cuti Tahunan', code='ANNUAL', kind='LEAVE', default_quota=12, carry_forward_max=3)
        LeaveType.objects.create(name='Cuti Besar', code='BIG', kind='LEAVE', default_quota=5)
        for i in range(10):
            emp = Employee.objects.create(employee_id=f'P{i:03d}', full_name=f'Emp {i:02d}',
                                          employment_status='ACTIVE', join_date=date(2023, 1, 10))
            EmployeeContract.objects.create(employee=emp, contract_type='PKWT', start_date=date(2026, 1, 1),
                                            end_date=date(2026, 12, 31), status='ACTIVE')
        self.api = APIClient()
        self.api.force_authenticate(self.hr)

    def _page(self):
        with CaptureQueriesContext(connection) as ctx:
            res = self.api.get('/api/leaves/balances/summary/', {'year': 2026, 'page': 1})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 10)
        return len(ctx.captured_queries), res.data

    def test_query_count_is_constant_per_page(self):
        self._page()  # first visit creates balance rows (one-time, per employee/year)
        warm, data = self._page()  # typical visit: rows already exist
        # Was 92 (10 employees x 2 types); now a fixed handful regardless of size.
        self.assertLessEqual(warm, 8)
        row = data['results'][0]['rows']
        self.assertEqual({r['leave_type_code'] for r in row}, {'ANNUAL', 'BIG'})

    def test_values_match_single_employee_summary(self):
        from apps.leaves.services import balance_summary

        _, data = self._page()
        emp = Employee.objects.get(full_name='Emp 00')
        single = balance_summary(emp, year=2026)
        page_rows = next(r['rows'] for r in data['results'] if r['employee'] == emp.id)
        self.assertEqual(
            [(r['leave_type_code'], float(r['allocated_days']), float(r['remaining_days'])) for r in single],
            [(r['leave_type_code'], r['allocated_days'], r['remaining_days']) for r in page_rows],
        )
