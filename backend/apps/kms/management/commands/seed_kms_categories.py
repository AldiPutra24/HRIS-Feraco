"""Seed default KMS categories (idempotent) + demo article.

Run: python manage.py seed_kms_categories
"""
from django.core.management.base import BaseCommand

from apps.kms.models import KnowledgeCategory


ROOTS = [
    ('HRIS', 'Panduan penggunaan modul HRIS untuk seluruh karyawan.', [
        ('Employee', 'Data karyawan, kontrak, profil.'),
        ('Leave', 'Izin & cuti: pengajuan sampai approval.'),
        ('Payroll', 'Payroll processing, payslip, pajak.'),
        ('Reimbursement', 'Klaim reimbursement karyawan.'),
        ('Recruitment & Onboarding', 'Lowongan, kandidat, onboarding.'),
        ('Freelance & Event', 'Talent pool, event, task freelance.'),
    ]),
    ('Internal', 'Dokumen internal FERACO.', [
        ('SOP', 'Prosedur operasional standar.'),
        ('Kebijakan', 'Kebijakan perusahaan.'),
        ('Pengumuman', 'Pengumuman & sounding internal.'),
        ('Panduan Kerja', 'Panduan kerja harian.'),
        ('FAQ', 'Pertanyaan yang sering diajukan.'),
    ]),
]


class Command(BaseCommand):
    help = 'Seed default KMS categories + subcategories (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--with-demo-article', action='store_true',
                            help='Create one published demo article (draft-free).')

    def handle(self, *args, **options):
        created = 0
        for root_name, root_desc, subs in ROOTS:
            root, root_created = KnowledgeCategory.objects.get_or_create(
                parent=None, name=root_name,
                defaults={'description': root_desc},
            )
            if root_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f'Kategori: {root_name}'))
            for sub_name, sub_desc in subs:
                _, sub_created = KnowledgeCategory.objects.get_or_create(
                    parent=root, name=sub_name,
                    defaults={'description': sub_desc},
                )
                if sub_created:
                    created += 1
                    self.stdout.write(f'  Subkategori: {sub_name}')
        self.stdout.write(self.style.SUCCESS(f'Selesai. {created} kategori dibuat.'))
        if options['with_demo_article']:
            from django.contrib.auth import get_user_model

            from apps.kms.models import KnowledgeArticle, STATUS_PUBLISHED

            User = get_user_model()
            author = User.objects.filter(role__key='ADMIN').first()
            hris = KnowledgeCategory.objects.get(parent=None, name='HRIS')
            leave = KnowledgeCategory.objects.get(parent=hris, name='Leave')
            article, a_created = KnowledgeArticle.objects.get_or_create(
                title='Cara Mengajukan Izin & Cuti di HRIS',
                defaults={
                    'summary': 'Langkah-langkah mengajukan izin/cuti melalui portal karyawan HRIS Feraco.',
                    'content': (
                        '<h2>Langkah Pengajuan</h2>'
                        '<ol><li>Login ke HRIS Feraco.</li>'
                        '<li>Buka menu <strong>Izin &amp; Cuti</strong> pada dashboard karyawan.</li>'
                        '<li>Klik <em>Ajukan Izin &amp; Cuti</em>, pilih jenis cuti, tanggal, dan alasan.</li>'
                        '<li>Submit — atasan langsung Anda akan menerima notifikasi.</li></ol>'
                        '<p>Status pengajuan dapat dipantau di menu yang sama.</p>'
                    ),
                    'category': hris,
                    'subcategory': leave,
                    'status': STATUS_PUBLISHED,
                    'created_by': author,
                    'updated_by': author,
                },
            )
            if a_created:
                self.stdout.write(self.style.SUCCESS(f'Artikel demo: {article.title}'))
