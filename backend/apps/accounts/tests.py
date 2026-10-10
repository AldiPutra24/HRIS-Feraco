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


class GeneralManagerUserBindingTests(TestCase):
    """GM role binds only to the General Manager employee (General Management dept, ACTIVE)."""

    def setUp(self):
        from apps.personnel.models import Department, Employee, Position

        Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
        Role.objects.get_or_create(key='GENERAL_MANAGER', defaults={'name': 'General Manager'})
        Role.objects.get_or_create(key='EMPLOYEE', defaults={'name': 'Employee'})
        Role.objects.get_or_create(key='MANAGEMENT', defaults={'name': 'Management'})
        self.admin = User.objects.create_user(username='admin@test.com', email='admin@test.com', password='password')
        self.admin.role = Role.objects.get(key='ADMIN')
        self.admin.save()
        self.client.force_login(self.admin)

        self.gm_dept = Department.objects.create(name='General Management')
        self.other_dept = Department.objects.create(name='Ops')
        self.gm_pos = Position.objects.create(name='General Manager', department=self.gm_dept, role=Position.ROLE_MANAGEMENT)
        self.mgr_pos = Position.objects.create(name='Manager', department=self.other_dept, role=Position.ROLE_MANAGEMENT)
        self.emp_pos = Position.objects.create(name='Staff', department=self.other_dept, role=Position.ROLE_EMPLOYEE)

        self.gm_emp = Employee.objects.create(employee_id='G1', full_name='Pak Ferry', department=self.gm_dept, position=self.gm_pos, employment_status='ACTIVE')
        self.mgr_emp = Employee.objects.create(employee_id='G2', full_name='Mgr', department=self.other_dept, position=self.mgr_pos, employment_status='ACTIVE')
        self.emp_emp = Employee.objects.create(employee_id='G3', full_name='Staff', department=self.other_dept, position=self.emp_pos, employment_status='ACTIVE')
        self.gm_inactive = Employee.objects.create(employee_id='G4', full_name='Old GM', department=self.gm_dept, position=self.gm_pos, employment_status='INACTIVE')

    def _create(self, role_key, employee_id):
        return self.client.post(reverse('user-list'), {
            'username': f'{role_key.lower()}{employee_id}@test.com',
            'email': f'{role_key.lower()}{employee_id}@test.com',
            'password': 'password123',
            'role': Role.objects.get(key=role_key).id,
            'employee': employee_id,
        }, content_type='application/json')

    def test_gm_role_with_gm_employee_ok(self):
        res = self._create('GENERAL_MANAGER', self.gm_emp.id)
        self.assertEqual(res.status_code, 201, res.data)

    def test_gm_role_with_other_employee_rejected(self):
        for emp in (self.mgr_emp, self.emp_emp, self.gm_inactive):
            with self.subTest(employee=emp.full_name):
                res = self._create('GENERAL_MANAGER', emp.id)
                self.assertEqual(res.status_code, 400)
                self.assertIn('employee', res.data)

    def test_gm_role_without_employee_rejected(self):
        res = self.client.post(reverse('user-list'), {
            'username': 'gmnoemp@test.com',
            'email': 'gmnoemp@test.com',
            'password': 'password123',
            'role': Role.objects.get(key='GENERAL_MANAGER').id,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('employee', res.data)

    def test_existing_roles_unaffected(self):
        res = self._create('MANAGEMENT', self.mgr_emp.id)
        self.assertEqual(res.status_code, 201)
        res = self._create('EMPLOYEE', self.emp_emp.id)
        self.assertEqual(res.status_code, 201)


class PresenceTests(TestCase):
    """Online / last seen: login + heartbeat, threshold, permissions."""

    def setUp(self):
        from django.test import Client

        self.admin_role, _ = Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
        self.hr_role, _ = Role.objects.get_or_create(key='HR_STAFF', defaults={'name': 'HR Staff'})
        self.admin = User.objects.create_user(username='admin.p@feraco.id', email='admin.p@feraco.id', password='password')
        self.admin.role = self.admin_role
        self.admin.save()
        self.staff = User.objects.create_user(username='staff.p@feraco.id', email='staff.p@feraco.id', password='password')
        self.staff.role = self.hr_role
        self.staff.save()
        self.Client = Client

    def _users_by_id(self):
        self.client.force_login(self.admin)
        res = self.client.get(reverse('user-list'))
        self.assertEqual(res.status_code, 200)
        return {u['id']: u for u in res.json()}

    def test_login_sets_last_seen_at(self):
        self.assertIsNone(self.staff.last_seen_at)
        res = self.client.post(reverse('login'), {'email': 'staff.p@feraco.id', 'password': 'password'},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.staff.refresh_from_db()
        self.assertIsNotNone(self.staff.last_seen_at)

    def test_failed_login_does_not_touch_last_seen(self):
        self.client.post(reverse('login'), {'email': 'staff.p@feraco.id', 'password': 'wrong'},
                         content_type='application/json')
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.last_seen_at)

    def test_heartbeat_updates_own_last_seen(self):
        from datetime import timedelta

        from django.utils import timezone

        old = timezone.now() - timedelta(minutes=10)
        User.objects.filter(pk=self.staff.pk).update(last_seen_at=old)
        self.client.force_login(self.staff)
        res = self.client.post(reverse('heartbeat'))
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['is_online'])
        self.staff.refresh_from_db()
        self.assertGreater(self.staff.last_seen_at, old)
        # Other users untouched.
        self.admin.refresh_from_db()
        self.assertIsNone(self.admin.last_seen_at)

    def test_heartbeat_ignores_other_user_id(self):
        self.client.force_login(self.staff)
        self.client.post(reverse('heartbeat'), {'user': self.admin.pk, 'id': self.admin.pk},
                         content_type='application/json')
        self.admin.refresh_from_db()
        self.assertIsNone(self.admin.last_seen_at)

    def test_heartbeat_requires_login(self):
        res = self.client.post(reverse('heartbeat'))
        self.assertEqual(res.status_code, 403)

    def test_heartbeat_requires_csrf(self):
        client = self.Client(enforce_csrf_checks=True)
        client.force_login(self.staff)
        self.assertEqual(client.post(reverse('heartbeat')).status_code, 403)
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.last_seen_at)

    def test_heartbeat_get_not_allowed(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('heartbeat')).status_code, 405)

    def test_heartbeat_write_throttled(self):
        self.client.force_login(self.staff)
        self.client.post(reverse('heartbeat'))
        self.staff.refresh_from_db()
        first = self.staff.last_seen_at
        self.client.post(reverse('heartbeat'))  # < 15s later: no extra write
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.last_seen_at, first)

    def test_online_offline_threshold(self):
        from datetime import timedelta

        from django.utils import timezone

        now = timezone.now()
        User.objects.filter(pk=self.staff.pk).update(last_seen_at=now - timedelta(seconds=100))
        u = self._users_by_id()[self.staff.pk]
        self.assertTrue(u['is_online'])
        self.assertGreaterEqual(u['last_seen_seconds'], 100)

        User.objects.filter(pk=self.staff.pk).update(last_seen_at=now - timedelta(seconds=125))
        u = self._users_by_id()[self.staff.pk]
        self.assertFalse(u['is_online'])

        User.objects.filter(pk=self.staff.pk).update(last_seen_at=now - timedelta(minutes=18))
        u = self._users_by_id()[self.staff.pk]
        self.assertFalse(u['is_online'])
        self.assertGreaterEqual(u['last_seen_seconds'], 18 * 60)

    def test_never_logged_in(self):
        u = self._users_by_id()[self.staff.pk]
        self.assertIsNone(u['last_seen_at'])
        self.assertIsNone(u['last_seen_seconds'])
        self.assertFalse(u['is_online'])

    def test_presence_independent_of_is_active(self):
        from django.utils import timezone

        User.objects.filter(pk=self.staff.pk).update(is_active=True, last_seen_at=None)
        self.assertFalse(self._users_by_id()[self.staff.pk]['is_online'])
        User.objects.filter(pk=self.staff.pk).update(is_active=False, last_seen_at=timezone.now())
        self.assertTrue(self._users_by_id()[self.staff.pk]['is_online'])

    def test_last_seen_not_writable_via_user_admin(self):
        self.client.force_login(self.admin)
        res = self.client.patch(reverse('user-detail', args=[self.staff.pk]),
                                {'last_seen_at': '2020-01-01T00:00:00Z'}, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.staff.refresh_from_db()
        self.assertIsNone(self.staff.last_seen_at)

    def test_presence_list_denied_for_non_admin(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(reverse('user-list')).status_code, 403)
