from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Department, Position
from apps.recruitment.models import Candidate, Job

from .models import Onboarding

User = get_user_model()


def make_user(key='ADMIN', username='admin@test.com'):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='password')
    user.role = role
    user.save()
    return user


class OnboardingTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.hr = make_user('HR_STAFF', 'hr@test.com')
        self.mgmt = make_user('MANAGEMENT', 'mgmt@test.com')
        self.emp = make_user('EMPLOYEE', 'emp@test.com')
        self.department = Department.objects.create(name='Engineering')
        self.position = Position.objects.create(name='Developer', department=self.department)
        self.job = Job.objects.create(
            title='Software Engineer',
            slug='software-engineer',
            department=self.department,
            position=self.position,
            employment_type='FULL_TIME',
            location='Jakarta',
            open_date=date.today(),
            status='OPEN',
        )
        self.client.force_login(self.admin)

    def _candidate(self, status='OFFER_ACCEPTED'):
        return Candidate.objects.create(
            job=self.job,
            full_name='Budi Santoso',
            email='budi@test.com',
            phone='08123456789',
            source='PORTAL',
            status=status,
        )

    def _onboarding(self, candidate=None, status='PENDING'):
        return Onboarding.objects.create(
            candidate=candidate or self._candidate(),
            status=status,
            created_by=self.admin,
        )

    def _payload(self, candidate):
        return {
            'candidate': candidate.id,
            'target_join_date': str(date.today() + timedelta(days=14)),
            'notes': 'Siap bergabung.',
        }

    def test_create_from_offer_accepted(self):
        cand = self._candidate()
        resp = self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['status'], 'PENDING')
        self.assertEqual(data['candidate_name'], 'Budi Santoso')
        self.assertEqual(data['job_title'], 'Software Engineer')
        self.assertIn('IN_PROGRESS', data['next_statuses'])
        self.assertTrue(AuditLog.objects.filter(action='create', object_id=str(data['id'])).exists())
        self.assertTrue(Onboarding.objects.filter(candidate=cand).exists())

    def test_create_rejects_non_offer_accepted(self):
        for status in ('APPLIED', 'INTERVIEW_HR', 'OFFERING', 'REJECTED', 'WITHDRAWN'):
            cand = self._candidate(status)
            resp = self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
            self.assertEqual(resp.status_code, 400, status)
            self.assertFalse(Onboarding.objects.filter(candidate=cand).exists())

    def test_duplicate_onboarding_rejected(self):
        cand = self._candidate()
        first = self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
        self.assertEqual(first.status_code, 201)
        resp = self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_list_and_detail(self):
        ob = self._onboarding()
        resp = self.client.get('/api/onboarding/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 1)
        resp = self.client.get(f'/api/onboarding/{ob.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['id'], ob.id)

    def test_patch_notes_and_target_date(self):
        ob = self._onboarding()
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/',
            {'notes': 'Perlu dokumen KTP.'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        ob.refresh_from_db()
        self.assertEqual(ob.notes, 'Perlu dokumen KTP.')

    def _transit(self, ob, to_status, user=None):
        if user:
            self.client.logout()
            self.client.force_login(user)
        return self.client.post(
            f'/api/onboarding/{ob.id}/transition/',
            {'status': to_status, 'note': 'ok'},
            content_type='application/json',
        )

    def test_valid_forward_transitions(self):
        ob = self._onboarding()
        for to_status in ('IN_PROGRESS', 'DOCUMENT_REVIEW', 'READY', 'COMPLETED'):
            resp = self._transit(ob, to_status)
            self.assertEqual(resp.status_code, 200, to_status)
            ob.refresh_from_db()
            self.assertEqual(ob.status, to_status)
        self.assertIsNotNone(ob.completed_at)
        self.assertEqual(ob.status_history.count(), 4)

    def test_backward_transition_rejected(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        resp = self._transit(ob, 'PENDING')
        self.assertEqual(resp.status_code, 400)
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'IN_PROGRESS')

    def test_completed_is_terminal(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        self._transit(ob, 'DOCUMENT_REVIEW')
        self._transit(ob, 'READY')
        self._transit(ob, 'COMPLETED')
        # cannot go back, cannot cancel, cannot edit
        for to_status in ('READY', 'CANCELLED'):
            resp = self._transit(ob, to_status)
            self.assertEqual(resp.status_code, 400)
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/',
            {'notes': 'x'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_cancel_before_completed(self):
        ob = self._onboarding()
        resp = self._transit(ob, 'CANCELLED')
        self.assertEqual(resp.status_code, 200)
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'CANCELLED')
        # cancelled is terminal
        resp = self._transit(ob, 'IN_PROGRESS')
        self.assertEqual(resp.status_code, 400)

    def test_invalid_status_value_rejected(self):
        ob = self._onboarding()
        resp = self.client.post(
            f'/api/onboarding/{ob.id}/transition/',
            {'status': 'NOT_A_STATUS'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_rbac(self):
        ob = self._onboarding()
        # HR full access
        self.client.logout()
        self.client.force_login(self.hr)
        self.assertEqual(self.client.get('/api/onboarding/').status_code, 200)
        self.assertEqual(
            self.client.post('/api/onboarding/', self._payload(self._candidate()), content_type='application/json').status_code,
            201,
        )
        # MANAGEMENT read-only
        self.client.logout()
        self.client.force_login(self.mgmt)
        self.assertEqual(self.client.get('/api/onboarding/').status_code, 200)
        resp = self.client.post('/api/onboarding/', self._payload(self._candidate()), content_type='application/json')
        self.assertEqual(resp.status_code, 403)
        resp = self._transit(ob, 'IN_PROGRESS')
        self.assertEqual(resp.status_code, 403)
        # EMPLOYEE no access
        self.client.logout()
        self.client.force_login(self.emp)
        self.assertEqual(self.client.get('/api/onboarding/').status_code, 403)
        # anonymous denied
        self.client.logout()
        self.assertEqual(self.client.get('/api/onboarding/').status_code, 403)

    def test_one_to_one_no_employee_created(self):
        cand = self._candidate()
        self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
        self.assertEqual(Onboarding.objects.filter(candidate=cand).count(), 1)
        # Phase 1 must not create any Employee automatically
        from apps.personnel.models import Employee
        self.assertFalse(Employee.objects.exists())
