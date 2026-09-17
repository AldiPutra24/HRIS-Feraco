"""KMS test suite.

Covers the spec's minimum matrix:
- AUTH: unauthenticated blocked; every authenticated role can GET.
- PERMISSION: hr_staff/hr_lead/admin CRUD; employee/management read-only.
- CATEGORY: create root + subcategory, edit, deactivate, invalid parent /
  self-parent rejected, delete-in-use guarded.
- KNOWLEDGE: create draft, publish, edit, archive/restore/delete, filtering
  (category implies subcategories), search, visibility (draft hidden from
  read-only roles), related.
- SECURITY: HTML content sanitized on save; attachment upload/sign URL.
"""
import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from apps.accounts.models import Role
from apps.notifications.sanitize import sanitize_html
from apps.personnel.storage import delete_object, signed_url, upload_bytes

from .models import KnowledgeArticle, KnowledgeCategory
from .storage import bucket

User = get_user_model()

CATEGORIES_URL = '/api/kms/categories/'
ARTICLES_URL = '/api/kms/articles/'


def make_user(username, role_key):
    role, _ = Role.objects.get_or_create(key=role_key, defaults={'name': role_key})
    user = User.objects.create_user(username=username, email=username, password='pass')
    user.role = role
    user.save()
    return user


def body(data):
    return json.dumps(data), 'application/json'


class BaseKmsTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.hr = make_user('hr@t', 'HR_STAFF')
        self.lead = make_user('lead@t', 'HR_LEAD')
        self.admin = make_user('admin@t', 'ADMIN')
        self.emp = make_user('emp@t', 'EMPLOYEE')
        self.mgmt = make_user('mgmt@t', 'MANAGEMENT')
        self.cat = KnowledgeCategory.objects.create(name='HRIS')
        self.sub = KnowledgeCategory.objects.create(name='Leave', parent=self.cat)


class KmsAuthMatrixTests(BaseKmsTests):
    def test_unauthenticated_blocked(self):
        res = self.client.get(CATEGORIES_URL)
        self.assertIn(res.status_code, (401, 403))
        res = self.client.get(ARTICLES_URL)
        self.assertIn(res.status_code, (401, 403))

    def test_all_roles_can_read(self):
        for user in (self.hr, self.lead, self.admin, self.emp, self.mgmt):
            self.client.force_login(user)
            for url in (CATEGORIES_URL, f'{CATEGORIES_URL}tree/', ARTICLES_URL):
                res = self.client.get(url)
                self.assertEqual(res.status_code, 200, f'{user} {url}')


class KmsPermissionTests(BaseKmsTests):
    def test_hr_roles_and_admin_can_write(self):
        for user in (self.hr, self.lead, self.admin):
            self.client.force_login(user)
            res = self.client.post(CATEGORIES_URL, *body({'name': f'Kat-{user.username}'}))
            self.assertEqual(res.status_code, 201, user.username)
            res = self.client.post(ARTICLES_URL, *body({
                'title': f'Draft {user.username}', 'summary': 's',
                'content': '<p>isi</p>', 'category': self.cat.id, 'status': 'DRAFT',
            }))
            self.assertEqual(res.status_code, 201, user.username)

    def test_employee_and_management_read_only(self):
        KnowledgeArticle.objects.create(
            title='Publik', summary='s', content='<p>x</p>',
            category=self.cat, status='PUBLISHED',
        )
        for user in (self.emp, self.mgmt):
            self.client.force_login(user)
            res = self.client.post(CATEGORIES_URL, *body({'name': 'Ilegal'}))
            self.assertEqual(res.status_code, 403, user.username)
            res = self.client.post(ARTICLES_URL, *body({
                'title': 'Ilegal', 'content': '<p>x</p>', 'category': self.cat.id,
            }))
            self.assertEqual(res.status_code, 403, user.username)
            art = KnowledgeArticle.objects.filter(title='Publik').first()
            res = self.client.patch(f'{ARTICLES_URL}{art.id}/', *body({'title': 'X'}))
            self.assertEqual(res.status_code, 403)
            res = self.client.delete(f'{ARTICLES_URL}{art.id}/')
            self.assertEqual(res.status_code, 403)


