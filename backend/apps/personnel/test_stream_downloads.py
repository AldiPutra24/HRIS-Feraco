"""Download endpoints that return JSON `{url}` (opened with window.open):
the url points back to the endpoint with `?raw=1`, which streams the file
through the backend — no Supabase signed URL, so names with ',' / '&' no
longer fail with InvalidSignature."""
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.accounts.models import Role
from apps.personnel.models import Department, Position

User = get_user_model()

NAME = 'CV Budi, S.Kom & Portofolio.pdf'
PDF = b'%PDF-1.4 data'


def make_user(key, username):
    role, _ = Role.objects.get_or_create(key=key, defaults={'name': key})
    user = User.objects.create_user(username=username, email=username, password='x')
    user.role = role
    user.save()
    return user


class StreamDownloadTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin.stream@test.com')
        self.client.force_login(self.admin)

    def _check(self, url, configured_patch, expected_name=NAME):
        """JSON link -> `?raw=1` streams the PDF inline with the original name."""
        upstream = mock.Mock()
        upstream.iter_content.return_value = iter([PDF])
        patches = [mock.patch('apps.personnel.storage.open_object', return_value=upstream)]
        if configured_patch:
            patches.append(mock.patch(configured_patch, return_value=True))
        for p in patches:
            p.start()
        try:
            res = self.client.get(url)
            self.assertEqual(res.status_code, 200, getattr(res, 'data', res))
            link = res.json()['url']
            self.assertTrue(link.endswith('?raw=1'), link)
            self.assertNotIn('supabase', link)
            res = self.client.get(link)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(b''.join(res.streaming_content), PDF)
            self.assertEqual(res['Content-Type'], 'application/pdf')
            self.assertIn("filename*=UTF-8''CV%20Budi%2C%20S.Kom%20%26%20Portofolio.pdf", res['Content-Disposition'])
        finally:
            for p in patches:
                p.stop()
        return upstream

    def test_storage_error_returns_502(self):
        from apps.freelance.models import Freelancer, FreelancerDocument

        f = Freelancer.objects.create(full_name='Budi', whatsapp='0812', domicile='Jakarta')
        doc = FreelancerDocument.objects.create(freelancer=f, doc_type='CV', name=NAME, storage_path=f'freelancers/{f.id}/{NAME}')
        url = f'/api/freelance/freelancers/{f.id}/documents/{doc.id}/download/?raw=1'
        with mock.patch('apps.freelance.views.is_configured', return_value=True), \
             mock.patch('apps.personnel.storage.open_object', side_effect=RuntimeError('Storage download failed (404)')):
            res = self.client.get(url)
        self.assertEqual(res.status_code, 502)

    def test_freelancer_document(self):
        from apps.freelance.models import Freelancer, FreelancerDocument

        f = Freelancer.objects.create(full_name='Budi', whatsapp='0812', domicile='Jakarta')
        doc = FreelancerDocument.objects.create(freelancer=f, doc_type='CV', name=NAME, storage_path=f'freelancers/{f.id}/{NAME}')
        url = f'/api/freelance/freelancers/{f.id}/documents/{doc.id}/download/'
        upstream = self._check(url, 'apps.freelance.views.is_configured')
        upstream.close.assert_called()

    def test_candidate_cv(self):
        from apps.recruitment.models import Candidate, Job

        dept = Department.objects.create(name='Eng')
        pos = Position.objects.create(name='Dev', department=dept)
        job = Job.objects.create(title='Dev', slug='dev', department=dept, position=pos, employment_type='FULL_TIME',
                                 location='Jakarta', open_date=date.today(), status='OPEN')
        c = Candidate.objects.create(job=job, full_name='Budi', email='budi@test.com', cv_name=NAME,
                                     cv_path=f'candidates/1/{NAME}')
        self._check(f'/api/recruitment/candidates/{c.id}/cv/', 'apps.recruitment.views.is_configured')

    def test_onboarding_document(self):
        from apps.onboarding.models import Onboarding, OnboardingDocument
        from apps.recruitment.models import Candidate, Job

        dept = Department.objects.create(name='Eng')
        pos = Position.objects.create(name='Dev', department=dept)
        job = Job.objects.create(title='Dev', slug='dev', department=dept, position=pos, employment_type='FULL_TIME',
                                 location='Jakarta', open_date=date.today(), status='OPEN')
        cand = Candidate.objects.create(job=job, full_name='Budi', email='budi@test.com', status='HIRED')
        ob = Onboarding.objects.create(candidate=cand, created_by=self.admin)
        doc = OnboardingDocument.objects.create(onboarding=ob, document_type='KTP', original_filename=NAME,
                                                storage_path=f'onboarding/{ob.id}/{NAME}')
        self._check(f'/api/onboarding/{ob.id}/documents/{doc.id}/download/', 'apps.onboarding.views.is_configured')

    def test_kms_attachment(self):
        from apps.kms.models import KnowledgeArticle, KnowledgeCategory

        cat = KnowledgeCategory.objects.create(name='HRIS')
        art = KnowledgeArticle.objects.create(title='Panduan', summary='s', content='<p>x</p>', category=cat,
                                              status='PUBLISHED', created_by=self.admin,
                                              attachment_name=NAME, attachment_path=f'kms/1/{NAME}')
        self._check(f'/api/kms/articles/{art.id}/attachment-url/', None)
