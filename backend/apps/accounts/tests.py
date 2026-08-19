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