class KmsCategoryTests(BaseKmsTests):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.hr)

    def test_create_edit_deactivate(self):
        res = self.client.post(CATEGORIES_URL, *body({
            'name': 'Internal', 'description': 'dokumen internal',
        }))
        self.assertEqual(res.status_code, 201)
        cat_id = res.data['id']
        res = self.client.patch(f'{CATEGORIES_URL}{cat_id}/', *body({'name': 'Internal FERACO'}))
        self.assertEqual(res.status_code, 200)
        res = self.client.patch(f'{CATEGORIES_URL}{cat_id}/', *body({'is_active': False}))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_active'])

    def test_create_subcategory(self):
        res = self.client.post(CATEGORIES_URL, *body({'name': 'Payroll', 'parent': self.cat.id}))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['parent'], self.cat.id)

    def test_invalid_parent_rejected(self):
        # Parent must be a ROOT category (depth <= 2).
        res = self.client.post(CATEGORIES_URL, *body({'name': 'X', 'parent': self.sub.id}))
        self.assertEqual(res.status_code, 400)
        # Self-parent.
        res = self.client.patch(f'{CATEGORIES_URL}{self.cat.id}/', *body({'parent': self.cat.id}))
        self.assertEqual(res.status_code, 400)
        # Root with children cannot become a subcategory.
        res = self.client.patch(f'{CATEGORIES_URL}{self.cat.id}/', *body({'parent': self.sub.id}))
        self.assertEqual(res.status_code, 400)

    def test_duplicate_name_same_level_rejected(self):
        res = self.client.post(CATEGORIES_URL, *body({'name': 'hris'}))
        self.assertEqual(res.status_code, 400)
        res = self.client.post(CATEGORIES_URL, *body({'name': 'Leave', 'parent': self.cat.id}))
        self.assertEqual(res.status_code, 400)  # duplicate under same parent

    def test_delete_in_use_guarded(self):
        # Root with children cannot be deleted.
        res = self.client.delete(f'{CATEGORIES_URL}{self.cat.id}/')
        self.assertEqual(res.status_code, 400)
        # Root with articles cannot be deleted.
        KnowledgeArticle.objects.create(
            title='A', summary='s', content='<p>c</p>', category=self.cat, status='PUBLISHED',
        )
        res = self.client.delete(f'{CATEGORIES_URL}{self.cat.id}/')
        self.assertEqual(res.status_code, 400)
        # Subcategory carrying an article -> deactivated, never hard-deleted.
        KnowledgeArticle.objects.create(
            title='B', summary='s', content='<p>c</p>',
            category=self.cat, subcategory=self.sub, status='PUBLISHED',
        )
        res = self.client.delete(f'{CATEGORIES_URL}{self.sub.id}/')
        self.assertIn(res.status_code, (200, 204))
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.is_active)
        self.assertTrue(KnowledgeCategory.objects.filter(pk=self.sub.pk).exists())

    def test_delete_unused_root_ok(self):
        res = self.client.post(CATEGORIES_URL, *body({'name': 'Lainnya'}))
        unused = res.data['id']
        res = self.client.delete(f'{CATEGORIES_URL}{unused}/')
        self.assertIn(res.status_code, (200, 204))
        self.assertFalse(KnowledgeCategory.objects.filter(pk=unused).exists())

    def test_tree_groups_children(self):
        KnowledgeCategory.objects.create(name='Employee', parent=self.cat)
        res = self.client.get(f'{CATEGORIES_URL}tree/')
        self.assertEqual(res.status_code, 200)
        hris = next(n for n in res.data if n['name'] == 'HRIS')
        names = [c['name'] for c in hris['children']]
        self.assertIn('Leave', names)
        self.assertIn('Employee', names)


