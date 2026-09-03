from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Department, Position
from apps.recruitment.models import Candidate, Job

from .models import Onboarding, OnboardingChecklistItem, OnboardingData, OnboardingDocument
from .services import DEFAULT_CHECKLIST, sync_checklist

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
        ob = Onboarding.objects.create(
            candidate=candidate or self._candidate(),
            status=status,
            created_by=self.admin,
        )
        from .services import create_default_checklist
        create_default_checklist(ob)
        return ob

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

    def _complete_checklist(self, ob):
        for item in ob.checklist_items.all():
            if item.required:
                item.completed = True
                item.completed_at = timezone.now()
                item.completed_by = self.admin
                item.save(update_fields=['completed', 'completed_at', 'completed_by'])

    def _approve_all_docs(self, ob):
        for doc in ob.documents.all():
            doc.status = 'APPROVED'
            doc.reviewed_by = self.admin
            doc.reviewed_at = timezone.now()
            doc.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])

    def _fill_data(self, ob):
        data, _ = OnboardingData.objects.get_or_create(onboarding=ob)
        data.full_name = 'Budi Santoso'
        data.nik = '3273010101010001'
        data.birth_place = 'Jakarta'
        data.birth_date = date(1990, 1, 1)
        data.address = 'Jl. Sudirman 1'
        data.phone = '08123456789'
        data.emergency_contact_name = 'Ibu'
        data.emergency_contact_phone = '081298765432'
        data.bank_account_number = '1234567890'
        data.bank_account_name = 'Budi Santoso'
        data.npwp = '123456789012345'
        data.bpjs_kesehatan = '1234567890'
        data.bpjs_ketenagakerjaan = '1234567890'
        data.department = self.department
        data.position = self.position
        data.join_date = date.today() + timedelta(days=30)
        data.employment_type = 'PKWTT'
        data.save()
        sync_checklist(ob)

    def _upload_docs(self, ob, doc_types):
        with patch('apps.onboarding.views.upload_bytes') as mock_upload, \
             patch('apps.onboarding.views.is_configured', return_value=True):
            mock_upload.return_value = 'stored/path'
            for doc_type in doc_types:
                f = SimpleUploadedFile(
                    f'{doc_type.lower()}.pdf',
                    b'%PDF-1.4 fake content',
                    content_type='application/pdf',
                )
                resp = self.client.post(
                    f'/api/onboarding/{ob.id}/documents/',
                    {'file': f, 'document_type': doc_type},
                    format='multipart',
                )
                self.assertEqual(resp.status_code, 201, doc_type)

    def _make_ready(self, ob):
        self._complete_checklist(ob)
        self._upload_docs(
            ob,
            ['KTP', 'KK', 'NPWP', 'BUKU_REKENING', 'KONTRAK_KERJA'],
        )
        self._approve_all_docs(ob)
        self._fill_data(ob)

    def test_valid_forward_transitions(self):
        ob = self._onboarding()
        for to_status in ('IN_PROGRESS', 'DOCUMENT_REVIEW'):
            resp = self._transit(ob, to_status)
            self.assertEqual(resp.status_code, 200, to_status)
            ob.refresh_from_db()
            self.assertEqual(ob.status, to_status)
        # READY requires complete checklist + approved docs + data
        resp = self._transit(ob, 'READY')
        self.assertEqual(resp.status_code, 400, 'READY without readiness must fail')
        self._make_ready(ob)
        resp = self._transit(ob, 'READY')
        self.assertEqual(resp.status_code, 200, 'READY with readiness must succeed')
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'READY')
        # COMPLETED only via complete action
        resp = self._transit(ob, 'COMPLETED')
        self.assertEqual(resp.status_code, 400, 'COMPLETED via transition must fail')
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 200)
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'COMPLETED')
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
        self._make_ready(ob)
        self._transit(ob, 'READY')
        self.client.post(f'/api/onboarding/{ob.id}/complete/')
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'COMPLETED')
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


