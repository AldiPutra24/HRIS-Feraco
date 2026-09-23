from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Freelancer

from .models import (
    Event,
    EventAssignment,
    FreelanceTask,
    FreelanceTaskUpdate,
    FreelancerDocument,
    FreelancerPerformance,
    FreelancerSkill,
    Skill,
    SkillCategory,
    TaskEscalationPolicy,
    TaskReminderLog,
)

User = get_user_model()


def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


def make_freelancer(**kwargs):
    defaults = {'full_name': 'Budi Santoso', 'whatsapp': '0812', 'domicile': 'Jakarta'}
    defaults.update(kwargs)
    return Freelancer.objects.create(**defaults)


class FreelancerTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.emp = make_user('EMPLOYEE', 'emp@test.com')
        self.client.force_login(self.admin)

    def test_create_freelancer(self):
        resp = self.client.post('/api/freelance/freelancers/', {
            'full_name': 'Siti Aminah', 'whatsapp': '08123', 'domicile': 'Bandung',
            'personal_email': 'siti@x.com', 'rate': '500000', 'rate_type': 'PER_DAY',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['full_name'], 'Siti Aminah')
        self.assertTrue(AuditLog.objects.filter(action='create', object_id=str(data['id'])).exists())

    def test_employee_can_read(self):
        self.client.force_login(self.emp)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 200)

    def test_quick_add_minimal(self):
        resp = self.client.post('/api/freelance/freelancers/', {
            'full_name': 'Minimal', 'status': 'ACTIVE',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)

    def test_blacklist_filter(self):
        make_freelancer(full_name='Black', is_blacklisted=True)
        make_freelancer(full_name='Clean', is_blacklisted=False)
        resp = self.client.get('/api/freelance/freelancers/?is_blacklisted=true')
        self.assertEqual(resp.status_code, 200)
        names = [f['full_name'] for f in resp.json()['results']]
        self.assertIn('Black', names)
        self.assertNotIn('Clean', names)

    def test_search_by_name(self):
        make_freelancer(full_name='Budi Santoso', domicile='Jakarta')
        make_freelancer(full_name='Siti Aminah', domicile='Bandung')
        resp = self.client.get('/api/freelance/freelancers/?search=Budi')
        self.assertEqual(resp.status_code, 200)
        names = [f['full_name'] for f in resp.json()['results']]
        self.assertEqual(names, ['Budi Santoso'])

    def test_search_by_email(self):
        make_freelancer(full_name='Budi', personal_email='budi@x.com')
        make_freelancer(full_name='Siti', personal_email='siti@x.com')
        resp = self.client.get('/api/freelance/freelancers/?search=budi@x.com')
        self.assertEqual(resp.status_code, 200)
        names = [f['full_name'] for f in resp.json()['results']]
        self.assertEqual(names, ['Budi'])

    def test_search_empty_query(self):
        make_freelancer(full_name='Budi')
        resp = self.client.get('/api/freelance/freelancers/?search=')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 1)

    def test_event_filter(self):
        from .models import Event
        ev1 = Event.objects.create(name='Wedding Expo')
        ev2 = Event.objects.create(name='Corporate Gala')
        f1 = make_freelancer(full_name='Dengan Event')
        make_freelancer(full_name='Tanpa Event')
        EventAssignment.objects.create(freelancer=f1, event=ev1)
        # Semua (tanpa filter)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(len(resp.json()['results']), 2)
        # filter event ev1
        resp = self.client.get(f'/api/freelance/freelancers/?event={ev1.id}')
        names = [f['full_name'] for f in resp.json()['results']]
        self.assertEqual(names, ['Dengan Event'])
        # filter event ev2 (tidak ada assignment)
        resp = self.client.get(f'/api/freelance/freelancers/?event={ev2.id}')
        self.assertEqual(len(resp.json()['results']), 0)
        # kombinasi event + search
        resp = self.client.get(f'/api/freelance/freelancers/?event={ev1.id}&search=Dengan')
        self.assertEqual(len(resp.json()['results']), 1)
        resp = self.client.get(f'/api/freelance/freelancers/?event={ev1.id}&search=Tanpa')
        self.assertEqual(len(resp.json()['results']), 0)
        # list serializer exposes events
        data = resp.json()['results']
        row = [f for f in self.client.get('/api/freelance/freelancers/').json()['results'] if f['full_name'] == 'Dengan Event'][0]
        self.assertEqual(row['events'], [{'id': ev1.id, 'name': 'Wedding Expo'}])


class SkillTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)

    def test_crud_skill_and_category(self):
        cat = self.client.post('/api/freelance/skill-categories/', {'name': 'Talent'}, content_type='application/json')
        self.assertEqual(cat.status_code, 201)
        cat_id = cat.json()['id']
        skill = self.client.post('/api/freelance/skills/', {'name': 'MC', 'category': cat_id}, content_type='application/json')
        self.assertEqual(skill.status_code, 201)
        self.assertEqual(skill.json()['category_name'], 'Talent')

    def test_assign_skill_to_freelancer(self):
        f = make_freelancer()
        skill = Skill.objects.create(name='Usher')
        resp = self.client.post(f'/api/freelance/freelancers/{f.id}/skills/', {'skill': skill.id}, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(FreelancerSkill.objects.filter(freelancer=f, skill=skill).exists())
        # duplicate rejected
        dup = self.client.post(f'/api/freelance/freelancers/{f.id}/skills/', {'skill': skill.id}, content_type='application/json')
        self.assertEqual(dup.status_code, 400)
        # remove skill relation (master Skill untouched)
        rem = self.client.delete(f'/api/freelance/freelancers/{f.id}/skills/?skill={skill.id}')
        self.assertEqual(rem.status_code, 204)
        self.assertFalse(FreelancerSkill.objects.filter(freelancer=f, skill=skill).exists())
        self.assertTrue(Skill.objects.filter(id=skill.id).exists())
        # remove again -> 404
        rem2 = self.client.delete(f'/api/freelance/freelancers/{f.id}/skills/?skill={skill.id}')
        self.assertEqual(rem2.status_code, 404)
        # filter by skill
        flt = self.client.get('/api/freelance/freelancers/?skill=Usher')
        self.assertEqual(flt.status_code, 200)
        self.assertEqual(len(flt.json()['results']), 0)


class EventAssignmentPerformanceTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.f = make_freelancer(full_name='Agus')
        self.event = Event.objects.create(name='Product Launch', event_date=date(2026, 1, 1))

    def test_assignment_and_performance(self):
        a = self.client.post('/api/freelance/assignments/', {
            'freelancer': self.f.id, 'event': self.event.id, 'role': 'MC', 'pic': 'Rina',
        }, content_type='application/json')
        self.assertEqual(a.status_code, 201)
        aid = a.json()['id']
        perf = self.client.post(f'/api/freelance/assignments/{aid}/performance/', {
            'rating': 5, 'recommendation': 'RECOMMENDED', 'notes': 'Great', 'evaluator': 'Rina',
        }, content_type='application/json')
        self.assertEqual(perf.status_code, 201)
        self.assertEqual(perf.json()['recommendation'], 'RECOMMENDED')
        # detail shows assignment + performance
        detail = self.client.get(f'/api/freelance/freelancers/{self.f.id}/')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(len(detail.json()['assignments']), 1)
        self.assertEqual(detail.json()['assignments'][0]['performance']['rating'], 5)
        # list recommendation filter
        flt = self.client.get('/api/freelance/freelancers/?recommendation=RECOMMENDED')
        self.assertEqual(flt.status_code, 200)
        self.assertEqual(len(flt.json()['results']), 1)

    def test_rating_validation(self):
        a = self.client.post('/api/freelance/assignments/', {
            'freelancer': self.f.id, 'event': self.event.id,
        }, content_type='application/json')
        aid = a.json()['id']
        perf = self.client.post(f'/api/freelance/assignments/{aid}/performance/', {
            'rating': 9,
        }, content_type='application/json')
        self.assertEqual(perf.status_code, 400)


class DocumentTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.f = make_freelancer()

    def test_document_url_only(self):
        resp = self.client.post(f'/api/freelance/freelancers/{self.f.id}/documents/', {
            'doc_type': 'PORTFOLIO', 'name': 'Behance', 'url': 'https://behance.net/x',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['url'], 'https://behance.net/x')
        self.assertTrue(FreelancerDocument.objects.filter(freelancer=self.f).exists())

    def test_document_delete(self):
        doc = self.client.post(f'/api/freelance/freelancers/{self.f.id}/documents/', {
            'doc_type': 'PORTFOLIO', 'name': 'Behance', 'url': 'https://behance.net/x',
        }, content_type='application/json')
        doc_id = doc.json()['id']
        resp = self.client.delete(f'/api/freelance/freelancers/{self.f.id}/documents/{doc_id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(FreelancerDocument.objects.filter(id=doc_id).exists())

    def test_document_download_returns_url_json(self):
        doc = self.client.post(f'/api/freelance/freelancers/{self.f.id}/documents/', {
            'doc_type': 'PORTFOLIO', 'name': 'Behance', 'url': 'https://behance.net/x',
        }, content_type='application/json')
        doc_id = doc.json()['id']
        resp = self.client.get(f'/api/freelance/freelancers/{self.f.id}/documents/{doc_id}/download/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['url'], 'https://behance.net/x')
        self.assertEqual(data['name'], 'Behance')
        # not the API endpoint itself
        self.assertNotIn('/download/', data['url'])

class EditBlacklistTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)

    def test_edit_freelancer(self):
        f = make_freelancer(full_name='Old Name', domicile='Jakarta')
        resp = self.client.put(f'/api/freelance/freelancers/{f.id}/', {
            'full_name': 'New Name', 'domicile': 'Bandung', 'status': 'INACTIVE',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        f.refresh_from_db()
        self.assertEqual(f.full_name, 'New Name')
        self.assertEqual(f.domicile, 'Bandung')
        self.assertEqual(f.status, 'INACTIVE')

    def test_blacklist_requires_reason(self):
        f = make_freelancer()
        resp = self.client.put(f'/api/freelance/freelancers/{f.id}/', {
            'full_name': f.full_name, 'is_blacklisted': True, 'blacklist_reason': '',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        f.refresh_from_db()
        self.assertFalse(f.is_blacklisted)

    def test_blacklist_with_reason(self):
        f = make_freelancer()
        resp = self.client.put(f'/api/freelance/freelancers/{f.id}/', {
            'full_name': f.full_name, 'is_blacklisted': True, 'blacklist_reason': 'No show',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        f.refresh_from_db()
        self.assertTrue(f.is_blacklisted)
        self.assertEqual(f.blacklist_reason, 'No show')

class EventHistoryEditDeleteTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.f = make_freelancer(full_name='Agus')
        self.event = Event.objects.create(name='Launch', event_date=date(2026, 1, 1))

    def test_edit_and_delete_assignment(self):
        a = self.client.post('/api/freelance/assignments/', {
            'freelancer': self.f.id, 'event': self.event.id, 'role': 'MC',
        }, content_type='application/json')
        aid = a.json()['id']
        upd = self.client.put(f'/api/freelance/assignments/{aid}/', {
            'freelancer': self.f.id, 'event': self.event.id, 'role': 'Host',
        }, content_type='application/json')
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(upd.json()['role'], 'Host')
        # performance update
        perf = self.client.post(f'/api/freelance/assignments/{aid}/performance/', {
            'rating': 4, 'recommendation': 'RECOMMENDED_NOTES', 'notes': 'Good',
        }, content_type='application/json')
        self.assertEqual(perf.status_code, 201)
        # delete
        d = self.client.delete(f'/api/freelance/assignments/{aid}/')
        self.assertEqual(d.status_code, 204)
        self.assertFalse(EventAssignment.objects.filter(id=aid).exists())

    def test_no_duplicate_assignment(self):
        self.client.post('/api/freelance/assignments/', {
            'freelancer': self.f.id, 'event': self.event.id,
        }, content_type='application/json')
        dup = self.client.post('/api/freelance/assignments/', {
            'freelancer': self.f.id, 'event': self.event.id,
        }, content_type='application/json')
        self.assertEqual(dup.status_code, 400)

class AuthorizationTests(TestCase):
    def test_unauthenticated_blocked(self):
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 403)

class TaskTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.freelancer = make_freelancer()
        self.event = Event.objects.create(name='Event A', created_by=self.admin)

    def _payload(self, **kw):
        data = {
            'event': self.event.id,
            'freelancer': self.freelancer.id,
            'title': 'Setup booth',
            'description': 'Siapkan booth utama',
            'deadline': '2025-12-01',
            'status': 'BELUM_MULAI',
            'pic': '',
        }
        data.update(kw)
        return data

    def test_create_task(self):
        resp = self.client.post('/api/freelance/tasks/', self._payload(), content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['title'], 'Setup booth')
        self.assertEqual(data['status'], 'BELUM_MULAI')
        self.assertTrue(AuditLog.objects.filter(action='create', object_id=str(data['id'])).exists())

    def test_create_task_requires_title(self):
        resp = self.client.post('/api/freelance/tasks/', self._payload(title='  '), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_create_task_invalid_status(self):
        resp = self.client.post('/api/freelance/tasks/', self._payload(status='SALAH'), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_update_status_creates_history(self):
        task = FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='T1')
        resp = self.client.patch(f'/api/freelance/tasks/{task.id}/', {'status': 'SEDANG_DIKERJAKAN'}, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(task.updates.count(), 1)
        self.assertEqual(task.updates.first().status, 'SEDANG_DIKERJAKAN')

    def test_add_update_with_note(self):
        task = FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='T1')
        resp = self.client.post(f'/api/freelance/tasks/{task.id}/updates/', {'status': 'TERKENDALA', 'note': 'Menunggu alat'}, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        task.refresh_from_db()
        self.assertEqual(task.status, 'TERKENDALA')
        self.assertEqual(task.updates.count(), 1)

    def test_filters(self):
        FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='Alpha', status='SELESAI')
        FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='Beta', status='BELUM_MULAI')
        resp = self.client.get('/api/freelance/tasks/?status=SELESAI')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 1)
        resp = self.client.get('/api/freelance/tasks/?search=Alpha')
        self.assertEqual(len(resp.json()['results']), 1)
        resp = self.client.get(f'/api/freelance/tasks/?event={self.event.id}')
        self.assertEqual(len(resp.json()['results']), 2)

    def test_delete_task(self):
        task = FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='T1')
        resp = self.client.delete(f'/api/freelance/tasks/{task.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(FreelanceTask.objects.filter(id=task.id).exists())

    def test_event_task_progress(self):
        FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='A', status='SELESAI')
        FreelanceTask.objects.create(event=self.event, freelancer=self.freelancer, title='B', status='BELUM_MULAI')
        resp = self.client.get(f'/api/freelance/events/{self.event.id}/task-progress/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['total'], 2)
        self.assertEqual(data['SELESAI'], 1)
        self.assertEqual(data['percentage'], 50)

    def test_unauthenticated_denied(self):
        self.client.logout()
        resp = self.client.get('/api/freelance/tasks/')
        self.assertIn(resp.status_code, (401, 403))


class SchedulerSettingsApiTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)

    def test_get_default_policy(self):
        resp = self.client.get('/api/freelance/task-scheduler/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['enabled'])
        self.assertEqual(data['reminder_offsets'], '3,1,0')
        self.assertEqual(data['reminder_offset_list'], [3, 1, 0])
        self.assertEqual(data['escalate_after_days'], 1)
        self.assertEqual(data['max_escalations'], 3)

    def test_patch_policy_and_singleton(self):
        resp = self.client.patch('/api/freelance/task-scheduler/1/', {
            'reminder_offsets': '7, 2', 'escalate_after_days': 2, 'max_escalations': 5,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['reminder_offsets'], '7,2')  # normalized
        self.assertEqual(data['escalate_after_days'], 2)
        self.assertEqual(data['updated_by'], self.admin.id)
        # Still a singleton — second object never created.
        self.assertEqual(TaskEscalationPolicy.objects.count(), 1)

    def test_patch_invalid_offsets_rejected(self):
        for bad in ('abc', '3,,1', '1;2', '99'):
            resp = self.client.patch(
                '/api/freelance/task-scheduler/1/',
                {'reminder_offsets': bad},
                content_type='application/json',
            )
            self.assertEqual(resp.status_code, 400, bad)

    def test_patch_invalid_cc_email_rejected(self):
        resp = self.client.patch('/api/freelance/task-scheduler/1/', {
            'escalation_cc_emails': 'hr@feraco.id, bukan-email',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_cc_emails_normalized(self):
        resp = self.client.patch('/api/freelance/task-scheduler/1/', {
            'escalation_cc_emails': 'a@x.com; b@y.com ,c@z.com',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['escalation_cc_emails'], 'a@x.com, b@y.com, c@z.com')

    def test_unauthenticated_denied(self):
        self.client.logout()
        resp = self.client.get('/api/freelance/task-scheduler/')
        self.assertIn(resp.status_code, (401, 403))


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class TaskReminderEngineTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.freelancer = make_freelancer(full_name='Budi', personal_email='budi@x.com')
        self.event = Event.objects.create(name='Event A')
        self.policy = TaskEscalationPolicy.get_solo()
        self.policy.enabled = True
        self.policy.reminder_offsets = '3,1,0'
        self.policy.escalate_after_days = 1
        self.policy.max_escalations = 3
        self.policy.remind_freelancer = True
        self.policy.remind_pic = False
        self.policy.escalation_cc_emails = ''
        self.policy.save()

    def _task(self, *, deadline, status='BELUM_MULAI', **kw):
        defaults = {
            'event': self.event, 'freelancer': self.freelancer, 'title': 'Setup booth',
            'deadline': deadline, 'status': status,
        }
        defaults.update(kw)
        return FreelanceTask.objects.create(**defaults)

    def _run(self, today):
        from .services import gather_reminders
        return gather_reminders(today=today)

    def test_reminder_d3_d1_d0_fire_in_window(self):
        deadline = date(2026, 9, 20)
        task = self._task(deadline=deadline)
        # Long before deadline: nothing due.
        self.assertEqual(self._run(today=date(2026, 9, 10)), [])
        # D-3 window opens.
        due = self._run(today=date(2026, 9, 17))
        self.assertEqual([(t.id, k, o) for t, k, o, _ in due], [(task.id, 'REMINDER', 3)])
        # D-1 fires the next day (once previous was sent).
        TaskReminderLog.objects.create(task=task, kind='REMINDER', offset_days=3)
        due = self._run(today=date(2026, 9, 19))
        self.assertEqual([(t.id, k, o) for t, k, o, _ in due], [(task.id, 'REMINDER', 1)])

    def test_no_duplicate_send(self):
        task = self._task(deadline=date(2026, 9, 20))
        TaskReminderLog.objects.create(task=task, kind='REMINDER', offset_days=3)
        self.assertEqual(self._run(today=date(2026, 9, 17)), [])

    def test_completed_task_excluded(self):
        self._task(deadline=date(2026, 9, 20), status='SELESAI')
        self.assertEqual(self._run(today=date(2026, 9, 17)), [])

    def test_null_deadline_excluded(self):
        self._task(deadline=None)
        self.assertEqual(self._run(today=date(2026, 9, 17)), [])

    def test_send_mail_delivers_and_logs(self):
        from .services import send_due_reminders
        task = self._task(deadline=date.today() + timedelta(days=3), description='Siapkan booth')
        result = send_due_reminders()
        self.assertEqual(result['sent'], 1)
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        self.assertIn('Event A', body)
        self.assertIn('budi@x.com', mail.outbox[0].to)
        self.assertIn('Siapkan booth', body)
        self.assertTrue(TaskReminderLog.objects.filter(task=task, kind='REMINDER').exists())

    def test_no_recipient_skipped(self):
        from .services import send_due_reminders
        self.freelancer.personal_email = ''
        self.freelancer.save()
        self._task(deadline=date.today() + timedelta(days=3))
        result = send_due_reminders()
        self.assertEqual(result['sent'], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_disabled_policy_sends_nothing(self):
        from .services import send_due_reminders
        self.policy.enabled = False
        self.policy.save()
        self._task(deadline=date.today() + timedelta(days=3))
        result = send_due_reminders()
        self.assertEqual(result['sent'], 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_pic_receives_via_company_email(self):
        from .services import send_due_reminders
        self.freelancer.company_email = 'pic@feraco.id'
        self.freelancer.save()
        self.policy.remind_pic = True
        self.policy.save()
        self._task(deadline=date.today() + timedelta(days=3), pic='Rina')
        result = send_due_reminders()
        self.assertEqual(result['sent'], 1)
        to = mail.outbox[0].to
        self.assertIn('budi@x.com', to)
        self.assertIn('pic@feraco.id', to)

    def test_escalation_fires_after_deadline(self):
        deadline = date(2026, 9, 10)
        task = self._task(deadline=deadline, status='SEDANG_DIKERJAKAN')
        # Deadline day: the D-0 reminder fires first (one email per run).
        due = self._run(today=date(2026, 9, 10))
        self.assertEqual([(t.id, k, o) for t, k, o, _ in due], [(task.id, 'REMINDER', 0)])
        TaskReminderLog.objects.create(task=task, kind='REMINDER', offset_days=0)
        # 1 day overdue -> escalation #1 (escalate_after_days=1).
        due = self._run(today=date(2026, 9, 11))
        self.assertEqual([(t.id, k, n) for t, k, _, n in due], [(task.id, 'ESCALATION', 1)])
        # Escalations repeat every interval up to max.
        for n in (1, 2):
            TaskReminderLog.objects.create(task=task, kind='ESCALATION', offset_days=n)
        due = self._run(today=date(2026, 9, 13))
        self.assertEqual([(t.id, k, n) for t, k, _, n in due], [(task.id, 'ESCALATION', 3)])
        # After max reached: silence.
        TaskReminderLog.objects.create(task=task, kind='ESCALATION', offset_days=3)
        self.assertEqual(self._run(today=date(2026, 9, 20)), [])

    def test_escalation_interval_respected(self):
        self.policy.escalate_after_days = 3
        self.policy.save()
        task = self._task(deadline=date(2026, 9, 1))
        # 1 day overdue with interval 3: nothing yet.
        self.assertEqual(self._run(today=date(2026, 9, 2)), [])
        # 3 days overdue: escalation #1.
        due = self._run(today=date(2026, 9, 4))
        self.assertEqual([(t.id, k, n) for t, k, _, n in due], [(task.id, 'ESCALATION', 1)])
        # Catch-up: run only after 12 days -> escalations 2..3 due, sends one per run.
        TaskReminderLog.objects.create(task=task, kind='ESCALATION', offset_days=1)
        due = self._run(today=date(2026, 9, 13))
        self.assertEqual([(t.id, k, n) for t, k, _, n in due], [(task.id, 'ESCALATION', 2)])

    def test_escalation_sends_to_cc(self):
        from .services import send_due_reminders
        self.policy.escalation_cc_emails = 'hr@feraco.id'
        self.policy.save()
        self.freelancer.personal_email = ''
        self.freelancer.save()
        self._task(deadline=date.today() - timedelta(days=2))
        result = send_due_reminders()
        self.assertEqual(result['sent'], 1)
        self.assertIn('hr@feraco.id', mail.outbox[0].to)
        self.assertIn('[ESKALASI]', mail.outbox[0].subject)


class GeneralManagerFreelanceAccessTests(TestCase):
    """GENERAL_MANAGER dapat melihat seluruh Freelancer/Talent Pool.

    Scope GM = semua data freelancer (bukan Employee hierarchy): Freelancer
    tidak punya relasi manager/reporting, jadi team_scope_ids() tidak relevan
    dan queryset tetap penuh. Role lain tidak berubah.
    """

    def setUp(self):
        self.gm = make_user('GENERAL_MANAGER', 'gm@test.com')
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.mgmt = make_user('MANAGEMENT', 'mgmt@test.com')
        self.f1 = make_freelancer(full_name='Freelancer A', whatsapp='0811')
        self.f2 = make_freelancer(full_name='Freelancer B', whatsapp='0812')
        make_freelancer(full_name='Freelancer C', whatsapp='0813')

    def test_gm_sees_all_freelancers(self):
        self.client.force_login(self.gm)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 200)
        names = {f['full_name'] for f in resp.json()['results']}
        self.assertEqual(names, {'Freelancer A', 'Freelancer B', 'Freelancer C'})

    def test_gm_not_limited_by_reporting_hierarchy(self):
        # GM tidak punya (atau punya) Employee ter-link — hasil tetap semua
        # freelancer, tidak terpengaruh Employee.manager apa pun.
        from apps.personnel.models import Employee
        emp = Employee.objects.create(
            employee_id='GM-001', full_name='GM Person', user=self.gm,
        )
        # anak buah GM (Employee hierarchy) tidak mengubah daftar freelancer.
        Employee.objects.create(
            employee_id='CHILD-001', full_name='Child Person', manager=emp,
        )
        self.client.force_login(self.gm)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 3)
        # filter/search existing tetap bekerja atas seluruh data.
        resp = self.client.get('/api/freelance/freelancers/?search=0811')
        names = [f['full_name'] for f in resp.json()['results']]
        self.assertEqual(names, ['Freelancer A'])

    def test_management_behavior_unchanged(self):
        self.client.force_login(self.mgmt)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 3)

    def test_hr_behavior_unchanged(self):
        self.client.force_login(self.hr)
        resp = self.client.get('/api/freelance/freelancers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 3)

    def test_gm_read_only_all_mutations_403(self):
        """GM: GET ok, semua mutation 403 (freelancer, skill, event,
        assignment, performance, document, blacklist via update)."""
        from .models import Skill
        self.client.force_login(self.gm)
        base = '/api/freelance'

        def post(url, data):
            return self.client.post(url, data, content_type='application/json')

        # --- Freelancer create / update / delete ---
        self.assertEqual(post(f'{base}/freelancers/', {
            'full_name': 'X', 'whatsapp': '080',
        }).status_code, 403)
        f = self.f1
        self.assertEqual(
            self.client.put(
                f'{base}/freelancers/{f.id}/', {'full_name': 'Hacked', 'is_blacklisted': True},
                content_type='application/json',
            ).status_code, 403)
        self.assertEqual(
            self.client.delete(f'{base}/freelancers/{f.id}/').status_code, 403)

        # --- Skill & kategori mutation ---
        self.assertEqual(post(f'{base}/skill-categories/', {'name': 'Cat'}).status_code, 403)
        self.assertEqual(post(f'{base}/skills/', {'name': 'Skill'}).status_code, 403)
        skill = Skill.objects.create(name='MC')
        self.assertEqual(
            post(f'{base}/freelancers/{f.id}/skills/', {'skill': skill.id}).status_code, 403)
        self.assertEqual(
            self.client.delete(f'{base}/freelancers/{f.id}/skills/?skill={skill.id}').status_code, 403)

        # --- Event / assignment / performance ---
        self.assertEqual(post(f'{base}/events/', {'name': 'Ev'}).status_code, 403)
        ev = Event.objects.create(name='Ev A')
        asg = self.client.get(f'{base}/assignments/?freelancer={f.id}')
        asg = post(f'{base}/assignments/', {'freelancer': f.id, 'event': ev.id})
        self.assertEqual(asg.status_code, 403)
        # performance mutation on an existing assignment
        from .models import EventAssignment
        a = EventAssignment.objects.create(freelancer=f, event=ev)
        self.assertEqual(post(f'{base}/assignments/{a.id}/performance/', {
            'rating': 5, 'recommendation': 'RECOMMENDED',
        }).status_code, 403)
        self.assertEqual(
            self.client.delete(f'{base}/assignments/{a.id}/').status_code, 403)

        # --- Document upload / delete (download tetap boleh: GET) ---
        self.assertEqual(
            self.client.post(f'{base}/freelancers/{f.id}/documents/', {
                'doc_type': 'CV', 'name': 'CV', 'url': 'https://x.com/cv.pdf',
            }, content_type='application/json').status_code, 403)

        # --- GET tetap boleh: list, detail, filter, download ---
        self.assertEqual(self.client.get(f'{base}/freelancers/').status_code, 200)
        self.assertEqual(self.client.get(f'{base}/freelancers/{f.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'{base}/freelancers/?search=0811').status_code, 200)
        self.assertEqual(self.client.get(f'{base}/events/').status_code, 200)
        self.assertEqual(self.client.get(f'{base}/assignments/?event={ev.id}').status_code, 200)


class TaskReminderRegressionTests(TestCase):
    """Regression harness: reminder tests that ended up after the GM tests.
    Shares the same setup as TaskReminderEngineTests."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.freelancer = make_freelancer(full_name='Budi', personal_email='budi@x.com')
        self.event = Event.objects.create(name='Event A')
        self.policy = TaskEscalationPolicy.get_solo()
        self.policy.enabled = True
        self.policy.reminder_offsets = '3,1,0'
        self.policy.escalate_after_days = 1
        self.policy.max_escalations = 3
        self.policy.remind_freelancer = True
        self.policy.remind_pic = False
        self.policy.escalation_cc_emails = ''
        self.policy.save()

    def _task(self, *, deadline, status='BELUM_MULAI', **kw):
        defaults = {
            'event': self.event, 'freelancer': self.freelancer, 'title': 'Setup booth',
            'deadline': deadline, 'status': status,
        }
        defaults.update(kw)
        return FreelanceTask.objects.create(**defaults)

    def _run(self, today):
        from .services import gather_reminders
        return gather_reminders(today=today)

    def test_escalation_not_for_completed(self):
        self._task(deadline=date.today() - timedelta(days=2), status='SELESAI')
        self.assertEqual(self._run(today=date.today()), [])

    def test_command_dry_run_and_send(self):
        from io import StringIO
        from django.core.management import call_command
        self._task(deadline=date.today() + timedelta(days=3))
        out = StringIO()
        call_command('send_task_reminders', '--dry-run', stdout=out)
        self.assertIn('REMINDER D-3', out.getvalue())
        self.assertEqual(len(mail.outbox), 0)
        call_command('send_task_reminders', stdout=out)
        self.assertEqual(len(mail.outbox), 1)
        out = StringIO()
        call_command('send_task_reminders', stdout=out)
        self.assertIn('Tidak ada', out.getvalue())  # idempotent: no repeat
        self.assertEqual(len(mail.outbox), 1)

    def test_burst_only_sends_most_urgent_once(self):
        """Task created after deadline passed: single reminder, not the ladder."""
        self._task(deadline=date.today() + timedelta(days=1))
        from .services import send_due_reminders
        result = send_due_reminders()
        self.assertEqual(result['sent'], 1)
        log = TaskReminderLog.objects.filter(kind='REMINDER').get()
        self.assertEqual(log.offset_days, 1)  # most urgent due offset, single email
