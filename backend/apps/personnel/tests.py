from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Department, Employee, EmployeeContract, EmploymentHistory, Position
from .services import set_current_contract, sync_contract_status

User = get_user_model()


def make_user(role='ADMIN'):
    from apps.accounts.models import Role

    role_obj, _ = Role.objects.get_or_create(key=role, defaults={'name': role})
    user = User.objects.create_user(username=f'{role.lower()}@test.com', email=f'{role.lower()}@test.com', password='password')
    user.role = role_obj
    user.save()
    return user


class EmployeeModelTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name='Engineering')
        self.pos = Position.objects.create(name='Engineer', department=self.dept)

    def test_employee_creates(self):
        emp = Employee.objects.create(employee_id='E001', full_name='John Doe', nik='1234567890')
        self.assertEqual(emp.full_name, 'John Doe')

    def test_duplicate_nik_rejected(self):
        Employee.objects.create(employee_id='E001', full_name='A', nik='1234567890')
        with self.assertRaises(Exception):
            Employee.objects.create(employee_id='E002', full_name='B', nik='1234567890')

    def test_contract_history(self):
        emp = Employee.objects.create(employee_id='E001', full_name='John')
        c = EmployeeContract.objects.create(employee=emp, contract_type='PKWT', start_date='2024-01-01')
        self.assertEqual(emp.contracts.count(), 1)
        self.assertEqual(c.contract_type, 'PKWT')

    def test_employment_history(self):
        emp = Employee.objects.create(employee_id='E001', full_name='John')
        h = EmploymentHistory.objects.create(
            employee=emp, date='2024-06-01', history_type='PROMOTION',
            new_department=self.dept, new_position=self.pos,
        )
        self.assertEqual(emp.history.count(), 1)


class ContractStatusTests(TestCase):
    def setUp(self):
        self.emp = Employee.objects.create(employee_id='E001', full_name='John')

    def _contract(self, **over):
        data = {
            'employee': self.emp,
            'contract_type': 'PKWT',
            'start_date': date.today() - timedelta(days=10),
            'end_date': date.today() + timedelta(days=30),
        }
        data.update(over)
        return EmployeeContract.objects.create(**data)

    def test_new_contract_defaults_draft(self):
        c = self._contract()
        self.assertEqual(c.status, 'DRAFT')
        self.assertFalse(c.is_current)

    def test_activate_contract(self):
        c = self._contract()
        set_current_contract(c)
        c.refresh_from_db()
        self.assertEqual(c.status, 'ACTIVE')
        self.assertTrue(c.is_current)

    def test_only_one_current_per_employee(self):
        c1 = self._contract()
        set_current_contract(c1)
        c2 = self._contract(start_date=date.today() + timedelta(days=1), end_date=date.today() + timedelta(days=60))
        set_current_contract(c2)
        c1.refresh_from_db()
        c2.refresh_from_db()
        self.assertEqual(c1.status, 'ACTIVE')
        self.assertEqual(c2.status, 'RENEWED')
        self.assertEqual([x for x in (c1, c2) if x.is_current], [c1])

    def test_expired_contract_sync(self):
        c = self._contract(end_date=date.today() - timedelta(days=1))
        c.status = 'ACTIVE'
        c.save()
        n = sync_contract_status()
        c.refresh_from_db()
        self.assertEqual(n, 1)
        self.assertEqual(c.status, 'EXPIRED')
        self.assertFalse(c.is_current)

    def test_expired_not_current(self):
        c = self._contract(end_date=date.today() - timedelta(days=1), status='ACTIVE')
        self.assertFalse(c.is_current)

    def test_expired_promotes_renewed(self):
        active = self._contract(end_date=date.today() - timedelta(days=1), status='ACTIVE')
        renewed = self._contract(
            start_date=date.today(),
            end_date=date.today() + timedelta(days=60),
            status='RENEWED',
        )
        sync_contract_status()
        active.refresh_from_db()
        renewed.refresh_from_db()
        self.assertEqual(active.status, 'EXPIRED')
        self.assertEqual(renewed.status, 'ACTIVE')
        self.assertTrue(renewed.is_current)

    def test_renew_marks_old_renewed(self):
        c = self._contract(status='ACTIVE')
        c.status = 'RENEWED'
        c.save(update_fields=['status'])
        c.refresh_from_db()
        self.assertEqual(c.status, 'RENEWED')

    def test_terminate_contract(self):
        c = self._contract(status='ACTIVE')
        c.status = 'TERMINATED'
        c.termination_date = timezone.localdate()
        c.save(update_fields=['status', 'termination_date'])
        c.refresh_from_db()
        self.assertEqual(c.status, 'TERMINATED')
        self.assertFalse(c.is_current)


