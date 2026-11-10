"""Payroll Excel import: parser + preview (tahap 1) and saving (tahap 2)."""
import io
import json
from datetime import date
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import Workbook, load_workbook

from apps.personnel.models import Employee

from .exports import build_payslip_pdf, build_recap_xlsx
from .models import Payroll, PayrollImport, PayrollImportAlias, PayrollItem, PayrollPeriod
from .tests import make_tax_config, make_user

# Header row exactly as in HR's "Payroll Template.xlsx" (row 3).
HEADERS = [
    'INH/FLC', 'NAMA', 'JABATAN', 'LOKASI KERJA', 'Status PTKP', 'GAPOK (Inhouse)', 'FEE FREELANCE GROSS',
    'Komisi Sales PENAS', 'Komisi Sales + Client Handling GPFE', 'Komisi Sales + Client Handling Inacraft',
    'Komisi Sales + Client Handling KTNA Agro', 'Tunj Lainnya (Fee Event)',
    'Total Penghasilan Bruto (gaji + Fee add jika ada) *digunakan utk lapor PPh21 masa bulan tsb',
    'KATEGORI TER', 'Persentase TER', 'PPH 21 TERUTANG SEBULAN (gross)', 'KET', 'Jumlah Kasbon',
    'SUBMIT PAYROLL\nGapok + Komisi - (Tunj Lain, Pph 21 Non DPT & Kasbon)',
]


def row(kind, name, gapok=None, fee=None, penas=None, gpfe=None, inacraft=None, ktna=None, tunj=None,
        bruto=None, pph=None, kasbon=None, thp=None):
    return [kind, name, 'Staff', 'JAKARTA', None, gapok, fee, penas, gpfe, inacraft, ktna, tunj, bruto,
            '-', None, pph, None, kasbon, thp]


