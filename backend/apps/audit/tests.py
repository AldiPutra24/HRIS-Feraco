from django.test import TestCase

from .models import AuditLog


class AuditTests(TestCase):
    def test_audit_log_str(self):
        entry = AuditLog.objects.create(action='login', description='test')
        self.assertIn('login', str(entry))
