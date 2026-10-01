from datetime import date, timedelta
import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Department, Position

from .models import Candidate, FreelanceApplyForm, Job

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

class RecruitmentTypeTests(TestCase):
    """Inhouse vs Freelance recruitment split: job typing, candidate
    isolation, and the freelance -> Talent Pool bridge."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.job_inhouse = Job.objects.create(
            title='Inhouse Dev', slug='inhouse-dev', department=self.department,
            position=self.position, description='d', requirements='r',
            employment_type='FULL_TIME', location='Jakarta',
            open_date=date.today(), status='OPEN',
        )
        self.job_freelance = Job.objects.create(
            title='Freelance MC', slug='freelance-mc', department=self.department,
            position=self.position, description='d', requirements='r',
            employment_type='FREELANCE', recruitment_type='FREELANCE',
            location='Jakarta', open_date=date.today(), status='OPEN',
        )

    def test_default_recruitment_type_is_inhouse(self):
        self.assertEqual(self.job_inhouse.recruitment_type, 'INHOUSE')

    def test_create_inhouse_and_freelance_jobs(self):
        resp = self.client.post('/api/recruitment/jobs/', _job_data(
            self.department, self.position, title='Job A',
        ), content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['recruitment_type'], 'INHOUSE')
        resp = self.client.post('/api/recruitment/jobs/', _job_data(
            self.department, self.position, title='Job B', recruitment_type='FREELANCE',
        ), content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['recruitment_type'], 'FREELANCE')

    def test_create_freelance_job_without_department_or_position(self):
        """Freelance jobs use free-text position; department/FK/employment_type not required."""
        resp = self.client.post('/api/recruitment/jobs/', {
            'title': 'MC Wedding',
            'position_text': 'MC',
            'description': 'd',
            'requirements': 'r',
            'recruitment_type': 'FREELANCE',
            'location': 'Jakarta',
            'open_date': str(date.today()),
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIsNone(data['department'])
        self.assertIsNone(data['position'])
        self.assertEqual(data['position_text'], 'MC')
        self.assertEqual(data['status'], 'OPEN')  # complete per freelance rules

        # incomplete freelance job (no position_text) -> DRAFT
        resp = self.client.post('/api/recruitment/jobs/', {
            'title': 'Photographer', 'recruitment_type': 'FREELANCE',
            'open_date': str(date.today()),
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['status'], 'DRAFT')

    def test_edit_freelance_job_clears_inhouse_fields(self):
        resp = self.client.patch(f'/api/recruitment/jobs/{self.job_inhouse.id}/', {
            'recruitment_type': 'FREELANCE',
            'position_text': 'Event Crew',
            'department': None,
            'position': None,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNone(data['department'])
        self.assertIsNone(data['position'])
        self.assertEqual(data['position_text'], 'Event Crew')

    def test_edit_freelance_job_to_inhouse_requires_master_data(self):
        """Switching a freelance job to INHOUSE without department/position -> DRAFT."""
        resp = self.client.patch(f'/api/recruitment/jobs/{self.job_freelance.id}/', {
            'recruitment_type': 'INHOUSE',
            'department': None,
            'position': None,
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['recruitment_type'], 'INHOUSE')
        self.assertEqual(data['status'], 'DRAFT')  # department/position missing for inhouse

    def test_existing_inhouse_job_behavior_unchanged(self):
        resp = self.client.patch(f'/api/recruitment/jobs/{self.job_inhouse.id}/', {
            'title': 'Inhouse Dev v2',
        }, content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'OPEN')  # still complete as inhouse

    def test_invalid_recruitment_type_rejected(self):
        resp = self.client.post('/api/recruitment/jobs/', _job_data(
            self.department, self.position, title='Job C', recruitment_type='BOGUS',
        ), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_job_filter_by_recruitment_type(self):
        resp = self.client.get('/api/recruitment/jobs/?recruitment_type=INHOUSE')
        ids = {j['id'] for j in resp.json()['results']}
        self.assertIn(self.job_inhouse.id, ids)
        self.assertNotIn(self.job_freelance.id, ids)
        resp = self.client.get('/api/recruitment/jobs/?recruitment_type=FREELANCE')
        ids = {j['id'] for j in resp.json()['results']}
        self.assertIn(self.job_freelance.id, ids)
        self.assertNotIn(self.job_inhouse.id, ids)

    def _candidate(self, job, email='cand@test.com'):
        return Candidate.objects.create(
            job=job, full_name='Candra', email=email, phone='081234567890',
        )

    def test_candidate_filter_by_recruitment_type(self):
        inhouse = self._candidate(self.job_inhouse, 'a@test.com')
        freelance = self._candidate(self.job_freelance, 'b@test.com')
        resp = self.client.get('/api/recruitment/candidates/?recruitment_type=INHOUSE')
        ids = {c['id'] for c in resp.json()['results']}
        self.assertEqual(ids, {inhouse.id})
        resp = self.client.get('/api/recruitment/candidates/?recruitment_type=FREELANCE')
        ids = {c['id'] for c in resp.json()['results']}
        self.assertEqual(ids, {freelance.id})

    def test_freelance_accept_enters_talent_pool_no_employee(self):
        from apps.personnel.models import Employee, Freelancer

        cand = self._candidate(self.job_freelance, 'freelance@test.com')
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['created'])
        cand.refresh_from_db()
        self.assertEqual(cand.status, 'OFFER_ACCEPTED')
        # Freelancer created with mapped data.
        fl = Freelancer.objects.get(personal_email='freelance@test.com')
        self.assertEqual(fl.full_name, 'Candra')
        self.assertEqual(fl.whatsapp, '081234567890')
        # No Employee / User account created by the freelance flow.
        self.assertFalse(Employee.objects.filter(full_name='Candra').exists())

    def test_freelance_accept_dedups_existing_freelancer(self):
        from apps.freelance.models import Freelancer

        Freelancer.objects.create(
            full_name='Candra Lama', personal_email='freelance@test.com',
            domicile='Jakarta',
        )
        cand = self._candidate(self.job_freelance, 'freelance@test.com')
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['created'])
        # Exactly one freelancer; curated name/domicile untouched.
        self.assertEqual(Freelancer.objects.filter(personal_email='freelance@test.com').count(), 1)
        fl = Freelancer.objects.get(personal_email='freelance@test.com')
        self.assertEqual(fl.full_name, 'Candra Lama')
        self.assertEqual(fl.domicile, 'Jakarta')

    def test_inhouse_candidate_cannot_use_freelance_accept(self):
        cand = self._candidate(self.job_inhouse, 'inhouse@test.com')
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 400)

    def test_freelance_accept_rejected_candidate_blocked(self):
        cand = self._candidate(self.job_freelance, 'rej@test.com')
        cand.status = 'REJECTED'
        cand.save(update_fields=['status'])
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 400)

    def test_freelance_accept_maps_domicile_and_position_to_skill(self):
        """Candidate location/position map to Freelancer domicile/skills when available."""
        from apps.freelance.models import Freelancer

        cand = self._candidate(self.job_freelance, 'map@test.com')
        # Job freelance uses position_text; location is on the job.
        self.job_freelance.position_text = 'MC'
        self.job_freelance.save(update_fields=['position_text'])
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 200)
        fl = Freelancer.objects.get(personal_email='map@test.com')
        self.assertEqual(fl.domicile, self.job_freelance.location)
        self.assertTrue(fl.freelancer_skills.filter(skill__name=self.job_freelance.position_text).exists())

    def test_serializer_exposes_talent_pool_flag(self):
        cand = self._candidate(self.job_freelance, 'flag@test.com')
        resp = self.client.get(f'/api/recruitment/candidates/{cand.id}/')
        self.assertIsNone(resp.json()['talent_pool_freelancer_id'])
        self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        resp = self.client.get(f'/api/recruitment/candidates/{cand.id}/')
        self.assertIsNotNone(resp.json()['talent_pool_freelancer_id'])

    def test_inhouse_pipeline_transitions_unchanged(self):
        """Inhouse candidate still walks Screening -> ... -> Offer Accepted."""
        cand = self._candidate(self.job_inhouse, 'pipe@test.com')
        for st in ('SCREENING', 'INTERVIEW_HR', 'INTERVIEW_USER', 'INTERVIEW_GM', 'OFFERING', 'OFFER_ACCEPTED'):
            resp = self.client.post(
                f'/api/recruitment/candidates/{cand.id}/transition/',
                {'status': st}, content_type='application/json',
            )
            self.assertEqual(resp.status_code, 200, st)
        cand.refresh_from_db()
        self.assertEqual(cand.status, 'OFFER_ACCEPTED')

    def test_unauth_cannot_accept_freelance(self):
        cand = self._candidate(self.job_freelance, 'x@test.com')
        self.client.logout()
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertIn(resp.status_code, (401, 403))


class CvUploadValidationTests(TestCase):
    """CV upload: filename with special chars, validation, storage error mapping."""

    def setUp(self):
        self.admin = make_user('ADMIN')
        self.client.force_login(self.admin)
        self.job = Job.objects.create(
            title='Backend Dev', recruitment_type='FREELANCE',
            employment_type='CONTRACT', location='Remote',
            open_date=timezone.localdate(),
        )

    def _cv(self, name, content=b'%PDF-1.4 x', mime='application/pdf'):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, content, content_type=mime)

    def _upload(self, name):
        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        return self.client.post(
            f'/api/recruitment/candidates/{c.id}/cv/', {'file': self._cv(name)}, format='multipart'
        )

    def test_rejects_non_pdf_extension(self):
        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        resp = self.client.post(
            f'/api/recruitment/candidates/{c.id}/cv/',
            {'file': self._cv('cv.exe', b'MZ', 'application/octet-stream')}, format='multipart'
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('PDF', resp.json()['detail'])

    def test_rejects_oversized_file(self):
        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        big = self._cv('cv.pdf', b'x' * (10 * 1024 * 1024 + 1))
        resp = self.client.post(f'/api/recruitment/candidates/{c.id}/cv/', {'file': big}, format='multipart')
        self.assertEqual(resp.status_code, 400)

    def test_storage_failure_is_502_not_500(self):
        from apps.personnel import storage

        c = Candidate.objects.create(job=self.job, full_name='Budi', email='budi@test.com')
        if not storage.is_configured():
            self.skipTest('storage not configured')
        with self.subTest('storage error surfaces as 502'):
            with mock.patch.object(storage, 'upload_bytes', side_effect=RuntimeError('Storage upload failed (400): Invalid key')):
                resp = self.client.post(
                    f'/api/recruitment/candidates/{c.id}/cv/',
                    {'file': self._cv('cv.pdf')}, format='multipart'
                )
                self.assertEqual(resp.status_code, 502)
                self.assertIn('storage', resp.json()['detail'].lower())

    def test_special_char_filename_encoded_for_storage(self):
        from apps.personnel.storage import _quoted_path

        # '%', '#', '&' must be percent-encoded so the Supabase URL is valid.
        self.assertEqual(_quoted_path('cvs/1/CV 100%.pdf'), 'cvs/1/CV%20100%25.pdf')
        self.assertEqual(_quoted_path('cvs/1/CV & Portfolio#1.pdf'), 'cvs/1/CV%20%26%20Portfolio%231.pdf')
        self.assertEqual(_quoted_path('cvs/1/CV+Sari.pdf'), 'cvs/1/CV%2BSari.pdf')
        # slashes survive as separators
        self.assertTrue(_quoted_path('cvs/1/x.pdf').startswith('cvs/1/'))


class PublicFreelancePortalTests(TestCase):
    """Public /freelance/apply/<slug> portal: HR-configured form + Skill master."""

    def setUp(self):
        from apps.freelance.models import Skill, SkillCategory

        from .views import PublicFreelancePortalView

        PublicFreelancePortalView._rate.clear()
        self.cat = SkillCategory.objects.create(name='Crew')
        self.s_mc = Skill.objects.create(name='MC', category=self.cat)
        self.s_photo = Skill.objects.create(name='Photographer', category=self.cat)
        self.s_usher = Skill.objects.create(name='Usher', category=self.cat)
        self.form = FreelanceApplyForm.objects.create(title='Open Recruitment Freelance')
        self.form.skills.set([self.s_mc, self.s_photo])
        self.detail_url = f'/api/recruitment/public/freelance/apply/{self.form.slug}/'
        self.apply_url = self.detail_url

    def _payload(self, **over):
        data = {
            'full_name': 'Rina Kurnia',
            'phone': '081234567890',
            'email': 'rina@example.com',
            'domicile': 'Depok',
            'skill_id': str(self.s_mc.id),
            'portfolio_url': 'https://portfolio.rina.id',
            'expected_rate': 'Rp 1.500.000/event',
            'notes': '5 tahun pengalaman MC.',
            'cv': None,
        }
        data.update(over)
        return data

    def _post_apply(self, data):
        from django.core.files.uploadedfile import SimpleUploadedFile

        with __import__('unittest').mock.patch('apps.recruitment.views.is_configured', return_value=True), \
             __import__('unittest').mock.patch('apps.recruitment.views.upload_bytes') as up:
            res = self.client.post(self.apply_url, {**data, 'cv': SimpleUploadedFile('cv.pdf', b'data', content_type='application/pdf')}, format='multipart')
        return res, up

    def test_public_form_detail_without_login(self):
        res = self.client.get(self.detail_url)
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body['title'], 'Open Recruitment Freelance')
        names = [s['name'] for s in body['skills']]
        # Only skills HR selected — Usher not on the form.
        self.assertEqual(sorted(names), ['MC', 'Photographer'])

    def test_inactive_form_hidden(self):
        self.form.is_active = False
        self.form.save()
        res = self.client.get(self.detail_url)
        self.assertEqual(res.status_code, 404)

    def test_apply_creates_one_candidate_in_freelance_recruitment(self):
        res, up = self._post_apply(self._payload())
        self.assertEqual(res.status_code, 201, res.content)
        cands = Candidate.objects.filter(email='rina@example.com')
        self.assertEqual(cands.count(), 1)
        cand = cands.get()
        self.assertEqual(cand.source, 'PORTAL')
        self.assertEqual(cand.status, 'APPLIED')
        self.assertEqual(cand.applied_skill.skill_id, self.s_mc.id)
        self.assertEqual(cand.applied_skill.form_id, self.form.id)
        self.assertIsNotNone(cand.applied_skill.submitted_at)
        # Filed under an internal FREELANCE job -> shows up in Recruitment Freelance.
        self.assertEqual(cand.job.recruitment_type, 'FREELANCE')
        # CV uploaded once to the recruitment bucket.
        self.assertTrue(cand.cv_path)
        up.assert_called_once()
        self.assertTrue(str(up.call_args[0][0]).startswith('recruitment-cvs'))
        # Extra details stored as note.
        self.assertTrue(any('Domisili: Depok' in n.note for n in cand.notes.all()))
        # No Employee/User/Freelancer created on submit.
        from apps.freelance.models import Freelancer
        from apps.personnel.models import Employee

        self.assertEqual(Freelancer.objects.filter(personal_email='rina@example.com').count(), 0)
        self.assertFalse(User.objects.filter(email='rina@example.com').exists())
        self.assertEqual(Employee.objects.filter(company_email='rina@example.com').count(), 0)

    def test_skill_must_be_selected_by_hr_on_the_form(self):
        res, _ = self._post_apply(self._payload(skill_id=str(self.s_usher.id)))
        self.assertEqual(res.status_code, 400, res.content)
        self.assertFalse(Candidate.objects.filter(email='rina@example.com').exists())
        # Nonexistent skill id.
        res, _ = self._post_apply(self._payload(skill_id='99999'))
        self.assertEqual(res.status_code, 400)

    def test_cv_or_portfolio_url_required(self):
        payload = {k: v for k, v in self._payload().items() if v is not None}
        payload['portfolio_url'] = ''
        res = self.client.post(self.apply_url, payload, format='multipart')
        self.assertEqual(res.status_code, 400)
        # Portfolio URL without CV is accepted.
        payload['portfolio_url'] = 'https://rina.id'
        with __import__('unittest').mock.patch('apps.recruitment.views.is_configured', return_value=True):
            res = self.client.post(self.apply_url, payload, format='multipart')
        self.assertEqual(res.status_code, 201, res.content)

    def test_cv_type_and_size_validated(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        res, _ = self._post_apply(self._payload())
        with __import__('unittest').mock.patch('apps.recruitment.views.is_configured', return_value=True):
            res = self.client.post(
                self.apply_url,
                {**self._payload(email='x@example.com'), 'cv': SimpleUploadedFile('cv.exe', b'data', content_type='application/octet-stream')},
                format='multipart',
            )
        self.assertEqual(res.status_code, 400)
        self.assertIn('CV', res.json()['cv'][0])

    def test_duplicate_rejected_within_24h(self):
        from .views import PublicFreelancePortalView

        res, _ = self._post_apply(self._payload())
        self.assertEqual(res.status_code, 201)
        PublicFreelancePortalView._rate.clear()
        res, _ = self._post_apply(self._payload())
        self.assertEqual(res.status_code, 409)
        # Same email but different skill is allowed.
        PublicFreelancePortalView._rate.clear()
        res, _ = self._post_apply(self._payload(skill_id=str(self.s_photo.id)))
        self.assertEqual(res.status_code, 201)

    def test_rate_limit(self):
        for i in range(5):
            res, _ = self._post_apply(self._payload(email=f'u{i}@example.com'))
            self.assertEqual(res.status_code, 201)
        res, _ = self._post_apply(self._payload(email='extra@example.com'))
        self.assertEqual(res.status_code, 429)

    def test_candidates_visible_in_freelance_recruitment_list(self):
        self._post_apply(self._payload())
        admin = make_user('ADMIN', 'hradmin@test.com')
        self.client.force_login(admin)
        res = self.client.get('/api/recruitment/candidates/?recruitment_type=FREELANCE')
        self.assertEqual(res.status_code, 200)
        names = [c['full_name'] for c in res.json()['results']]
        self.assertIn('Rina Kurnia', names)
        res = self.client.get('/api/recruitment/candidates/?recruitment_type=INHOUSE')
        names = [c['full_name'] for c in res.json()['results']]
        self.assertNotIn('Rina Kurnia', names)


class FreelanceApplyFormHRTests(TestCase):
    """HR dashboard management of apply forms + acceptance -> Talent Pool mapping."""

    def setUp(self):
        from apps.freelance.models import Skill, SkillCategory

        self.cat = SkillCategory.objects.create(name='Talent')
        self.s_mc = Skill.objects.create(name='MC', category=self.cat)
        self.s_talent = Skill.objects.create(name='Talent', category=self.cat)
        self.form = FreelanceApplyForm.objects.create(title='Open Recruitment Freelance')
        self.form.skills.set([self.s_mc, self.s_talent])
        self.list_url = '/api/recruitment/freelance-apply-forms/'

    def _apply_public(self, email='rina@example.com', skill=None):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .views import PublicFreelancePortalView

        PublicFreelancePortalView._rate.clear()
        with __import__('unittest').mock.patch('apps.recruitment.views.is_configured', return_value=True), \
             __import__('unittest').mock.patch('apps.recruitment.views.upload_bytes'):
            self.client.post(
                f'/api/recruitment/public/freelance/apply/{self.form.slug}/',
                {
                    'full_name': 'Rina Kurnia', 'phone': '081234567890', 'email': email,
                    'skill_id': str((skill or self.s_mc).id),
                    'cv': SimpleUploadedFile('cv.pdf', b'data', content_type='application/pdf'),
                },
                format='multipart',
            )
        return Candidate.objects.get(email=email)

    def _hr_client(self, role='ADMIN'):
        user = make_user(role, f'{role.lower()}@test.com')
        self.client.force_login(user)
        return user

    def test_hr_crud_form(self):
        self._hr_client()
        res = self.client.post(
            self.list_url,
                json.dumps({'title': 'Form Crew', 'skills': [self.s_mc.id, self.s_talent.id], 'is_active': True}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 201, res.content)
        form_id = res.json()['id']
        self.assertTrue(res.json()['slug'])
        self.assertTrue(res.json()['public_url'].endswith(f"/freelance/apply/{res.json()['slug']}"))
        # No duplicate skills created in the master.
        from apps.freelance.models import Skill

        self.assertEqual(Skill.objects.count(), 2)
        # Update: deactivate + change skills.
        res = self.client.patch(
            f'{self.list_url}{form_id}/',
                json.dumps({'is_active': False, 'skills': [self.s_mc.id]}),
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.json()['is_active'])
        self.assertEqual([s['name'] for s in res.json()['skill_details']], ['MC'])
        # Applicants count.
        res = self.client.get(f'{self.list_url}{form_id}/')
        self.assertEqual(res.json()['applications_count'], 0)

    def test_hr_permission(self):
        # MANAGEMENT is not in FREELANCE_ROLES -> denied.
        user = make_user('MANAGEMENT', 'mgmt@test.com')
        self.client.force_login(user)
        res = self.client.get(self.list_url)
        self.assertEqual(res.status_code, 403)
        # Anonymous denied too.
        self.client.logout()
        res = self.client.get(self.list_url)
        self.assertEqual(res.status_code, 403)

    def test_applicants_endpoint_and_filter_by_skill(self):
        self._hr_client()
        self._apply_public('a@example.com', skill=self.s_mc)
        self._apply_public('b@example.com', skill=self.s_talent)
        res = self.client.get(f'{self.list_url}{self.form.id}/applicants/')
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        data = body['results'] if isinstance(body, dict) and 'results' in body else body
        self.assertEqual(len(data), 2)
        skills = {d['skill_name'] for d in data}
        self.assertEqual(skills, {'MC', 'Talent'})
        # Filter by skill.
        res = self.client.get(f'{self.list_url}{self.form.id}/applicants/?skill_id={self.s_mc.id}')
        body = res.json()
        data = body['results'] if isinstance(body, dict) and 'results' in body else body
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['skill_name'], 'MC')
        self.assertIsNotNone(data[0]['submitted_at'])

    def test_accept_maps_candidate_skill_to_freelancer_without_duplicate_skill(self):
        from apps.freelance.models import Freelancer, Skill

        cand = self._apply_public()
        admin = self._hr_client('ADMIN')
        res = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(res.status_code, 200, res.content)
        freelancer = Freelancer.objects.get(personal_email='rina@example.com')
        fl_skills = {fs.skill.name for fs in freelancer.freelancer_skills.all()}
        # Mapped using the EXISTING skill — no duplicate created.
        self.assertEqual(fl_skills, {'MC'})
        self.assertEqual(Skill.objects.filter(name='MC').count(), 1)
        cand.refresh_from_db()
        self.assertEqual(cand.status, 'OFFER_ACCEPTED')


class FreelanceJobSkillTests(TestCase):
    """Add New Job (FREELANCE): positions picked from the existing freelance
    Skill/Category master; INHOUSE flow untouched."""

    def setUp(self):
        from apps.freelance.models import Skill, SkillCategory

        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        talent = SkillCategory.objects.create(name='Talent')
        self.s_mc = Skill.objects.create(name='MC', category=talent)
        self.s_usher = Skill.objects.create(name='Usher', category=talent)
        self.s_old = Skill.objects.create(name='Old Skill', is_active=False)

    def _freelance_payload(self, **overrides):
        data = {
            'title': 'Freelance Event Oktober',
            'department': None,
            'position': None,
            'skills': [self.s_mc.id, self.s_usher.id],
            'description': 'd',
            'requirements': 'r',
            'employment_type': 'FREELANCE',
            'recruitment_type': 'FREELANCE',
            'location': 'Jakarta',
            'open_date': str(date.today()),
            'close_date': None,
        }
        data.update(overrides)
        return data

    def test_create_freelance_job_with_multiple_skills(self):
        from apps.freelance.models import Skill

        before = Skill.objects.count()
        resp = self.client.post('/api/recruitment/jobs/', self._freelance_payload(), content_type='application/json')
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(set(data['skills']), {self.s_mc.id, self.s_usher.id})
        self.assertEqual({s['category'] for s in data['skill_details']}, {'Talent'})
        self.assertEqual(data['status'], 'OPEN')
        self.assertEqual(data['position_text'], 'MC, Usher')
        job = Job.objects.get(pk=data['id'])
        self.assertEqual(set(job.skills.values_list('pk', flat=True)), {self.s_mc.id, self.s_usher.id})
        self.assertEqual(Skill.objects.count(), before)  # no new master rows

    def test_freelance_without_skills_is_draft_not_400(self):
        resp = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(skills=[]), content_type='application/json'
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['status'], 'DRAFT')

    def test_inactive_or_unknown_skill_rejected(self):
        resp = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(skills=[self.s_old.id]), content_type='application/json'
        )
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(skills=[99999]), content_type='application/json'
        )
        self.assertEqual(resp.status_code, 400)

    def test_inhouse_ignores_hidden_skills_field(self):
        """Hidden freelance field never validated/stored for INHOUSE."""
        resp = self.client.post('/api/recruitment/jobs/', _job_data(
            self.department, self.position, title='Backend Dev', skills=[self.s_old.id],
        ), content_type='application/json')
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(data['recruitment_type'], 'INHOUSE')
        self.assertEqual(data['skills'], [])
        self.assertEqual(data['status'], 'OPEN')

    def test_switch_freelance_to_inhouse_clears_skills(self):
        job_id = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(), content_type='application/json'
        ).json()['id']
        resp = self.client.put(f'/api/recruitment/jobs/{job_id}/', _job_data(
            self.department, self.position, title='Now Inhouse', recruitment_type='INHOUSE',
        ), content_type='application/json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['skills'], [])
        self.assertFalse(Job.objects.get(pk=job_id).skills.exists())

    def test_edit_skills_and_partial_update_keeps_them(self):
        job_id = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(), content_type='application/json'
        ).json()['id']
        resp = self.client.patch(
            f'/api/recruitment/jobs/{job_id}/', {'skills': [self.s_mc.id]}, content_type='application/json'
        )
        self.assertEqual(resp.json()['skills'], [self.s_mc.id])
        resp = self.client.patch(
            f'/api/recruitment/jobs/{job_id}/', {'title': 'Renamed'}, content_type='application/json'
        )
        self.assertEqual(resp.json()['skills'], [self.s_mc.id])
        self.assertEqual(resp.json()['status'], 'OPEN')

    def test_freelance_job_can_be_closed_and_reopened(self):
        """open/reopen completeness uses freelance rules (no department/position)."""
        job_id = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(), content_type='application/json'
        ).json()['id']
        self.assertEqual(self.client.post(f'/api/recruitment/jobs/{job_id}/close/').status_code, 200)
        resp = self.client.post(f'/api/recruitment/jobs/{job_id}/reopen/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['status'], 'OPEN')

    def test_accept_job_candidate_maps_job_skills_without_new_skill(self):
        from apps.freelance.models import Freelancer, Skill

        job_id = self.client.post(
            '/api/recruitment/jobs/', self._freelance_payload(), content_type='application/json'
        ).json()['id']
        cand = Candidate.objects.create(
            job_id=job_id, full_name='Rina', email='rina@test.com', phone='081234567890'
        )
        before = Skill.objects.count()
        resp = self.client.post(f'/api/recruitment/candidates/{cand.id}/accept-freelance/')
        self.assertEqual(resp.status_code, 200, resp.content)
        fl = Freelancer.objects.get(personal_email='rina@test.com')
        self.assertEqual({fs.skill_id for fs in fl.freelancer_skills.all()}, {self.s_mc.id, self.s_usher.id})
        self.assertEqual(Skill.objects.count(), before)

    def test_skill_master_list_not_truncated(self):
        from apps.freelance.models import Skill

        for i in range(25):
            Skill.objects.create(name=f'Skill {i:02d}')
        resp = self.client.get('/api/freelance/skills/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)
        self.assertEqual(len(resp.json()), Skill.objects.count())


class PublicJobSkillApplyTests(TestCase):
    """Public /jobs/<slug> apply: FREELANCE applicants pick ONE position from
    the job's Skill & Kategori; INHOUSE apply unchanged."""

    def setUp(self):
        from apps.freelance.models import Skill, SkillCategory

        cat = SkillCategory.objects.create(name='Talent')
        self.s_mc = Skill.objects.create(name='MC', category=cat)
        self.s_usher = Skill.objects.create(name='Usher', category=cat)
        self.s_other = Skill.objects.create(name='Photographer')
        self.job = Job.objects.create(
            title='Freelance Event', slug='freelance-event', description='d', requirements='r',
            employment_type='FREELANCE', recruitment_type='FREELANCE', location='Jakarta',
            open_date=date.today(), status='OPEN',
        )
        self.job.skills.set([self.s_mc, self.s_usher])
        dept = Department.objects.create(name='Engineering')
        pos = Position.objects.create(name='Developer', department=dept)
        self.inhouse = Job.objects.create(
            title='Inhouse Dev', slug='inhouse-dev', department=dept, position=pos,
            description='d', requirements='r', employment_type='FULL_TIME', location='Jakarta',
            open_date=date.today(), status='OPEN',
        )

    def _apply(self, job, **extra):
        data = {'job': job.id, 'full_name': 'Rina', 'email': 'rina@test.com', 'phone': '0812345678'}
        data.update(extra)
        return self.client.post('/api/recruitment/candidates/', data, content_type='application/json')

    def test_public_job_exposes_skill_options(self):
        resp = self.client.get(f'/api/recruitment/public/jobs/{self.job.slug}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual({s['name'] for s in resp.json()['skill_details']}, {'MC', 'Usher'})
        self.assertEqual(resp.json()['skill_details'][0]['category'], 'Talent')
        resp = self.client.get(f'/api/recruitment/public/jobs/{self.inhouse.slug}/')
        self.assertEqual(resp.json()['skill_details'], [])

    def test_freelance_apply_with_skill_saved(self):
        from .models import CandidateSkill

        resp = self._apply(self.job, skill_id=self.s_usher.id)
        self.assertEqual(resp.status_code, 201, resp.content)
        cs = CandidateSkill.objects.get(candidate_id=resp.json()['id'])
        self.assertEqual(cs.skill_id, self.s_usher.id)
        self.assertIsNone(cs.form_id)

    def test_freelance_apply_requires_valid_skill(self):
        self.assertEqual(self._apply(self.job).status_code, 400)
        self.assertEqual(self._apply(self.job, skill_id=self.s_other.id).status_code, 400)
        self.assertFalse(Candidate.objects.exists())

    def test_inhouse_apply_ignores_skill(self):
        resp = self._apply(self.inhouse, skill_id=self.s_other.id)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertFalse(hasattr(Candidate.objects.get(pk=resp.json()['id']), 'applied_skill'))

    def test_accept_uses_chosen_skill_only(self):
        from apps.freelance.models import Freelancer

        cand_id = self._apply(self.job, skill_id=self.s_mc.id).json()['id']
        admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(admin)
        detail = self.client.get(f'/api/recruitment/candidates/{cand_id}/').json()
        self.assertEqual(detail['applied_skill']['name'], 'MC')
        resp = self.client.post(f'/api/recruitment/candidates/{cand_id}/accept-freelance/')
        self.assertEqual(resp.status_code, 200, resp.content)
        fl = Freelancer.objects.get(personal_email='rina@test.com')
        self.assertEqual({fs.skill_id for fs in fl.freelancer_skills.all()}, {self.s_mc.id})
