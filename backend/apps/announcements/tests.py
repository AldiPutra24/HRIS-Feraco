from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role

from .models import Announcement, STATUS_ACTIVE, STATUS_INACTIVE

User = get_user_model()


def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class AnnouncementModelTests(TestCase):
    def test_default_active_no_expiry_visible(self):
        a = Announcement.objects.create(title='t', body='b')
        self.assertEqual(a.status, STATUS_ACTIVE)
        self.assertTrue(a.is_visible)

    def test_inactive_hidden(self):
        a = Announcement.objects.create(title='t', body='b', status=STATUS_INACTIVE)
        self.assertFalse(a.is_visible)

    def test_expired_end_date_hidden(self):
        past = timezone.localdate() - timedelta(days=1)
        a = Announcement.objects.create(title='t', body='b', use_end_date=True, end_date=past)
        self.assertFalse(a.is_visible)

    def test_future_end_date_visible(self):
        future = timezone.localdate() + timedelta(days=1)
        a = Announcement.objects.create(title='t', body='b', use_end_date=True, end_date=future)
        self.assertTrue(a.is_visible)


class AnnouncementApiTests(TestCase):
    def setUp(self):
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.list_url = reverse('announcement-list')

    def test_employee_sees_only_visible(self):
        Announcement.objects.create(title='active', body='b')
        Announcement.objects.create(
            title='expired', body='b', use_end_date=True,
            end_date=timezone.localdate() - timedelta(days=1),
        )
        Announcement.objects.create(title='inactive', body='b', status=STATUS_INACTIVE)
        self.client.force_login(self.emp_user)
        res = self.client.get(self.list_url)
        titles = [a['title'] for a in res.json()['results']]
        self.assertEqual(titles, ['active'])

    def test_hr_sees_all(self):
        Announcement.objects.create(title='active', body='b')
        Announcement.objects.create(title='inactive', body='b', status=STATUS_INACTIVE)
        self.client.force_login(self.hr)
        res = self.client.get(self.list_url)
        titles = [a['title'] for a in res.json()['results']]
        self.assertIn('inactive', titles)

    def test_create_requires_end_date_when_use_end_date(self):
        self.client.force_login(self.hr)
        res = self.client.post(self.list_url, {'title': 't', 'body': 'b', 'use_end_date': True}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_create_clears_end_date_when_not_used(self):
        self.client.force_login(self.hr)
        res = self.client.post(
            self.list_url,
            {'title': 't', 'body': 'b', 'use_end_date': False, 'end_date': '2030-01-01'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(Announcement.objects.get(title='t').end_date)

    def test_expired_end_date_auto_inactive_on_save(self):
        self.client.force_login(self.hr)
        res = self.client.post(
            self.list_url,
            {'title': 't', 'body': 'b', 'use_end_date': True, 'end_date': '2000-01-01'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Announcement.objects.get(title='t').status, STATUS_INACTIVE)
