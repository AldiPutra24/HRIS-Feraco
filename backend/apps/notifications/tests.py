import json
from datetime import date, timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from apps.accounts.models import Role
from apps.leaves.models import LeaveRequest, LeaveType
from apps.personnel.models import Employee, EmployeeContract

from .models import (
    Notification,
    NotificationDeliveryLog,
    NotificationEventConfig,
    NotificationSetting,
)
from .services import hr_recipients, notify_leave_status, notify_leave_submitted, run_all

User = get_user_model()

SETTINGS_URL = '/api/notifications/notification-settings/'
EVENTS_URL = '/api/notifications/notification-events/'
NOTIF_URL = '/api/notifications/notifications/'
DELIVERY_URL = '/api/notifications/delivery-logs/'

HR_DEFAULT_EMAIL = 'hrgaferaco@gmail.com'


def make_user(key='EMPLOYEE', username='user@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


def make_employee(employee_id, full_name, user=None, manager=None, employment_status='ACTIVE',
                  personal_email='', company_email='', birth_date=None):
    emp = Employee.objects.create(
        employee_id=employee_id, full_name=full_name, employment_status=employment_status,
        manager=manager, personal_email=personal_email, company_email=company_email,
        birth_date=birth_date,
    )
    if user is not None:
        emp.user = user
        emp.save()
    return emp


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class LeaveNotificationTests(TestCase):
    def setUp(self):
        self.manager_user = make_user('MANAGEMENT', 'manager@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp@test.com')
        self.manager_emp = make_employee('M001', 'Manager', user=self.manager_user,
                                         company_email='manager@feraco.co.id')
        self.emp = make_employee('E001', 'John', user=self.emp_user, manager=self.manager_emp,
                                 personal_email='john@gmail.com')
        self.lt = LeaveType.objects.create(name='Annual Leave', code='ANNUAL', default_quota=12)
        self.leave = LeaveRequest.objects.create(
            employee=self.emp, leave_type=self.lt,
            start_date=date(2026, 10, 5), end_date=date(2026, 10, 7), total_days=3,
        )

    def test_submitted_notifies_manager_inapp_and_email(self):
        result = notify_leave_submitted(self.leave)
        self.assertEqual(result['inapp'], 1)
        self.assertEqual(result['sent'], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['manager@feraco.co.id'])
        self.assertIn('John', mail.outbox[0].body)
        self.assertTrue(
            Notification.objects.filter(recipient=self.manager_user, kind='LEAVE_SUBMITTED').exists()
        )

    def test_submitted_uses_custom_template(self):
        NotificationEventConfig.objects.create(
            event='LEAVE_SUBMITTED', enabled=True,
            subject='Custom subj {{employee_name}}',
            body='Halo {{manager_name}} - {{leave_start}}',
        )
        notify_leave_submitted(self.leave)
        self.assertEqual(mail.outbox[0].subject, 'Custom subj John')
        self.assertIn('Halo Manager', mail.outbox[0].body)

    def test_submitted_disabled_no_delivery(self):
        NotificationEventConfig.objects.create(event='LEAVE_SUBMITTED', enabled=False)
        result = notify_leave_submitted(self.leave)
        self.assertEqual(result['sent'], 0)
        self.assertEqual(result['inapp'], 0)
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(Notification.objects.exists())

    def test_submitted_idempotent_no_duplicate(self):
        notify_leave_submitted(self.leave)
        notify_leave_submitted(self.leave)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(Notification.objects.count(), 1)

    def test_approved_notifies_employee(self):
        notify_leave_status(self.leave, 'APPROVED')
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['john@gmail.com'])
        self.assertIn('DISETUJUI', mail.outbox[0].body)
        self.assertTrue(
            Notification.objects.filter(recipient=self.emp_user, kind='LEAVE_APPROVED').exists()
        )

    def test_rejected_includes_reason(self):
        self.leave.rejection_reason = 'Cuaca buruk'
        self.leave.save()
        notify_leave_status(self.leave, 'REJECTED')
        self.assertIn('Cuaca buruk', mail.outbox[0].body)
        self.assertTrue(
            Notification.objects.filter(recipient=self.emp_user, kind='LEAVE_REJECTED').exists()
        )

    def test_status_idempotent_no_duplicate(self):
        notify_leave_status(self.leave, 'APPROVED')
        result = notify_leave_status(self.leave, 'APPROVED')
        self.assertEqual(result['inapp'], 0)
        self.assertEqual(result['sent'], 0)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.emp_user).count(), 1)

    def test_other_status_ignored(self):
        result = notify_leave_status(self.leave, 'CANCELLED')
        self.assertEqual(result, {'inapp': 0, 'sent': 0, 'skipped': 0, 'failed': 0})
        self.assertEqual(len(mail.outbox), 0)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class ContractReminderTests(TestCase):
    def setUp(self):
        self.manager_user = make_user('MANAGEMENT', 'mgr@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp2@test.com')
        self.hr_user = make_user('HR_STAFF', 'hr2@test.com')
        self.manager_emp = make_employee('M002', 'Manager2', user=self.manager_user,
                                         company_email='mgr@feraco.co.id')
        self.emp = make_employee('E002', 'Jane', user=self.emp_user, manager=self.manager_emp,
                                 personal_email='jane@gmail.com')
        self.contract = EmployeeContract.objects.create(
            employee=self.emp, contract_type='PKWT', start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), status='ACTIVE',
        )
        self.h30 = date(2026, 12, 1)  # 30 hari sebelum end_date

    def test_h30_delivers_to_employee_manager_hr(self):
        result = run_all(today=self.h30)
        self.assertEqual(result['contract']['due'], 1)
        recipients = sorted(m.to[0] for m in mail.outbox)
        self.assertIn('jane@gmail.com', recipients)
        self.assertIn('mgr@feraco.co.id', recipients)
        self.assertIn(HR_DEFAULT_EMAIL, recipients)
        # In-app hanya untuk employee + manager (HR email-only).
        self.assertEqual(result['contract']['inapp'], 2)

    def test_offsets_follow_setting(self):
        setting = NotificationSetting.get_solo()
        setting.contract_offsets = '14,7'
        setting.save()
        self.assertEqual(run_all(today=self.h30)['contract']['due'], 0)
        self.assertEqual(run_all(today=date(2026, 12, 17))['contract']['due'], 1)  # H-14

    def test_no_duplicate_on_rerun(self):
        run_all(today=self.h30)
        first = len(mail.outbox)
        self.assertEqual(first, 3)
        result = run_all(today=self.h30)
        self.assertEqual(len(mail.outbox), first)
        self.assertEqual(result['contract']['sent'], 0)
        self.assertEqual(result['contract']['inapp'], 0)

    def test_already_ended_contract_not_relevant(self):
        self.assertEqual(run_all(today=date(2027, 1, 5))['contract']['due'], 0)

    def test_non_active_contract_excluded(self):
        self.contract.status = 'EXPIRED'
        self.contract.save()
        self.assertEqual(run_all(today=self.h30)['contract']['due'], 0)

    def test_dry_run_sends_nothing(self):
        result = run_all(today=self.h30, dry_run=True)
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(NotificationDeliveryLog.objects.exists())
        self.assertTrue(any('KONTRAK H-30' in d for d in result['contract']['details']))

    def test_hr_recipients_default_plus_additional(self):
        setting = NotificationSetting.get_solo()
        setting.additional_hr_users.add(self.hr_user)
        emails = hr_recipients()
        self.assertIn(HR_DEFAULT_EMAIL, emails)
        self.assertIn('hr2@test.com', emails)

    def test_custom_template_used(self):
        NotificationEventConfig.objects.create(
            event='CONTRACT',
            subject='Kontrak {{employee_name}} segera habis',
            body='Sisa {{days_remaining}} hari.',
        )
        run_all(today=self.h30)
        self.assertTrue(any(m.subject == 'Kontrak Jane segera habis' for m in mail.outbox))
        self.assertTrue(any(m.body == 'Sisa 30 hari.' for m in mail.outbox))

    def test_disabled_no_delivery(self):
        NotificationEventConfig.objects.create(event='CONTRACT', enabled=False)
        result = run_all(today=self.h30)
        self.assertEqual(result['contract']['due'], 0)
        self.assertEqual(len(mail.outbox), 0)


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class BirthdayNotificationTests(TestCase):
    def setUp(self):
        self.hr_user = make_user('HR_STAFF', 'hr3@test.com')
        self.emp_user = make_user('EMPLOYEE', 'emp3@test.com')
        self.emp = make_employee('E003', 'Budi', user=self.emp_user,
                                 personal_email='budi@gmail.com', birth_date=date(1990, 9, 18))
        self.h0 = date(2026, 9, 18)

    def test_h0_hr_info_and_employee_greeting(self):
        result = run_all(today=self.h0)
        self.assertEqual(result['birthday']['due'], 1)
        recipients = sorted(m.to[0] for m in mail.outbox)
        self.assertIn(HR_DEFAULT_EMAIL, recipients)
        self.assertIn('budi@gmail.com', recipients)
        greeting = [m for m in mail.outbox if m.to == ['budi@gmail.com']]
        self.assertTrue(any('Budi' in m.subject for m in greeting))
        self.assertEqual(result['birthday']['inapp'], 1)
        self.assertEqual(len(mail.outbox), 2)  # HR info + employee greeting

    def test_h1_tomorrow(self):
        result = run_all(today=self.h0 - timedelta(days=1))
        self.assertEqual(result['birthday']['due'], 1)

    def test_h1_toggle_off(self):
        setting = NotificationSetting.get_solo()
        setting.birthday_h1_enabled = False
        setting.save()
        result = run_all(today=self.h0 - timedelta(days=1))
        self.assertEqual(result['birthday']['due'], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_h0_toggle_off(self):
        setting = NotificationSetting.get_solo()
        setting.birthday_h0_enabled = False
        setting.save()
        result = run_all(today=self.h0)
        self.assertEqual(result['birthday']['due'], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_inactive_employee_skipped(self):
        self.emp.employment_status = 'INACTIVE'
        self.emp.save()
        result = run_all(today=self.h0)
        self.assertEqual(result['birthday']['due'], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_no_duplicate_same_day_next_year_ok(self):
        run_all(today=self.h0)
        self.assertEqual(len(mail.outbox), 2)  # HR info + employee greeting
        mail.outbox.clear()
        # Tahun berikutnya: key memuat tahun -> boleh terkirim lagi.
        result = run_all(today=date(2027, 9, 18))
        self.assertEqual(result['birthday']['due'], 1)
        self.assertEqual(len(mail.outbox), 2)


class NotificationApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.u1 = make_user('EMPLOYEE', 'u1@test.com')
        self.u2 = make_user('EMPLOYEE', 'u2@test.com')
        Notification.objects.create(recipient=self.u1, kind='BIRTHDAY', message='m1')
        Notification.objects.create(recipient=self.u1, kind='CONTRACT', message='m2')
        Notification.objects.create(recipient=self.u2, kind='CONTRACT', message='m3')

    def test_list_shows_own_only_with_unread_badge(self):
        self.client.force_login(self.u1)
        res = self.client.get(NOTIF_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['unread'], 2)
        self.assertEqual(len(res.data['results']), 2)

    def test_unauthenticated_403(self):
        res = self.client.get(NOTIF_URL)
        self.assertEqual(res.status_code, 403)

    def test_mark_read_updates_badge(self):
        self.client.force_login(self.u1)
        notif = Notification.objects.filter(recipient=self.u1).first()
        res = self.client.post(f'{NOTIF_URL}{notif.id}/mark_read/')
        self.assertEqual(res.status_code, 200)
        res = self.client.get(f'{NOTIF_URL}unread_count/')
        self.assertEqual(res.data['unread'], 1)

    def test_cannot_read_other_user_notification(self):
        other = Notification.objects.filter(recipient=self.u2).first()
        self.client.force_login(self.u1)
        res = self.client.get(f'{NOTIF_URL}{other.id}/')
        self.assertIn(res.status_code, (403, 404))
        res = self.client.post(f'{NOTIF_URL}{other.id}/mark_read/')
        self.assertIn(res.status_code, (403, 404))

    def test_mark_all_read(self):
        self.client.force_login(self.u1)
        res = self.client.post(f'{NOTIF_URL}mark_all_read/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Notification.objects.filter(recipient=self.u1, is_read=False).count(), 0)


class NotificationSettingsApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.hr = make_user('HR_STAFF', 'hrset@test.com')
        self.emp = make_user('EMPLOYEE', 'empset@test.com')
        self.hr_lead = make_user('HR_LEAD', 'lead@test.com')

    def login_hr(self):
        self.client.force_login(self.hr)

    def test_get_default_settings(self):
        self.login_hr()
        res = self.client.get(SETTINGS_URL)
        self.assertEqual(res.status_code, 200)
        self.assertIn(HR_DEFAULT_EMAIL, res.data['default_hr_emails'])
        self.assertTrue(res.data['birthday_h1_enabled'])
        self.assertTrue(res.data['birthday_h0_enabled'])

    def test_employee_forbidden(self):
        self.client.force_login(self.emp)
        res = self.client.get(SETTINGS_URL)
        self.assertEqual(res.status_code, 403)

    def test_patch_toggles_and_offsets(self):
        self.login_hr()
        res = self.client.patch(
            f'{SETTINGS_URL}1/',
            data=json.dumps({'birthday_h1_enabled': False, 'contract_offsets': '60,30,7'}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        s = NotificationSetting.get_solo()
        self.assertFalse(s.birthday_h1_enabled)
        self.assertEqual(s.contract_offset_list(), [60, 30, 7])

    def test_patch_invalid_offsets_400(self):
        self.login_hr()
        res = self.client.patch(
            f'{SETTINGS_URL}1/',
            data=json.dumps({'contract_offsets': 'abc,30'}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)

    def test_additional_hr_users_and_default_kept(self):
        self.login_hr()
        res = self.client.patch(
            f'{SETTINGS_URL}1/',
            data=json.dumps({'additional_hr_users': [self.hr_lead.id]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        s = NotificationSetting.get_solo()
        self.assertIn(self.hr_lead, s.additional_hr_users.all())
        self.assertIn(HR_DEFAULT_EMAIL, s.hr_email_list())
        self.assertIn('lead@test.com', s.hr_email_list())

    def test_additional_hr_rejects_non_hr_role(self):
        self.login_hr()
        res = self.client.patch(
            f'{SETTINGS_URL}1/',
            data=json.dumps({'additional_hr_users': [self.emp.id]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)

    def test_hr_candidates_endpoint(self):
        self.login_hr()
        res = self.client.get(f'{SETTINGS_URL}hr_candidates/')
        self.assertEqual(res.status_code, 200)
        ids = [u['id'] for u in res.data]
        self.assertIn(self.hr_lead.id, ids)
        self.assertNotIn(self.emp.id, ids)

    def test_event_config_list_complete_and_patch(self):
        self.login_hr()
        res = self.client.get(EVENTS_URL)
        self.assertEqual(res.status_code, 200)
        events = {row['event'] for row in res.data}
        self.assertEqual(len(events), 6)
        self.assertIn('BIRTHDAY_HR', events)
        self.assertIn('BIRTHDAY_EMPLOYEE', events)
        row = next(r for r in res.data if r['event'] == 'LEAVE_REJECTED')
        self.assertIn('{{rejection_reason}}', row['available_placeholders'])
        res = self.client.patch(
            f"{EVENTS_URL}{row['id']}/",
            data=json.dumps({'subject': 'Subj khusus', 'enabled': False}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        cfg = NotificationEventConfig.objects.get(event='LEAVE_REJECTED')
        self.assertEqual(cfg.subject, 'Subj khusus')
        self.assertFalse(cfg.enabled)


class DeliveryLogApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.hr = make_user('HR_STAFF', 'hrlog@test.com')
        self.emp = make_user('EMPLOYEE', 'emplog@test.com')

    def login_hr(self):
        self.client.force_login(self.hr)

    def test_hr_sees_logs_employee_forbidden(self):
        NotificationDeliveryLog.objects.create(
            key='leave-status:9:APPROVED:email:john@gmail.com', channel='EMAIL',
            event='LEAVE_APPROVED', recipient_email='john@gmail.com',
            subject='Subj', status='SENT',
        )
        NotificationDeliveryLog.objects.create(
            key='leave-status:9:APPROVED:inapp:9', channel='IN_APP',
            event='LEAVE_APPROVED', recipient=self.emp,
            subject='Subj', status='SENT',
        )
        self.login_hr()
        res = self.client.get(DELIVERY_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['count'], 2)
        row = res.data['results'][0]
        self.assertIn('recipient_username', row)
        self.assertIn('detail', row)
        self.client.force_login(self.emp)
        res = self.client.get(DELIVERY_URL)
        self.assertEqual(res.status_code, 403)

    def test_filter_by_status_and_channel(self):
        NotificationDeliveryLog.objects.create(
            key='k1', channel='EMAIL', event='CONTRACT',
            recipient_email='a@x.com', status='SENT',
        )
        NotificationDeliveryLog.objects.create(
            key='k2', channel='EMAIL', event='CONTRACT',
            recipient_email='b@x.com', status='FAILED', detail='SMTP down',
        )
        NotificationDeliveryLog.objects.create(
            key='k3', channel='IN_APP', event='BIRTHDAY', recipient=self.emp,
            status='SENT',
        )
        self.login_hr()
        res = self.client.get(DELIVERY_URL, {'status': 'FAILED'})
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['recipient_email'], 'b@x.com')
        self.assertIn('SMTP down', res.data['results'][0]['detail'])
        res = self.client.get(DELIVERY_URL, {'channel': 'IN_APP'})
        self.assertEqual(res.data['count'], 1)
        res = self.client.get(DELIVERY_URL, {'event': 'CONTRACT'})
        self.assertEqual(res.data['count'], 2)
        res = self.client.get(DELIVERY_URL, {'search': 'a@x.com'})
        self.assertEqual(res.data['count'], 1)
        res = self.client.get(DELIVERY_URL, {'date_from': '2100-01-01'})
        self.assertEqual(res.data['count'], 0)
        res = self.client.get(DELIVERY_URL, {'date_to': '2100-01-01'})
        self.assertEqual(res.data['count'], 3)

    def test_summary_counts(self):
        NotificationDeliveryLog.objects.create(
            key='s1', channel='EMAIL', event='CONTRACT',
            recipient_email='a@x.com', status='SENT',
        )
        NotificationDeliveryLog.log_failed(
            key='s2', event='CONTRACT', recipient_email='b@x.com', subject='S', detail='boom'
        )
        self.login_hr()
        res = self.client.get(f'{DELIVERY_URL}summary/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, {'total': 2, 'sent': 1, 'failed': 1, 'skipped': 0})


class CommandTests(TestCase):
    def test_dry_run_and_idempotent(self):
        make_employee('E005', 'Dedi', personal_email='dedi@gmail.com', birth_date=date(1990, 9, 18))
        with mock.patch('apps.notifications.services.timezone.localdate',
                        return_value=date(2026, 9, 18)):
            out = StringIO()
            call_command('send_employee_notifications', '--dry-run', stdout=out)
            self.assertIn('Dry-run', out.getvalue())
            self.assertIn('BIRTHDAY H-0', out.getvalue())
            self.assertEqual(len(mail.outbox), 0)
            call_command('send_employee_notifications', stdout=StringIO())
        self.assertEqual(len(mail.outbox), 2)  # HR info + employee greeting
        # Run kedua: idempotent, tidak ada email baru.
        with mock.patch('apps.notifications.services.timezone.localdate',
                        return_value=date(2026, 9, 18)):
            call_command('send_employee_notifications', stdout=StringIO())
        self.assertEqual(len(mail.outbox), 2)