class EmployeeApiTests(TestCase):
    def setUp(self):
        self.user = make_user('ADMIN')
        self.client.force_login(self.user)
        self.dept = Department.objects.create(name='Engineering')
        self.pos = Position.objects.create(name='Engineer', department=self.dept)

    def _create(self, **over):
        data = {
            'employee_id': 'E001',
            'full_name': 'John Doe',
            'nik': '1234567890',
            'department': self.dept.id,
            'position': self.pos.id,
            'employment_status': 'ACTIVE',
        }
        data.update(over)
        return self.client.post(reverse('employee-list'), data, content_type='application/json')

    def test_create_employee(self):
        res = self._create()
        self.assertEqual(res.status_code, 201)

    def test_update_employee(self):
        emp = Employee.objects.create(employee_id='E001', full_name='John')
        res = self.client.patch(reverse('employee-detail', args=[emp.pk]), {'full_name': 'John Updated'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        emp.refresh_from_db()
        self.assertEqual(emp.full_name, 'John Updated')

    def test_validation_nik_non_digit(self):
        res = self._create(nik='ABC123')
        self.assertEqual(res.status_code, 400)

    def test_duplicate_nik_api(self):
        self._create()
        res = self._create(employee_id='E002')
        self.assertEqual(res.status_code, 400)

    def test_employee_detail(self):
        emp = Employee.objects.create(employee_id='E001', full_name='John', nik='1234567890')
        res = self.client.get(reverse('employee-detail', args=[emp.pk]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['full_name'], 'John')

    def test_pagination_search_filter(self):
        Employee.objects.create(employee_id='E001', full_name='Alice', department=self.dept)
        Employee.objects.create(employee_id='E002', full_name='Bob', department=self.dept)
        res = self.client.get(reverse('employee-list'), {'search': 'Alice'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)
        res = self.client.get(reverse('employee-list'), {'department': self.dept.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 2)

    def test_permission_denied(self):
        self.client.logout()
        res = self.client.get(reverse('employee-list'))
        self.assertEqual(res.status_code, 403)


class ContractApiTests(TestCase):
    def setUp(self):
        self.user = make_user('ADMIN')
        self.client.force_login(self.user)
        self.emp = Employee.objects.create(employee_id='E001', full_name='John')

    def _post(self, **over):
        data = {
            'contract_type': 'PKWT',
            'start_date': (timezone.localdate() - timedelta(days=10)).isoformat(),
            'end_date': (timezone.localdate() + timedelta(days=365)).isoformat(),
        }
        data.update(over)
        return self.client.post(
            reverse('employee-contracts', args=[self.emp.pk]), data, content_type='application/json'
        )

    def test_manual_status_rejected(self):
        res = self._post(status='ACTIVE')
        self.assertEqual(res.status_code, 400)

    def test_activate_creates_active(self):
        res = self._post(activate=True)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'ACTIVE')
        self.assertTrue(res.data['is_current'])

    def test_default_draft(self):
        res = self._post()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'DRAFT')


class DepartmentApiTests(TestCase):
    def setUp(self):
        self.user = make_user('ADMIN')
        self.client.force_login(self.user)

    def _post(self, name, code=''):
        return self.client.post(reverse('department-list'), {'name': name, 'code': code}, content_type='application/json')

    def test_list_departments(self):
        Department.objects.create(name='Engineering')
        res = self.client.get(reverse('department-list'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_create_department(self):
        res = self._post('Finance', 'FIN')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['name'], 'Finance')
        self.assertTrue(res.data['is_active'])

    def test_duplicate_name_rejected(self):
        self._post('Finance')
        res = self._post('Finance')
        self.assertEqual(res.status_code, 400)

    def test_update_department(self):
        dept = Department.objects.create(name='Finance')
        res = self.client.patch(reverse('department-detail', args=[dept.pk]), {'code': 'FIN'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        dept.refresh_from_db()
        self.assertEqual(dept.code, 'FIN')

    def test_deactivate_department(self):
        dept = Department.objects.create(name='Finance')
        res = self.client.patch(reverse('department-detail', args=[dept.pk]), {'is_active': False}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        dept.refresh_from_db()
        self.assertFalse(dept.is_active)

    def test_delete_unused_department(self):
        dept = Department.objects.create(name='Finance')
        res = self.client.delete(reverse('department-detail', args=[dept.pk]))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Department.objects.filter(pk=dept.pk).exists())

    def test_delete_used_department_rejected(self):
        dept = Department.objects.create(name='Finance')
        Employee.objects.create(employee_id='E001', full_name='John', department=dept)
        res = self.client.delete(reverse('department-detail', args=[dept.pk]))
        self.assertEqual(res.status_code, 400)
        self.assertTrue(Department.objects.filter(pk=dept.pk).exists())

    def test_employee_create_with_department(self):
        dept = Department.objects.create(name='Finance')
        res = self.client.post(reverse('employee-list'), {
            'full_name': 'Jane', 'nik': '1234567890', 'department': dept.id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['department'], dept.id)

    def test_inactive_department_rejected(self):
        dept = Department.objects.create(name='Finance', is_active=False)
        res = self.client.post(reverse('employee-list'), {
            'full_name': 'Jane', 'nik': '1234567890', 'department': dept.id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)

class PositionApiTests(TestCase):
    def setUp(self):
        self.user = make_user('ADMIN')
        self.client.force_login(self.user)
        self.dept_a = Department.objects.create(name='Engineering')
        self.dept_b = Department.objects.create(name='Finance')

    def _post(self, name, dept, code=''):
        return self.client.post(reverse('position-list'), {
            'name': name, 'department': dept.id, 'code': code,
        }, content_type='application/json')

    def test_create_position(self):
        res = self._post('Engineer', self.dept_a, 'ENG')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['name'], 'Engineer')
        self.assertTrue(res.data['is_active'])

    def test_duplicate_position_in_department_rejected(self):
        self._post('Engineer', self.dept_a)
        res = self._post('Engineer', self.dept_a)
        self.assertEqual(res.status_code, 400)

    def test_same_name_different_department_allowed(self):
        self._post('Engineer', self.dept_a)
        res = self._post('Engineer', self.dept_b)
        self.assertEqual(res.status_code, 201)

    def test_filter_position_by_department(self):
        self._post('Engineer', self.dept_a)
        self._post('Analyst', self.dept_b)
        res = self.client.get(reverse('position-list'), {'department': self.dept_a.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['name'], 'Engineer')

    def test_activate_deactivate_position(self):
        pos = Position.objects.create(name='Engineer', department=self.dept_a)
        res = self.client.patch(reverse('position-detail', args=[pos.pk]), {'is_active': False}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        pos.refresh_from_db()
        self.assertFalse(pos.is_active)

    def test_delete_used_position_rejected(self):
        pos = Position.objects.create(name='Engineer', department=self.dept_a)
        Employee.objects.create(employee_id='E001', full_name='John', department=self.dept_a, position=pos)
        res = self.client.delete(reverse('position-detail', args=[pos.pk]))
        self.assertEqual(res.status_code, 400)
        self.assertTrue(Position.objects.filter(pk=pos.pk).exists())

    def test_employee_position_mismatched_department_rejected(self):
        pos = Position.objects.create(name='Engineer', department=self.dept_a)
        res = self.client.post(reverse('employee-list'), {
            'full_name': 'Jane', 'nik': '1234567890', 'department': self.dept_b.id, 'position': pos.id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)

    def test_employee_position_inactive_rejected(self):
        pos = Position.objects.create(name='Engineer', department=self.dept_a, is_active=False)
        res = self.client.post(reverse('employee-list'), {
            'full_name': 'Jane', 'nik': '1234567890', 'department': self.dept_a.id, 'position': pos.id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)