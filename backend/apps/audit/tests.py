from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import AuditLog
from .services import log_event, _sanitize, diff_changes


class AuditTests(TestCase):
    def test_audit_log_str(self):
        entry = AuditLog.objects.create(action='login', description='test')
        self.assertIn('login', str(entry))

    def test_sanitize_redacts_sensitive(self):
        data = {'password': 'secret123', 'npwp': '123456', 'name': 'Alice'}
        out = _sanitize(data)
        self.assertEqual(out['password'], '[REDACTED]')
        self.assertEqual(out['npwp'], '[REDACTED]')
        self.assertEqual(out['name'], 'Alice')

    def test_sanitize_recursive(self):
        out = _sanitize({'meta': {'token': 'x', 'ok': 1}})
        self.assertEqual(out['meta']['token'], '[REDACTED]')
        self.assertEqual(out['meta']['ok'], 1)

    def test_diff_changes_only_changed(self):
        before, after = diff_changes({'a': 1, 'b': 'x'}, {'a': 1, 'b': 'y'})
        self.assertEqual(before, {'b': 'x'})
        self.assertEqual(after, {'b': 'y'})

    def test_log_event_stores_actor(self):
        User = get_user_model()
        user = User.objects.create_user(username='auditor', password='pw')
        entry = log_event(None, 'create', user=user, description='x')
        self.assertEqual(entry.user, user)



class AuditLogApiTests(TestCase):
    URL = '/api/audit/audit-logs/'

    def setUp(self):
        from datetime import datetime

        from django.utils import timezone

        from apps.accounts.models import Role

        User = get_user_model()
        role, _ = Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
        self.admin = User.objects.create_user(username='admin.audit', email='a@x.id', password='pw')
        self.admin.role = role
        self.admin.save()
        self.other = User.objects.create_user(username='budi', email='b@x.id', password='pw')

        def at(y, m, d, hh, mm=0):
            return timezone.make_aware(datetime(y, m, d, hh, mm))  # Asia/Jakarta

        def entry(action, user, ts):
            e = AuditLog.objects.create(action=action, user=user, description=action)
            AuditLog.objects.filter(pk=e.pk).update(created_at=ts)
            return e

        self.e1 = entry('create', self.admin, at(2026, 10, 1, 0, 30))   # awal hari 1 Okt
        self.e2 = entry('update', self.other, at(2026, 10, 1, 23, 50))  # akhir hari 1 Okt
        self.e3 = entry('payroll_calculate', self.admin, at(2026, 10, 2, 8))
        self.e4 = entry('delete', self.other, at(2026, 10, 3, 6))
        self.client.force_login(self.admin)

    def ids(self, **params):
        res = self.client.get(self.URL, params)
        self.assertEqual(res.status_code, 200, res.content)
        return {r['id'] for r in res.json()['results']}

    def test_action_filter_case_insensitive(self):
        self.assertEqual(self.ids(action='CREATE'), {self.e1.id})
        self.assertEqual(self.ids(action='update'), {self.e2.id})

    def test_action_filter_accepts_custom_action(self):
        self.assertEqual(self.ids(action='payroll_calculate'), {self.e3.id})

    def test_actor_filter(self):
        self.assertEqual(self.ids(actor='bud'), {self.e2.id, self.e4.id})

    def test_date_range_inclusive_local_day(self):
        self.assertEqual(self.ids(date_from='2026-10-01', date_to='2026-10-01'), {self.e1.id, self.e2.id})
        self.assertEqual(self.ids(date_from='2026-10-02'), {self.e3.id, self.e4.id})
        self.assertEqual(self.ids(date_to='2026-10-02'), {self.e1.id, self.e2.id, self.e3.id})

    def test_invalid_date_returns_400(self):
        self.assertEqual(self.client.get(self.URL, {'date_from': '01-10-2026'}).status_code, 400)

    def test_reversed_range_returns_400(self):
        res = self.client.get(self.URL, {'date_from': '2026-10-03', 'date_to': '2026-10-01'})
        self.assertEqual(res.status_code, 400)
        self.assertIn('date_to', res.json())

    def test_combined_filters(self):
        self.assertEqual(self.ids(action='delete', actor='budi', date_from='2026-10-03'), {self.e4.id})

    def test_actions_endpoint_includes_choices_and_custom(self):
        res = self.client.get(f'{self.URL}actions/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('create', res.json())
        self.assertIn('payroll_calculate', res.json())

    def test_soft_deleted_hidden(self):
        AuditLog.objects.filter(pk=self.e1.pk).update(deleted_at=self.e1.created_at)
        self.assertNotIn(self.e1.id, self.ids())