def make_xlsx(rows, headers=HEADERS, extra=None):
    """Template-shaped workbook; cached formula results are written as plain values."""
    wb = Workbook()
    ws = wb.active
    ws.title = 'Template'
    ws['M2'] = 'PENGHASILAN'
    ws.append([])
    ws.append(headers)  # row 3 after the title row 2 below
    ws.delete_rows(1)
    for r in rows:
        ws.append(r)
    ws.append([None] * 16 + ['Total by Menu Payroll', None, 0])
    if extra:
        extra(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class PayrollExcelPreviewTests(TestCase):
    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config(threshold='10000000')
        self.period = PayrollPeriod.objects.create(
            period_month=11, period_year=2026, period_start=date(2026, 11, 1), period_end=date(2026, 11, 30),
        )
        self.galih = Employee.objects.create(employee_id='E010', full_name='Galih Rizky Propandita', employment_status='ACTIVE')
        self.andi = Employee.objects.create(employee_id='E011', full_name='(TEST) Andi Pratama', employment_status='ACTIVE')
        self.siti = Employee.objects.create(employee_id='E012', full_name='Siti Rahmawati', employment_status='ACTIVE')
        self.url = f'/api/payroll/periods/{self.period.id}/import/preview/'

    def post(self, content, name='Payroll Template.xlsx', **data):
        upload = SimpleUploadedFile(name, content)
        return self.client.post(self.url, {'file': upload, **data})

    def test_computes_thp_from_components_not_excel_formula(self):
        content = make_xlsx([
            # Excel's own THP (=SUM(F:J)) skips KTNA, Tunj Lainnya and Kasbon.
            row('INH', 'GALIH RIZKY PROPANDITA', gapok=5_000_000, penas=500_000, ktna=200_000, tunj=300_000,
                bruto=6_000_000, kasbon=100_000, thp=5_500_000),
        ])
        res = self.post(content)
        self.assertEqual(res.status_code, 200, res.data)
        r = res.data['rows'][0]
        self.assertEqual(r['match']['status'], 'auto')
        self.assertEqual(r['match']['employee']['id'], self.galih.id)
        self.assertEqual(r['bruto'], '6000000.00')
        self.assertEqual(r['thp'], '5900000.00')  # 6.000.000 - kasbon 100.000 - PPh 0
        self.assertEqual(r['transfer'], '5900000.00')
        self.assertFalse(r['is_dtp'])
        self.assertEqual(
            [(e['label'], e['category']) for e in r['earnings']],
            [('Gaji Pokok', 'EARNING_FIXED'), ('Komisi Sales PENAS', 'EARNING_VARIABLE'),
             ('Komisi Sales + Client Handling KTNA Agro', 'EARNING_VARIABLE'), ('Tunj Lainnya (Fee Event)', 'EARNING_VARIABLE')],
        )
        self.assertEqual([d['code'] for d in r['deductions']], ['IMP_KASBON'])
        self.assertTrue(any('THP di Excel' in w for w in r['warnings']))
        self.assertTrue(any('PPh 21 kosong' in w for w in r['warnings']))
        self.assertTrue(res.data['summary']['can_import'])
        self.assertFalse(Payroll.objects.exists())  # preview saves nothing

    def test_dtp_uses_bruto_against_threshold(self):
        content = make_xlsx([
            row('INH', 'Galih Rizky Propandita', gapok=8_000_000, pph=100_000, thp=7_900_000),
            row('INH', 'Siti Rahmawati', gapok=12_000_000, pph=300_000, thp=11_700_000),
        ])
        rows = self.post(content).data['rows']
        dtp, non_dtp = rows
        self.assertTrue(dtp['is_dtp'])
        self.assertEqual(dtp['thp'], '7900000.00')
        self.assertEqual(dtp['transfer'], '8000000.00')  # PPh printed, not taken from transfer
        self.assertFalse(non_dtp['is_dtp'])
        self.assertEqual(non_dtp['transfer'], '11700000.00')
        self.assertEqual(non_dtp['deductions'][0]['code'], 'PPh21')

    def test_name_matching_ignores_brackets_and_suggests_close_names(self):
        content = make_xlsx([
            row('INH', 'Andi Pratama', gapok=4_000_000),
            row('INH', 'Siti Rahmawatii', gapok=4_000_000),
        ])
        andi, siti = self.post(content).data['rows']
        self.assertEqual(andi['match']['employee']['id'], self.andi.id)
        self.assertEqual(siti['match']['status'], 'needs_mapping')
        self.assertEqual(siti['match']['suggestions'][0]['id'], self.siti.id)
        self.assertFalse(self.post(content).data['summary']['can_import'])

        mapped = self.post(content, mappings=f'{{"Siti Rahmawatii": {self.siti.id}}}').data
        self.assertEqual(mapped['rows'][1]['match']['status'], 'mapped')
        self.assertTrue(mapped['summary']['can_import'])

    def test_same_employee_on_two_rows_is_an_error(self):
        content = make_xlsx([
            row('INH', 'Siti Rahmawati', gapok=4_000_000),
            row('INH', 'Siti R', gapok=4_000_000),
        ])
        data = self.post(content, mappings=f'{{"Siti R": {self.siti.id}}}').data
        self.assertTrue(all(any('dipasangkan ke baris' in e for e in r['errors']) for r in data['rows']))
        self.assertFalse(data['summary']['can_import'])

    def test_freelance_rows_are_reported_and_skipped(self):
        content = make_xlsx([
            row('INH', 'Siti Rahmawati', gapok=4_000_000),
            row('FLC', 'Budi Freelance', fee=2_000_000, bruto=2_000_000, pph=50_000, thp=1_950_000),
        ])
        data = self.post(content).data
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(data['freelance_skipped']['count'], 1)
        self.assertEqual(data['freelance_skipped']['total_fee'], '2000000.00')

    def test_columns_found_by_header_and_unknown_numeric_column_warned(self):
        headers = HEADERS[:7] + ['Bonus Tahunan'] + HEADERS[7:]
        r = row('INH', 'Siti Rahmawati', gapok=4_000_000, kasbon=50_000)
        content = make_xlsx([r[:7] + [999_000] + r[7:]], headers=headers)
        data = self.post(content).data
        self.assertEqual(data['rows'][0]['thp'], '3950000.00')
        self.assertTrue(any('Bonus Tahunan' in w for w in data['warnings']))

    def test_text_amount_and_negative_thp_block_import(self):
        content = make_xlsx([row('INH', 'Siti Rahmawati', gapok='lima juta'), row('INH', 'Galih Rizky Propandita', gapok=100, kasbon=500)])
        data = self.post(content).data
        self.assertTrue(any('bukan angka' in e for e in data['rows'][0]['errors']))
        self.assertTrue(any('THP minus' in e for e in data['rows'][1]['errors']))
        self.assertFalse(data['summary']['can_import'])

    def test_formula_without_saved_value_is_rejected(self):
        content = make_xlsx(
            [row('INH', 'Siti Rahmawati', gapok=4_000_000)],
            extra=lambda ws: ws.cell(4, 16, '=M4*O4'),  # first data row: PPh 21 formula never calculated
        )
        res = self.post(content)
        self.assertEqual(res.status_code, 400)
        self.assertIn('Nilai rumus belum tersimpan', res.data['detail'])

    def test_missing_header_and_non_xlsx_rejected(self):
        self.assertEqual(self.post(b'not a workbook').status_code, 400)
        self.assertEqual(self.post(make_xlsx([]), name='payroll.csv').status_code, 400)
        res = self.post(make_xlsx([['INH', 'X']], headers=['INH/FLC', 'NAMA']))
        self.assertEqual(res.status_code, 400)
        self.assertIn('GAPOK', res.data['detail'])

    def test_only_editable_periods_and_payroll_admins(self):
        content = make_xlsx([row('INH', 'Siti Rahmawati', gapok=4_000_000)])
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.LOCKED)
        self.assertEqual(self.post(content).status_code, 400)
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.DRAFT)
        self.client.force_login(make_user('GENERAL_MANAGER', 'gm@test.com'))
        self.assertEqual(self.post(content).status_code, 403)


