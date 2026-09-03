from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Department, Position

from .models import Candidate, Job

User = get_user_model()


def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


def _job_data(department, position, **overrides):
    data = {
        'title': 'Software Engineer',
        'department': department.id,
        'position': position.id,
        'description': 'Build great things.',
        'requirements': 'Python, Django',
        'employment_type': 'FULL_TIME',
        'location': 'Jakarta',
        'open_date': str(date.today()),
        'close_date': str(date.today() + timedelta(days=30)),
    }
    data.update(overrides)
    return data


class JobTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp = make_user('EMPLOYEE', 'emp@test.com')
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.client.force_login(self.admin)

    def _create(self, **overrides):
        resp = self.client.post(
            '/api/recruitment/jobs/',
            _job_data(self.department, self.position, **overrides),
            content_type='application/json',
        )
        return resp

    def test_create_job(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['title'], 'Software Engineer')
        self.assertTrue(data['slug'])
        self.assertEqual(data['status'], 'OPEN')
        self.assertTrue(AuditLog.objects.filter(action='create', object_id=str(data['id'])).exists())

    def test_incomplete_create_is_draft(self):
        resp = self._create(description='', requirements='', location='')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'DRAFT')

    def test_frontend_cannot_force_status(self):
        # sending status: OPEN on incomplete job must still yield DRAFT
        resp = self._create(status='OPEN', description='', requirements='')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'DRAFT')
        # sending status: DRAFT on complete job must still yield OPEN
        resp = self._create(status='DRAFT')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'OPEN')

    def test_duplicate_slug(self):
        self._create()
        resp = self._create()
        self.assertEqual(resp.status_code, 201)
        self.assertNotEqual(self._create().json()['slug'], resp.json()['slug'])

    def test_hr_can_access(self):
        self.client.logout()
        self.client.force_login(self.hr)
        resp = self.client.get('/api/recruitment/jobs/')
        self.assertEqual(resp.status_code, 200)

    def test_employee_cannot_access(self):
        self.client.logout()
        self.client.force_login(self.emp)
        resp = self.client.get('/api/recruitment/jobs/')
        self.assertEqual(resp.status_code, 403)

    def test_unauth_cannot_access_hr(self):
        self.client.logout()
        resp = self.client.get('/api/recruitment/jobs/')
        self.assertEqual(resp.status_code, 403)

    def test_open_close_reopen(self):
        r = self._create()
        jid = r.json()['id']
        # open again -> 400
        resp = self.client.post(f'/api/recruitment/jobs/{jid}/open/')
        self.assertEqual(resp.status_code, 400)
        # close
        resp = self.client.post(f'/api/recruitment/jobs/{jid}/close/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'CLOSED')
        self.assertTrue(AuditLog.objects.filter(action='close', object_id=str(jid)).exists())
        # close again -> 400
        resp = self.client.post(f'/api/recruitment/jobs/{jid}/close/')
        self.assertEqual(resp.status_code, 400)
        # reopen
        resp = self.client.post(f'/api/recruitment/jobs/{jid}/reopen/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'OPEN')

    def test_delete_draft_only(self):
        r = self._create()
        jid = r.json()['id']
        resp = self.client.delete(f'/api/recruitment/jobs/{jid}/')
        self.assertEqual(resp.status_code, 400)
        # make it DRAFT and delete
        Job.objects.filter(id=jid).update(status='DRAFT')
        resp = self.client.delete(f'/api/recruitment/jobs/{jid}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Job.objects.filter(id=jid).exists())
        self.assertTrue(AuditLog.objects.filter(action='delete', object_id=str(jid)).exists())

    def test_expired_close_date_not_open(self):
        r = self._create(close_date=str(date.today() - timedelta(days=1)))
        self.assertEqual(r.status_code, 201)
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_closed_job_hidden_from_public(self):
        r = self._create()
        jid = r.json()['id']
        self.client.post(f'/api/recruitment/jobs/{jid}/close/')
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_draft_job_hidden_from_public(self):
        self._create(description='', requirements='', location='')  # incomplete → DRAFT
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_complete_draft_becomes_open(self):
        # create incomplete → DRAFT
        r = self._create(description='', requirements='', location='')
        jid = r.json()['id']
        self.assertEqual(r.json()['status'], 'DRAFT')
        # complete all fields → should become OPEN
        resp = self.client.put(
            f'/api/recruitment/jobs/{jid}/',
            _job_data(self.department, self.position),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'OPEN')
        # now visible publicly
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(len(resp.json()), 1)

    def test_closed_job_not_public_even_if_complete(self):
        r = self._create()
        jid = r.json()['id']
        self.client.post(f'/api/recruitment/jobs/{jid}/close/')
        self.client.logout()
        resp = self.client.get(f'/api/recruitment/public/jobs/{jid}/')
        self.assertEqual(resp.status_code, 404)

    def test_public_open_job_accessible(self):
        self._create()
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)
        data = resp.json()[0]
        self.assertNotIn('status', data)
        self.assertNotIn('created_by', data)

    def test_public_job_detail_by_slug(self):
        r = self._create()
        slug = r.json()['slug']
        self.client.logout()
        resp = self.client.get(f'/api/recruitment/public/jobs/{slug}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['title'], 'Software Engineer')


class CandidateTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.emp = make_user('EMPLOYEE', 'emp@test.com')
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.job = Job.objects.create(
            title='Software Engineer',
            slug='software-engineer',
            department=self.department,
            position=self.position,
            description='desc',
            requirements='req',
            employment_type='FULL_TIME',
            location='Jakarta',
            open_date=date.today(),
            close_date=date.today() + timedelta(days=30),
            status='OPEN',
        )
        self.client.force_login(self.admin)

    def test_public_apply_creates_candidate(self):
        self.client.logout()
        resp = self.client.post(
            '/api/recruitment/candidates/',
            {
                'job': self.job.id,
                'full_name': 'Budi',
                'email': 'budi@test.com',
                'phone': '0812',
                'source': 'PORTAL',
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 201)
        c = Candidate.objects.get(email='budi@test.com')
        self.assertEqual(c.status, 'APPLIED')
        self.assertTrue(AuditLog.objects.filter(action='create').exists())

    def test_hr_lists_candidates_filters_by_status(self):
        Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        self.client.logout()
        self.client.force_login(self.hr)
        resp = self.client.get(f'/api/recruitment/candidates/?status=APPLIED&job={self.job.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 1)

    def test_closed_job_cannot_apply(self):
        self.job.status = 'CLOSED'
        self.job.save()
        self.client.logout()
        resp = self.client.post(
            '/api/recruitment/candidates/',
            {
                'job': self.job.id,
                'full_name': 'Budi',
                'email': 'budi@test.com',
                'phone': '0812',
                'source': 'PORTAL',
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Candidate.objects.filter(email='budi@test.com').exists())

    def test_expired_job_cannot_apply(self):
        self.job.close_date = date.today() - timedelta(days=1)
        self.job.save()
        self.client.logout()
        resp = self.client.post(
            '/api/recruitment/candidates/',
            {
                'job': self.job.id,
                'full_name': 'Budi',
                'email': 'budi@test.com',
                'source': 'PORTAL',
            },
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_hr_lists_candidates(self):
        Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        resp = self.client.get('/api/recruitment/candidates/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['results']), 1)

    def test_employee_cannot_list_candidates(self):
        self.client.logout()
        self.client.force_login(self.emp)
        resp = self.client.get('/api/recruitment/candidates/')
        self.assertEqual(resp.status_code, 403)

    def test_cv_upload_requires_file(self):
        self.client.logout()
        self.client.force_login(self.admin)
        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        resp = self.client.post(f'/api/recruitment/candidates/{c.id}/cv/', {}, content_type='application/json')
        # 503 when storage not configured, 400 otherwise
        self.assertIn(resp.status_code, (400, 503))

    def test_cv_upload_works(self):
        from apps.personnel import storage

        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        # storage configured -> actually upload
        if storage.is_configured():
            resp = self.client.post(
                f'/api/recruitment/candidates/{c.id}/cv/',
                {'file': self._cv_file()},
                format='multipart',
            )
            self.assertEqual(resp.status_code, 200)
            self.assertTrue(resp.json()['cv_name'])
            c.refresh_from_db()
            self.assertTrue(c.cv_path)
            # download returns signed url
            resp = self.client.get(f'/api/recruitment/candidates/{c.id}/cv/')
            self.assertEqual(resp.status_code, 200)
            self.assertIn('url', resp.json())
        else:
            resp = self.client.post(
                f'/api/recruitment/candidates/{c.id}/cv/',
                {'file': self._cv_file()},
                format='multipart',
            )
            self.assertEqual(resp.status_code, 503)

    def _cv_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile('cv.pdf', b'%PDF-1.4 test', content_type='application/pdf')


class CandidateTransitionTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.emp = make_user('EMPLOYEE', 'emp@test.com')
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.job = Job.objects.create(
            title='Software Engineer',
            slug='software-engineer',
            department=self.department,
            position=self.position,
            description='desc',
            requirements='req',
            employment_type='FULL_TIME',
            location='Jakarta',
            open_date=date.today(),
            close_date=date.today() + timedelta(days=30),
            status='OPEN',
        )
        self.candidate = Candidate.objects.create(
            job=self.job, full_name='Budi', email='budi@test.com', status='APPLIED'
        )
        self.client.force_login(self.admin)

    def _transition(self, to_status, note=''):
        return self.client.post(
            f'/api/recruitment/candidates/{self.candidate.id}/transition/',
            {'status': to_status, 'note': note},
            content_type='application/json',
        )

    def test_valid_transition(self):
        resp = self._transition('SCREENING', 'lolos admin')
        self.assertEqual(resp.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'SCREENING')
        self.assertTrue(
            self.candidate.status_history.filter(
                from_status='APPLIED', to_status='SCREENING', note='lolos admin'
            ).exists()
        )
        self.assertTrue(AuditLog.objects.filter(action='update').exists())

    def test_full_normal_flow(self):
        for s in ['SCREENING', 'INTERVIEW_HR', 'INTERVIEW_USER', 'INTERVIEW_GM', 'OFFERING', 'OFFER_ACCEPTED']:
            resp = self._transition(s)
            self.assertEqual(resp.status_code, 200, s)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'OFFER_ACCEPTED')
        self.assertEqual(self.candidate.status_history.count(), 6)

    def test_invalid_transition_rejected(self):
        resp = self._transition('OFFER_ACCEPTED')  # skip pipeline
        self.assertEqual(resp.status_code, 400)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'APPLIED')

    def test_invalid_status_value(self):
        resp = self._transition('BOGUS')
        self.assertEqual(resp.status_code, 400)

    def test_reject(self):
        resp = self._transition('REJECTED', 'tidak cocok')
        self.assertEqual(resp.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'REJECTED')
        self.assertTrue(self.candidate.status_history.filter(to_status='REJECTED', note='tidak cocok').exists())

    def test_withdraw(self):
        self._transition('SCREENING')
        resp = self._transition('WITHDRAWN')
        self.assertEqual(resp.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'WITHDRAWN')

    def test_terminal_has_no_transitions(self):
        self._transition('REJECTED')
        resp = self._transition('WITHDRAWN')
        self.assertEqual(resp.status_code, 400)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.status, 'REJECTED')

class HardDeleteTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.admin.is_superuser = True
        self.admin.save()
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.job = Job.objects.create(
            title='Software Engineer',
            slug='software-engineer',
            department=self.department,
            position=self.position,
            description='desc',
            requirements='req',
            employment_type='FULL_TIME',
            location='Jakarta',
            open_date=date.today(),
            close_date=date.today() + timedelta(days=30),
            status='OPEN',
        )
        self.candidate = Candidate.objects.create(
            job=self.job, full_name='Budi', email='budi@test.com', status='APPLIED'
        )
        self.client.force_login(self.admin)

    def test_job_hard_delete_admin_ok(self):
        resp = self.client.delete(f'/api/recruitment/jobs/{self.job.id}/hard-delete/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Job.objects.filter(id=self.job.id).exists())

    def test_job_hard_delete_non_admin_forbidden(self):
        self.client.force_login(self.hr)
        resp = self.client.delete(f'/api/recruitment/jobs/{self.job.id}/hard-delete/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Job.objects.filter(id=self.job.id).exists())

    def test_candidate_hard_delete_admin_ok(self):
        resp = self.client.delete(f'/api/recruitment/candidates/{self.candidate.id}/hard-delete/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Candidate.objects.filter(id=self.candidate.id).exists())

    def test_candidate_hard_delete_non_admin_forbidden(self):
        self.client.force_login(self.hr)
        resp = self.client.delete(f'/api/recruitment/candidates/{self.candidate.id}/hard-delete/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(Candidate.objects.filter(id=self.candidate.id).exists())

    def test_next_statuses_exposed(self):
        resp = self.client.get(f'/api/recruitment/candidates/{self.candidate.id}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('next_statuses', data)
        self.assertIn('SCREENING', data['next_statuses'])