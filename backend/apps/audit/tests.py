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

