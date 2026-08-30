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
        'status': 'OPEN',
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
        self._create(status='DRAFT')
        self.client.logout()
        resp = self.client.get('/api/recruitment/public/jobs/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

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
        self.assertTrue(Candidate.objects.filter(email='budi@test.com').exists())
        self.assertTrue(AuditLog.objects.filter(action='create').exists())

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