class KmsArticleTests(BaseKmsTests):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.hr)

    def _create(self, **over):
        payload = {
            'title': 'Panduan Cuti', 'summary': 'Ringkasan singkat.',
            'content': '<p>Langkah-langkah <strong>pengajuan cuti</strong>.</p>',
            'category': self.cat.id, 'subcategory': self.sub.id, 'status': 'DRAFT',
        }
        payload.update(over)
        res = self.client.post(ARTICLES_URL, *body(payload))
        self.assertEqual(res.status_code, 201, res.data)
        return res.data

    def test_create_draft_hidden_from_read_only_roles(self):
        art = self._create()
        self.client.force_login(self.emp)
        res = self.client.get(ARTICLES_URL)
        self.assertEqual([a['id'] for a in res.data['results']], [])
        res = self.client.get(f"{ARTICLES_URL}{art['id']}/")
        self.assertEqual(res.status_code, 404)

    def test_publish_then_visible_to_employee(self):
        art = self._create()
        res = self.client.patch(f"{ARTICLES_URL}{art['id']}/", *body({'status': 'PUBLISHED'}))
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data['published_at'])
        self.client.force_login(self.emp)
        res = self.client.get(ARTICLES_URL)
        self.assertIn(art['id'], [a['id'] for a in res.data['results']])
        res = self.client.get(f"{ARTICLES_URL}{art['id']}/")
        self.assertEqual(res.status_code, 200)

    def test_subcategory_must_belong_to_category(self):
        other_root = KnowledgeCategory.objects.create(name='Internal')
        res = self.client.post(ARTICLES_URL, *body({
            'title': 'X', 'summary': '', 'content': '<p>x</p>',
            'category': other_root.id, 'subcategory': self.sub.id,
        }))
        self.assertEqual(res.status_code, 400)
        # Category itself must be a root.
        res = self.client.post(ARTICLES_URL, *body({
            'title': 'X', 'summary': '', 'content': '<p>x</p>',
            'category': self.sub.id,
        }))
        self.assertEqual(res.status_code, 400)

    def test_filtering_category_implies_subcategories(self):
        a1 = self._create(title='Di sub', status='PUBLISHED')
        a2 = self._create(title='Di root', subcategory=None, status='PUBLISHED')
        self.client.force_login(self.emp)
        res = self.client.get(ARTICLES_URL, {'category': self.cat.id})
        ids = {a['id'] for a in res.data['results']}
        self.assertIn(a1['id'], ids)
        self.assertIn(a2['id'], ids)
        res = self.client.get(ARTICLES_URL, {'subcategory': self.sub.id})
        self.assertEqual([a['id'] for a in res.data['results']], [a1['id']])

    def test_search_title_summary_content_and_category(self):
        self._create(title='Kontrak PKWT', summary=' Tentang perpanjangan kontrak. ', status='PUBLISHED')
        self._create(title='Reimbursement', content='<p>klaim pengobatan</p>', status='PUBLISHED')
        self.client.force_login(self.emp)
        for q in ('PKWT', 'perpanjangan', 'pengobatan', 'HRIS'):
            res = self.client.get(ARTICLES_URL, {'search': q})
            self.assertGreaterEqual(res.data['count'], 1, q)

    def test_status_filter_manager_only(self):
        self._create(title='Draft satu')
        res = self.client.get(ARTICLES_URL, {'status': 'DRAFT'})
        self.assertEqual(res.data['count'], 1)
        self.client.force_login(self.emp)
        res = self.client.get(ARTICLES_URL, {'status': 'DRAFT'})
        self.assertEqual(res.data['count'], 0)

    def test_archive_restore_and_listing_behavior(self):
        art = self._create(title='SOP lama', status='PUBLISHED')
        res = self.client.post(f"{ARTICLES_URL}{art['id']}/archive/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'ARCHIVED')
        self.client.force_login(self.emp)
        res = self.client.get(ARTICLES_URL)
        self.assertEqual(res.data['count'], 0)
        res = self.client.get(f"{ARTICLES_URL}{art['id']}/")
        self.assertEqual(res.status_code, 404)  # non-manager detail hidden
        self.client.force_login(self.hr)
        res = self.client.get(ARTICLES_URL)  # default listing hides archived
        self.assertEqual(res.data['count'], 0)
        res = self.client.get(ARTICLES_URL, {'status': 'ARCHIVED'})
        self.assertEqual(res.data['count'], 1)
        res = self.client.post(f"{ARTICLES_URL}{art['id']}/restore/")
        self.assertEqual(res.data['status'], 'DRAFT')

    def test_hard_delete_removes(self):
        art = self._create(title='Boleh dihapus')
        res = self.client.delete(f"{ARTICLES_URL}{art['id']}/")
        self.assertIn(res.status_code, (200, 204))
        self.assertFalse(KnowledgeArticle.objects.filter(pk=art['id']).exists())

    def test_related_same_category(self):
        a1 = self._create(title='Satu', status='PUBLISHED')
        a2 = self._create(title='Dua', status='PUBLISHED')
        a3 = self._create(title='Tiga', status='PUBLISHED', subcategory=None)
        self.client.force_login(self.emp)
        res = self.client.get(f"{ARTICLES_URL}{a1['id']}/related/")
        ids = [a['id'] for a in res.data]
        self.assertIn(a2['id'], ids)
        self.assertIn(a3['id'], ids)

    def test_content_sanitized_on_save(self):
        self._create(title='XSS', content=(
            '<p>ok</p><script>alert(1)</script>'
            '<p onclick="x()" style="position: fixed">X</p>'
            '<a href="javascript:alert(1)">bad</a>'
        ))
        art = KnowledgeArticle.objects.get(title='XSS')
        c = art.content
        self.assertNotIn('script', c.lower())
        self.assertNotIn('onclick', c.lower())
        self.assertNotIn('javascript:', c.lower())
        self.assertNotIn('position', c.lower())
        self.assertIn('<p>ok</p>', c)

    def test_invalid_status_rejected(self):
        res = self.client.post(ARTICLES_URL, *body({
            'title': 'X', 'summary': '', 'content': '<p>x</p>',
            'category': self.cat.id, 'status': 'WEIRD',
        }))
        self.assertEqual(res.status_code, 400)


@override_settings(SUPABASE_URL='https://supabase.test', SUPABASE_SECRET_KEY='secret')
class KmsAttachmentTests(BaseKmsTests):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.hr)
        self.art = KnowledgeArticle.objects.create(
            title='Dengan lampiran', summary='s', content='<p>x</p>',
            category=self.cat, status='PUBLISHED', created_by=self.hr,
        )
        self.patches = []

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_upload_and_sign_and_delete(self):
        import unittest.mock as mock

        p1 = mock.patch('apps.kms.views.upload_attachment', return_value='kms/1/x.pdf')
        p2 = mock.patch('apps.kms.views.delete_attachment', return_value=True)
        p3 = mock.patch('apps.kms.views.attachment_url',
                        return_value='https://signed.test/x.pdf')
        self.patches = [p1, p2, p3]
        for p in self.patches:
            p.start()
        res = self.client.post(
            f'{ARTICLES_URL}{self.art.id}/attachment/',
            {'file': SimpleUploadedFile('panduan.pdf', b'PDF', 'application/pdf')},
            format='multipart',
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.art.refresh_from_db()
        self.assertEqual(self.art.attachment_name, 'panduan.pdf')
        self.assertTrue(res.data['has_attachment'])
        res = self.client.get(f'{ARTICLES_URL}{self.art.id}/attachment-url/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('https://', res.data['url'])
        res = self.client.delete(f'{ARTICLES_URL}{self.art.id}/')
        self.assertIn(res.status_code, (200, 204))
        self.assertFalse(KnowledgeArticle.objects.filter(pk=self.art.pk).exists())
