from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.audit.models import AuditLog
from apps.personnel.models import Freelancer

from .models import (
    Event,
    EventAssignment,
    FreelancerDocument,
    FreelancerPerformance,
    FreelancerSkill,
    Skill,
    SkillCategory,
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
        # filter by skill
        flt = self.client.get('/api/freelance/freelancers/?skill=Usher')
        self.assertEqual(flt.status_code, 200)
        self.assertEqual(len(flt.json()['results']), 1)


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
