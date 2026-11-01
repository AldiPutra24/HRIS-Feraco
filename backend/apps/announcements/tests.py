from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role

from .models import Announcement, AnnouncementRead, CATEGORY_POLICY, STATUS_ACTIVE, STATUS_INACTIVE

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
        # Explicit default end_date removed -> still requires a real end_date.
        res = self.client.post(
            self.list_url,
            {'title': 't', 'body': 'b', 'use_end_date': True, 'end_date': ''},
            format='json',
        )
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


class AnnouncementDefaultsAndExpiryTests(TestCase):
    """Defaults on create + auto-inactive past end_date."""

    def setUp(self):
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.client.force_login(self.hr)
        self.list_url = reverse('announcement-list')

    def test_create_default_use_end_date_plus_7(self):
        res = self.client.post(self.list_url, {'title': 't', 'body': 'b'}, format='json')
        self.assertEqual(res.status_code, 201)
        a = Announcement.objects.get(title='t')
        self.assertTrue(a.use_end_date)
        self.assertEqual(a.end_date, timezone.localdate() + timedelta(days=7))

    def test_create_switch_off_no_end_date(self):
        res = self.client.post(
            self.list_url, {'title': 't', 'body': 'b', 'use_end_date': False}, format='json',
        )
        self.assertEqual(res.status_code, 201)
        a = Announcement.objects.get(title='t')
        self.assertFalse(a.use_end_date)
        self.assertIsNone(a.end_date)

    def test_expired_auto_inactive_on_list(self):
        past = timezone.localdate() - timedelta(days=1)
        a = Announcement.objects.create(title='old', body='b', use_end_date=True, end_date=past)
        self.client.get(self.list_url)  # any read path triggers sync
        a.refresh_from_db()
        self.assertEqual(a.status, STATUS_INACTIVE)

    def test_no_end_date_not_touched(self):
        a = Announcement.objects.create(title='t', body='b', use_end_date=False)
        self.client.get(self.list_url)
        a.refresh_from_db()
        self.assertEqual(a.status, STATUS_ACTIVE)


class AnnouncementReadTests(TestCase):
    def setUp(self):
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.other = make_user('EMPLOYEE', 'other@test.com')
        self.list_url = reverse('announcement-list')

    def _list(self, user):
        self.client.force_login(user)
        return self.client.get(self.list_url).json()['results']

    def test_pinned_first_with_category_and_unread(self):
        Announcement.objects.create(title='old pinned', body='b', is_pinned=True, category=CATEGORY_POLICY)
        Announcement.objects.create(title='new', body='b')
        rows = self._list(self.emp_user)
        self.assertEqual([r['title'] for r in rows], ['old pinned', 'new'])
        self.assertEqual(rows[0]['category'], CATEGORY_POLICY)
        self.assertTrue(rows[0]['is_pinned'])
        self.assertEqual([r['is_read'] for r in rows], [False, False])

    def test_read_is_per_user(self):
        a = Announcement.objects.create(title='t', body='b')
        self.client.force_login(self.emp_user)
        res = self.client.post(reverse('announcement-read', args=[a.pk]))
        self.assertEqual(res.status_code, 204)
        # Idempotent.
        self.assertEqual(self.client.post(reverse('announcement-read', args=[a.pk])).status_code, 204)
        self.assertEqual(AnnouncementRead.objects.count(), 1)
        self.assertTrue(self._list(self.emp_user)[0]['is_read'])
        self.assertFalse(self._list(self.other)[0]['is_read'])

    def test_employee_cannot_read_hidden(self):
        a = Announcement.objects.create(title='t', body='b', status=STATUS_INACTIVE)
        self.client.force_login(self.emp_user)
        self.assertEqual(self.client.post(reverse('announcement-read', args=[a.pk])).status_code, 404)

    def test_mark_all_read_only_visible(self):
        Announcement.objects.create(title='a', body='b')
        Announcement.objects.create(title='b', body='b')
        Announcement.objects.create(title='hidden', body='b', status=STATUS_INACTIVE)
        self.client.force_login(self.emp_user)
        res = self.client.post(reverse('announcement-mark-all-read'))
        self.assertEqual(res.json(), {'marked': 2})
        self.assertEqual(self.client.post(reverse('announcement-mark-all-read')).json(), {'marked': 0})
        self.assertTrue(all(r['is_read'] for r in self._list(self.emp_user)))

    def test_employee_cannot_pin(self):
        a = Announcement.objects.create(title='t', body='b')
        self.client.force_login(self.emp_user)
        res = self.client.patch(reverse('announcement-detail', args=[a.pk]), {'is_pinned': True}, content_type='application/json')
        self.assertEqual(res.status_code, 403)

    def test_hr_sets_category_and_pin(self):
        self.client.force_login(self.hr)
        res = self.client.post(
            self.list_url,
            {'title': 't', 'body': 'b', 'category': 'EVENT', 'is_pinned': True},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual((res.json()['category'], res.json()['is_pinned'], res.json()['is_read']), ('EVENT', True, False))