class PayrollExcelImportTests(TestCase):
    """POST /periods/{id}/import/ writes the period; engine and slip keep working."""

    def setUp(self):
        self.admin = make_user('ADMIN', 'admin@test.com')
        self.client.force_login(self.admin)
        make_tax_config(threshold='10000000')
        self.period = PayrollPeriod.objects.create(
            period_month=11, period_year=2026, period_start=date(2026, 11, 1), period_end=date(2026, 11, 30),
        )
        self.galih = Employee.objects.create(employee_id='E010', full_name='Galih Rizky Propandita', employment_status='ACTIVE')
        self.siti = Employee.objects.create(employee_id='E012', full_name='Siti Rahmawati', employment_status='ACTIVE')
        self.content = make_xlsx([
            row('INH', 'Galih Rizky Propandita', gapok=5_000_000, penas=500_000, ktna=200_000, tunj=300_000,
                kasbon=100_000, pph=60_000),
            row('INH', 'Siti Rahmawatii', gapok=12_000_000, pph=300_000),
            row('FLC', 'Budi Freelance', fee=2_000_000, pph=50_000),
        ])
        self.mappings = json.dumps({'Siti Rahmawatii': self.siti.id})

    def url(self, suffix='import/'):
        return f'/api/payroll/periods/{self.period.id}/{suffix}'

    def do_import(self, content=None, **data):
        upload = SimpleUploadedFile('Payroll Nov.xlsx', content or self.content)
        return self.client.post(self.url(), {'file': upload, 'mappings': self.mappings, **data})

    def test_import_creates_payrolls_items_and_marks_period(self):
        res = self.do_import()
        self.assertEqual(res.status_code, 200, res.data)
        self.period.refresh_from_db()
        self.assertEqual(self.period.source, PayrollPeriod.Source.IMPORT)
        self.assertEqual(self.period.status, PayrollPeriod.Status.CALCULATED)
        self.assertEqual(res.data['period']['last_import']['row_count'], 2)
        self.assertEqual(res.data['period']['last_import']['skipped_freelance'], 1)

        galih = Payroll.objects.get(period=self.period, employee=self.galih)
        self.assertEqual(galih.basic_salary, Decimal('5000000'))
        self.assertEqual(galih.total_variable_earning, Decimal('1000000'))
        self.assertEqual(galih.gross_salary, Decimal('6000000'))
        self.assertEqual(galih.total_deduction, Decimal('160000'))
        self.assertEqual(galih.net_salary, Decimal('5840000'))
        self.assertTrue(galih.is_dtp)  # bruto 6 jt <= 10 jt
        self.assertEqual(galih.transfer_amount, Decimal('5900000'))
        codes = sorted(galih.items.values_list('component_code', flat=True))
        self.assertIn('IMP_GAPOK', codes)
        self.assertIn('IMP_KOMISI_SALES_PENAS', codes)
        self.assertIn('IMP_TUNJ_LAINNYA_FEE_EVENT', codes)
        self.assertIn('PPh21', codes)
        self.assertIn('IMP_KASBON', codes)
        self.assertEqual(len(codes), 6)  # + KTNA
        self.assertTrue(all(i.source == PayrollItem.Source.IMPORT for i in galih.items.all()))

        siti = Payroll.objects.get(period=self.period, employee=self.siti)
        self.assertFalse(siti.is_dtp)
        self.assertEqual(siti.transfer_amount, Decimal('11700000'))
        self.assertEqual(PayrollImport.objects.get().total_transfer, Decimal('17600000'))

    def test_manual_pairing_is_remembered_for_next_import(self):
        self.do_import()
        alias = PayrollImportAlias.objects.get()
        self.assertEqual((alias.normalized_name, alias.employee_id), ('SITI RAHMAWATII', self.siti.id))
        preview = self.client.post(self.url('import/preview/'), {'file': SimpleUploadedFile('n.xlsx', self.content)}).data
        self.assertEqual(preview['rows'][1]['match']['status'], 'mapped')
        self.assertTrue(preview['summary']['can_import'])

    def test_reimport_replaces_rows_and_keeps_status(self):
        self.do_import()
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.REVIEW)
        smaller = make_xlsx([row('INH', 'Galih Rizky Propandita', gapok=4_000_000)])
        res = self.do_import(content=smaller)
        self.assertEqual(res.status_code, 200, res.data)
        self.period.refresh_from_db()
        self.assertEqual(self.period.status, PayrollPeriod.Status.REVIEW)
        self.assertEqual(
            list(Payroll.objects.filter(period=self.period).values_list('employee_id', flat=True)), [self.galih.id],
        )
        self.assertEqual(PayrollImport.objects.count(), 2)

    def test_blocked_rows_return_preview_and_save_nothing(self):
        res = self.do_import(mappings='{}')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.data['preview']['summary']['can_import'])
        self.assertFalse(Payroll.objects.exists())
        self.period.refresh_from_db()
        self.assertEqual((self.period.source, self.period.status), ('ENGINE', 'DRAFT'))

    def test_engine_and_locked_periods_refused(self):
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.CALCULATED)
        res = self.do_import()
        self.assertEqual(res.status_code, 400)
        self.assertIn('dihitung oleh HRIS', res.data['detail'])
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.LOCKED, source='IMPORT')
        self.assertEqual(self.do_import().status_code, 400)

    def test_engine_sync_refused_for_imported_period(self):
        self.do_import()
        self.assertEqual(self.client.post(self.url('recalculate/')).status_code, 400)
        self.assertEqual(Payroll.objects.filter(period=self.period).count(), 2)  # untouched

    def test_manual_item_keeps_imported_earnings_in_totals(self):
        from .models import PayrollComponent

        PayrollComponent.objects.create(name='Bonus', code='BONUS', category='EARNING_VARIABLE', calculation_type='VARIABLE')
        self.do_import()
        galih = Payroll.objects.get(period=self.period, employee=self.galih)
        res = self.client.post(
            f'/api/payroll/payrolls/{galih.id}/manual_item/',
            {'component_code': 'BONUS', 'amount': '250000'},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200, res.data)
        galih.refresh_from_db()
        self.assertEqual(galih.gross_salary, Decimal('6250000'))  # 6 jt imported + 250 rb manual
        self.assertEqual(galih.net_salary, Decimal('6090000'))
        self.assertEqual(galih.transfer_amount, Decimal('6150000'))  # DTP: PPh added back

    def test_payslip_and_recap_built_from_imported_payroll(self):
        from pypdf import PdfReader

        self.do_import()
        PayrollPeriod.objects.filter(pk=self.period.pk).update(status=PayrollPeriod.Status.PAID)  # slips need PAID
        galih = Payroll.objects.get(period=self.period, employee=self.galih)
        pdf = build_payslip_pdf(galih)
        self.assertEqual(pdf['Content-Type'], 'application/pdf')
        text = ' '.join(PdfReader(io.BytesIO(pdf.content)).pages[0].extract_text().split())
        self.assertIn('Komisi Sales PENAS', text)
        self.assertIn('Kasbon', text)
        recap = load_workbook(io.BytesIO(build_recap_xlsx(self.period).content)).active
        self.assertIn(5_900_000, [c.value for c in recap['E']])

    def test_excel_copy_kept_in_storage_when_configured(self):
        with mock.patch('apps.personnel.storage.is_configured', return_value=True), \
                mock.patch('apps.personnel.storage.upload_bytes') as up:
            res = self.do_import()
        self.assertTrue(res.data['file_saved'])
        bucket, path = up.call_args.args[:2]
        self.assertEqual(bucket, 'employee-documents')
        self.assertTrue(path.startswith('payroll-imports/2026-11/'))
        self.assertEqual(PayrollImport.objects.get().storage_path, path)

    def test_storage_failure_does_not_block_import(self):
        with mock.patch('apps.personnel.storage.is_configured', return_value=True), \
                mock.patch('apps.personnel.storage.upload_bytes', side_effect=RuntimeError('down')):
            res = self.do_import()
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['file_saved'])
