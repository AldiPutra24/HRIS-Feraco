from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import Role

User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        Role.objects.create(key='ADMIN', name='Admin')
        self.user = User.objects.create_user(
            username='admin@feraco.id',
            email='admin@feraco.id',
            password='password',
        )
        self.user.role = Role.objects.get(key='ADMIN')
        self.user.save()

    def test_login_sets_session(self):
        res = self.client.post(
            reverse('login'),
            {'email': 'admin@feraco.id', 'password': 'password'},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['email'], 'admin@feraco.id')
        self.assertIn('_auth_user_id', self.client.session)

    def test_login_invalid(self):
        res = self.client.post(
            reverse('login'),
            {'email': 'admin@feraco.id', 'password': 'wrong'},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)

    def test_me_requires_auth(self):
        res = self.client.get(reverse('me'))
        self.assertEqual(res.status_code, 403)

    def test_me_returns_current_user(self):
        self.client.login(username='admin@feraco.id', password='password')
        res = self.client.get(reverse('me'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['role'], 'ADMIN')

class UserAdminApiTests(TestCase):
    def setUp(self):
        Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
        Role.objects.get_or_create(key='HR_STAFF', defaults={'name': 'HR Staff'})
        self.admin = User.objects.create_user(username='admin2@feraco.id', email='admin2@feraco.id', password='password')
        self.admin.role = Role.objects.get(key='ADMIN')
        self.admin.save()
        self.client.force_login(self.admin)

    def test_list_users(self):
        res = self.client.get(reverse('user-list'))
        self.assertEqual(res.status_code, 200)

    def test_create_user(self):
        res = self.client.post(reverse('user-list'), {
            'username': 'staff@feraco.id', 'email': 'staff@feraco.id', 'password': 'pass12345',
            'role': Role.objects.get(key='HR_STAFF').id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['role_key'], 'HR_STAFF')

    def test_update_user(self):
        u = User.objects.create_user(username='tmp@feraco.id', email='tmp@feraco.id', password='password')
        res = self.client.patch(reverse('user-detail', args=[u.pk]), {'first_name': 'Tmp'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.first_name, 'Tmp')

    def test_delete_self_rejected(self):
        res = self.client.delete(reverse('user-detail', args=[self.admin.pk]))
        self.assertEqual(res.status_code, 400)

    def test_non_admin_denied(self):
        hr = User.objects.create_user(username='hr@feraco.id', email='hr@feraco.id', password='password')
        hr.role = Role.objects.get(key='HR_STAFF')
        hr.save()
        self.client.force_login(hr)
        res = self.client.get(reverse('user-list'))
        self.assertEqual(res.status_code, 403)

class UserEmployeeRoleValidationTests(TestCase):
    """Backend must reject role/employee combinations that don't match Position.role."""

    def setUp(self):
        from apps.personnel.models import Department, Employee, Position

        Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
        Role.objects.get_or_create(key='EMPLOYEE', defaults={'name': 'Employee'})
        Role.objects.get_or_create(key='MANAGEMENT', defaults={'name': 'Management'})
        self.admin = User.objects.create_user(username='admin@test.com', email='admin@test.com', password='password')
        self.admin.role = Role.objects.get(key='ADMIN')
        self.admin.save()
        self.client.force_login(self.admin)

        self.dept = Department.objects.create(name='Ops')
        self.emp_pos = Position.objects.create(name='Staff', department=self.dept, role=Position.ROLE_EMPLOYEE)
        self.mgr_pos = Position.objects.create(name='Manager', department=self.dept, role=Position.ROLE_MANAGEMENT)
        self.emp = Employee.objects.create(employee_id='E1', full_name='Emp One', position=self.emp_pos)
        self.mgr = Employee.objects.create(employee_id='E2', full_name='Mgr One', position=self.mgr_pos)
        self.no_pos = Employee.objects.create(employee_id='E3', full_name='No Pos')

    def _create(self, role_key, employee_id):
        return self.client.post(reverse('user-list'), {
            'username': f'{role_key.lower()}x@test.com',
            'email': f'{role_key.lower()}x@test.com',
            'password': 'password123',
            'role': Role.objects.get(key=role_key).id,
            'employee': employee_id,
        }, content_type='application/json')

    def test_employee_role_with_employee_position_ok(self):
        res = self._create('EMPLOYEE', self.emp.id)
        self.assertEqual(res.status_code, 201)

    def test_management_role_with_management_position_ok(self):
        res = self._create('MANAGEMENT', self.mgr.id)
        self.assertEqual(res.status_code, 201)

    def test_employee_role_with_management_position_rejected(self):
        res = self._create('EMPLOYEE', self.mgr.id)
        self.assertEqual(res.status_code, 400)
        self.assertIn('employee', res.data)

    def test_management_role_with_employee_position_rejected(self):
        res = self._create('MANAGEMENT', self.emp.id)
        self.assertEqual(res.status_code, 400)
        self.assertIn('employee', res.data)

    def test_employee_without_position_rejected(self):
        res = self._create('EMPLOYEE', self.no_pos.id)
        self.assertEqual(res.status_code, 400)
        self.assertIn('employee', res.data)