# ─── Tahap 2: OnboardingData / Checklist / Documents / Readiness ─────────────

class OnboardingDataTests(OnboardingTests):
    def test_patch_data(self):
        ob = self._onboarding()
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/data/',
            {'full_name': 'Budi Santoso', 'nik': '3273010101010001'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['full_name'], 'Budi Santoso')
        self.assertTrue(OnboardingData.objects.filter(onboarding=ob, nik='3273010101010001').exists())

    def test_read_data_masks_for_mgmt(self):
        ob = self._onboarding()
        data = OnboardingData.objects.create(
            onboarding=ob, full_name='Budi', nik='3273010101010001',
            bank_account_number='1234567890123456',
        )
        self.client.logout()
        self.client.force_login(self.mgmt)
        resp = self.client.get(f'/api/onboarding/{ob.id}/data/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('****', resp.json()['nik'])
        self.assertIn('****', resp.json()['bank_account_number'])

class ChecklistTests(OnboardingTests):
    def test_create_creates_default_checklist(self):
        cand = self._candidate()
        resp = self.client.post('/api/onboarding/', self._payload(cand), content_type='application/json')
        ob = Onboarding.objects.get(candidate=cand)
        self.assertEqual(ob.checklist_items.count(), len(DEFAULT_CHECKLIST))
        self.assertTrue(ob.checklist_items.filter(required=True, code='KTP').exists())

    def test_checklist_list(self):
        ob = self._onboarding()
        resp = self.client.get(f'/api/onboarding/{ob.id}/checklist/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), ob.checklist_items.count())

    def test_complete_checklist_item(self):
        ob = self._onboarding()
        item = ob.checklist_items.first()
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/checklist/{item.id}/',
            {'completed': True, 'notes': 'Done'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['completed'])
        item.refresh_from_db()
        self.assertTrue(item.completed)
        self.assertIsNotNone(item.completed_at)

    def test_sync_checklist_derives_completion_from_data_and_docs(self):
        ob = self._onboarding()
        # Initially nothing complete.
        self.assertFalse(ob.checklist_items.filter(completed=True).exists())

        # Fill biodata -> DATA_BIODATA auto-completes.
        self.client.patch(
            f'/api/onboarding/{ob.id}/data/',
            {'full_name': 'Budi', 'nik': '3273010101010001', 'birth_place': 'Jakarta',
             'birth_date': '1990-01-01', 'address': 'Jl. A', 'phone': '08123456789'},
            content_type='application/json',
        )
        ob.refresh_from_db()
        self.assertTrue(ob.checklist_items.get(code='DATA_BIODATA').completed)
        self.assertFalse(ob.checklist_items.get(code='DATA_FINANSIAL').completed)

        # Upload + approve KTP -> KTP auto-completes.
        with patch('apps.onboarding.views.upload_bytes') as mock_up, \
             patch('apps.onboarding.views.is_configured', return_value=True):
            mock_up.return_value = 'stored/path'
            f = SimpleUploadedFile('ktp.pdf', b'%PDF-1.4', content_type='application/pdf')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
            doc_id = resp.json()['id']
        self.client.patch(
            f'/api/onboarding/{ob.id}/documents/{doc_id}/',
            {'status': 'APPROVED'},
            content_type='application/json',
        )
        ob.refresh_from_db()
        self.assertTrue(ob.checklist_items.get(code='KTP').completed)

        # Reject KTP -> KTP resets.
        self.client.patch(
            f'/api/onboarding/{ob.id}/documents/{doc_id}/',
            {'status': 'REJECTED', 'rejection_reason': 'Blur'},
            content_type='application/json',
        )
        ob.refresh_from_db()
        self.assertFalse(ob.checklist_items.get(code='KTP').completed)
        self.assertEqual(
            ob.documents.get(pk=doc_id).rejection_reason, 'Blur'
        )

    def test_readiness_blocks_without_complete_checklist(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        self._transit(ob, 'DOCUMENT_REVIEW')
        self._fill_data(ob)
        resp = self._transit(ob, 'READY')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('checklist', resp.json()['detail'][0].lower())

class DocumentTests(OnboardingTests):
    def test_upload_and_list(self):
        ob = self._onboarding()
        with patch('apps.onboarding.views.upload_bytes') as mock_up,              patch('apps.onboarding.views.is_configured', return_value=True):
            mock_up.return_value = 'stored/path'
            f = SimpleUploadedFile('ktp.pdf', b'%PDF-1.4 fake', content_type='application/pdf')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['document_type'], 'KTP')
        self.assertEqual(resp.json()['status'], 'PENDING')
        self.assertEqual(ob.documents.count(), 1)

        # list
        resp = self.client.get(f'/api/onboarding/{ob.id}/documents/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)
        # storage_path not exposed
        self.assertNotIn('storage_path', resp.json()[0])

    def test_upload_rejects_bad_type(self):
        ob = self._onboarding()
        with patch('apps.onboarding.views.is_configured', return_value=True):
            f = SimpleUploadedFile('bad.exe', b'fake exe', content_type='application/x-msdownload')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
        self.assertEqual(resp.status_code, 400)

    def test_upload_rejects_oversized(self):
        ob = self._onboarding()
        with patch('apps.onboarding.views.is_configured', return_value=True):
            f = SimpleUploadedFile('big.pdf', b'x' * (11 * 1024 * 1024), content_type='application/pdf')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
        self.assertEqual(resp.status_code, 400)

    def test_review_document(self):
        ob = self._onboarding()
        with patch('apps.onboarding.views.upload_bytes') as mock_up,              patch('apps.onboarding.views.is_configured', return_value=True):
            mock_up.return_value = 'stored/path'
            f = SimpleUploadedFile('ktp.pdf', b'%PDF-1.4', content_type='application/pdf')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
        doc_id = resp.json()['id']
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/documents/{doc_id}/',
            {'status': 'APPROVED', 'notes': 'OK'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'APPROVED')
        self.assertIsNotNone(resp.json()['reviewed_by'])

    def test_delete_document(self):
        ob = self._onboarding()
        with patch('apps.onboarding.views.upload_bytes') as mock_up,              patch('apps.onboarding.views.is_configured', return_value=True),              patch('apps.onboarding.views.delete_object') as mock_del:
            mock_up.return_value = 'stored/path'
            f = SimpleUploadedFile('ktp.pdf', b'%PDF-1.4', content_type='application/pdf')
            resp = self.client.post(
                f'/api/onboarding/{ob.id}/documents/',
                {'file': f, 'document_type': 'KTP'},
                format='multipart',
            )
            doc_id = resp.json()['id']
            resp = self.client.delete(f'/api/onboarding/{ob.id}/documents/{doc_id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(ob.documents.count(), 0)
        mock_del.assert_called_once()

class ReadinessTests(OnboardingTests):
    def test_readiness_endpoint(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        self._transit(ob, 'DOCUMENT_REVIEW')
        resp = self.client.get(f'/api/onboarding/{ob.id}/readiness/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['ready'])
        self.assertGreater(len(resp.json()['errors']), 0)

        self._make_ready(ob)
        resp = self.client.get(f'/api/onboarding/{ob.id}/readiness/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['errors']), 0)
        self.assertTrue(resp.json()['ready'])

    def test_readiness_tracks_progress(self):
        ob = self._onboarding()
        total = ob.checklist_items.count()
        resp = self.client.get(f'/api/onboarding/{ob.id}/readiness/')
        self.assertEqual(resp.json()['progress'], 0)
        # satisfy one checklist item via its underlying data (auto-synced)
        data, _ = OnboardingData.objects.get_or_create(onboarding=ob)
        data.full_name = 'Budi Santoso'
        data.nik = '3273010101010001'
        data.birth_place = 'Jakarta'
        data.birth_date = date(1990, 1, 1)
        data.address = 'Jl. Sudirman 1'
        data.phone = '08123456789'
        data.save()
        sync_checklist(ob)
        resp = self.client.get(f'/api/onboarding/{ob.id}/readiness/')
        expected = round(1 / total * 100)
        self.assertEqual(resp.json()['progress'], expected)

# ─── Tahap 3: Complete Onboarding ────────────────────────────────────

class CompleteOnboardingTests(OnboardingTests):
    def _make_ready_ob(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        self._transit(ob, 'DOCUMENT_REVIEW')
        self._make_ready(ob)
        self._transit(ob, 'READY')
        ob.refresh_from_db()
        return ob

    def test_complete_creates_employee_contract_account(self):
        ob = self._make_ready_ob()
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'COMPLETED')
        self.assertIsNotNone(data['employee_id'])
        self.assertIsNotNone(data['employee_name'])
        self.assertEqual(data['employee_status'], 'ACTIVE')
        self.assertEqual(data['account_status'], 'ACTIVE')

        from apps.personnel.models import Employee, EmployeeContract
        from apps.accounts.models import User
        self.assertTrue(Employee.objects.filter(employee_id=data['employee_id']).exists())
        emp = Employee.objects.get(employee_id=data['employee_id'])
        self.assertTrue(EmployeeContract.objects.filter(employee=emp).exists())
        self.assertIsNotNone(emp.user)
        self.assertEqual(emp.user.role.key, 'EMPLOYEE')
        # password not exposed
        self.assertNotIn('password', data)

    def test_complete_requires_ready(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 400)

    def test_complete_fails_without_readiness(self):
        ob = self._onboarding()
        self._transit(ob, 'IN_PROGRESS')
        self._transit(ob, 'DOCUMENT_REVIEW')
        self._transit(ob, 'READY')
        ob.refresh_from_db()
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 400)

    def test_complete_idempotent(self):
        ob = self._make_ready_ob()
        resp1 = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp1.status_code, 200)
        emp_id = resp1.json()['employee_id']
        from apps.personnel.models import Employee
        count_before = Employee.objects.count()
        resp2 = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()['employee_id'], emp_id)
        self.assertEqual(Employee.objects.count(), count_before)

    def test_complete_rbac(self):
        ob = self._make_ready_ob()
        # MANAGEMENT cannot complete
        self.client.logout()
        self.client.force_login(self.mgmt)
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 403)
        # EMPLOYEE cannot complete
        self.client.logout()
        self.client.force_login(self.emp)
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 403)
        # HR can complete
        self.client.logout()
        self.client.force_login(self.hr)
        resp = self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertEqual(resp.status_code, 200)

    def test_patch_status_completed_blocked(self):
        ob = self._make_ready_ob()
        resp = self.client.patch(
            f'/api/onboarding/{ob.id}/',
            {'status': 'COMPLETED'},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'READY')

    def test_transition_to_completed_blocked(self):
        ob = self._make_ready_ob()
        resp = self._transit(ob, 'COMPLETED')
        self.assertEqual(resp.status_code, 400)
        ob.refresh_from_db()
        self.assertEqual(ob.status, 'READY')

    def test_complete_audit_logged(self):
        ob = self._make_ready_ob()
        self.client.post(f'/api/onboarding/{ob.id}/complete/')
        self.assertTrue(
            AuditLog.objects.filter(action='create', description__icontains='Employee created').exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(action='create', description__icontains='Contract').exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(action='create', description__icontains='User account').exists()
        )

    def test_completed_exposes_employee_info(self):
        ob = self._make_ready_ob()
        self.client.post(f'/api/onboarding/{ob.id}/complete/')
        ob.refresh_from_db()
        resp = self.client.get(f'/api/onboarding/{ob.id}/')
        data = resp.json()
        self.assertEqual(data['status'], 'COMPLETED')
        self.assertIsNotNone(data['employee_id'])
        self.assertIsNotNone(data['completed_by_name'])
        self.assertEqual(data['account_status'], 'ACTIVE')
