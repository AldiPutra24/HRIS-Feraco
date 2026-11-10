"""Read HR's monthly payroll spreadsheet ("Payroll Template.xlsx") as-is.

HR computes payroll in Excel; HRIS takes the inputs from that file and applies
the agreed formula (docs/payroll-import-technical-plan.md, section 2):

    bruto    = Gapok + every Komisi column + Tunj Lainnya
    THP      = bruto - Kasbon - PPh 21          (PPh 21 taken from the file)
    transfer = THP (+ PPh 21 when DTP: PPh > 0 and bruto <= DTP threshold)

The file's own "SUBMIT PAYROLL" (THP) and "Total Penghasilan Bruto" columns
are only compared, never trusted. Columns are recognised by their header text,
not their letter, so HR may insert columns. Employees are matched by name
(the file has no employee ID). Freelancer (FLC) rows are reported and skipped
(phase 2). build_preview() saves nothing; apply_import() writes the period.
"""
import difflib
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import transaction
from openpyxl import load_workbook

from apps.personnel.models import Employee

from .models import (
    Payroll,
    PayrollComponent,
    PayrollImport,
    PayrollImportAlias,
    PayrollItem,
    PayrollPeriod,
    TaxConfig,
)

ZERO = Decimal('0')
DEFAULT_DTP_THRESHOLD = Decimal('10000000')
MAX_ROWS = 2000

EARNING_FIXED = PayrollComponent.Category.EARNING_FIXED
EARNING_VARIABLE = PayrollComponent.Category.EARNING_VARIABLE
DEDUCTION = PayrollComponent.Category.DEDUCTION


class ImportFileError(Exception):
    """The file cannot be read as a payroll template at all."""


class ImportBlocked(Exception):
    """The file was read but still has rows to pair or errors; carries the preview."""

    def __init__(self, preview):
        super().__init__('Masih ada baris yang belum dipasangkan atau berisi error.')
        self.preview = preview


def import_block_reason(period):
    """None when `period` may be (re)imported, else the reason in Indonesian.

    Allowed: a DRAFT period (nothing calculated yet), or an imported period that
    is still CALCULATED/REVIEW (re-import). Engine-calculated periods and
    anything from APPROVED onwards are refused.
    """
    if period.status == PayrollPeriod.Status.DRAFT:
        return None
    if period.source == PayrollPeriod.Source.IMPORT and period.status in (
        PayrollPeriod.Status.CALCULATED,
        PayrollPeriod.Status.REVIEW,
    ):
        return None
    if period.source == PayrollPeriod.Source.ENGINE:
        return 'Periode ini sudah dihitung oleh HRIS. Impor hanya untuk periode Draf atau periode hasil impor.'
    return 'Periode hasil impor yang sudah disetujui/dibayar/dikunci tidak bisa diimpor ulang.'


def _norm_header(value) -> str:
    return re.sub(r'\s+', ' ', str(value or '')).strip().upper()


def normalize_name(value) -> str:
    """'(TEST) Andi  Pratama.' -> 'ANDI PRATAMA' (for matching only)."""
    text = re.sub(r'\([^)]*\)', ' ', str(value or ''))
    text = re.sub(r'[^0-9A-Za-z ]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip().upper()


def _code_for(header: str) -> str:
    """Stable item code from a column header, within PayrollItem's 32 chars."""
    slug = re.sub(r'[^A-Z0-9]+', '_', _norm_header(header)).strip('_')
    return f'IMP_{slug}'[:32].rstrip('_')


# Header recognition. Order matters: "SUBMIT PAYROLL ... Pph 21 ... & Kasbon"
# and "Total Penghasilan Bruto ... PPh21 ..." must win before PPh/Kasbon.
def _role_of(header: str):
    h = _norm_header(header)
    if not h:
        return None
    if 'INH/FLC' in h:
        return 'kind'
    if h == 'NAMA':
        return 'name'
    if 'SUBMIT PAYROLL' in h:
        return 'thp_excel'
    if 'TOTAL PENGHASILAN BRUTO' in h:
        return 'bruto_excel'
    if 'KATEGORI TER' in h:
        return 'ter_category'
    if 'PERSENTASE TER' in h:
        return 'ter_rate'
    if 'FEE FREELANCE' in h:
        return 'fee_freelance'
    if 'GAPOK' in h:
        return 'gapok'
    if h.startswith('KOMISI'):
        return 'komisi'
    if h.startswith('TUNJ'):
        return 'tunjangan'
    if 'PPH 21' in h or 'PPH21' in h:
        return 'pph'
    if 'KASBON' in h:
        return 'kasbon'
    if h == 'JABATAN':
        return 'position'
    if 'LOKASI' in h:
        return 'location'
    if 'PTKP' in h:
        return 'ptkp'
    if h == 'KET':
        return 'note'
    return None


EARNING_ROLES = ('gapok', 'komisi', 'tunjangan')
NUMERIC_ROLES = ('gapok', 'komisi', 'tunjangan', 'fee_freelance', 'pph', 'kasbon', 'bruto_excel', 'thp_excel')


def _money(value):
    """Cell value -> Decimal (2 dp). None/'' -> None. Raises ValueError for text."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError(value)
    if isinstance(value, str):
        cleaned = value.strip().replace('Rp', '').replace('.', '').replace(',', '.').strip()
        if cleaned in ('-', ''):
            return None
        value = cleaned
    try:
        return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(value) from exc


def _find_header_row(ws_values):
    for row in ws_values.iter_rows(min_row=1, max_row=min(ws_values.max_row, 30)):
        roles = {_role_of(c.value) for c in row}
        if 'kind' in roles and 'name' in roles:
            return row[0].row
    raise ImportFileError('Baris judul tidak ditemukan (butuh kolom "INH/FLC" dan "NAMA").')


def read_workbook(fileobj):
    """Parse the sheet into raw rows. Returns (columns, rows, file_warnings)."""
    try:
        wb_values = load_workbook(fileobj, data_only=True, read_only=False)
        fileobj.seek(0)
        wb_formulas = load_workbook(fileobj, data_only=False, read_only=False)
    except Exception as exc:  # zip/xml errors from a non-xlsx upload
        raise ImportFileError('File tidak bisa dibaca. Pastikan formatnya .xlsx.') from exc

    name = 'Template' if 'Template' in wb_values.sheetnames else wb_values.sheetnames[0]
    ws = wb_values[name]
    ws_f = wb_formulas[name]
    header_row = _find_header_row(ws)

    columns = []  # {col, header, role}
    for cell in ws[header_row]:
        if cell.value is None:
            continue
        columns.append({'col': cell.column, 'header': re.sub(r'\s+', ' ', str(cell.value)).strip(), 'role': _role_of(cell.value)})
    by_role = {}
    for c in columns:
        by_role.setdefault(c['role'], []).append(c)
    for required, label in (('name', 'NAMA'), ('gapok', 'GAPOK')):
        if required not in by_role:
            raise ImportFileError(f'Kolom "{label}" tidak ditemukan di baris judul.')
    kind_col = by_role['kind'][0]['col']

    rows = []
    uncached = []
    ignored_with_numbers = {}
    for r in range(header_row + 1, min(ws.max_row, header_row + MAX_ROWS) + 1):
        kind = _norm_header(ws.cell(r, kind_col).value)
        if kind not in ('INH', 'FLC'):
            continue
        values = {}
        for c in columns:
            raw = ws.cell(r, c['col']).value
            formula = ws_f.cell(r, c['col']).value
            if raw is None and isinstance(formula, str) and formula.startswith('='):
                if c['role'] in NUMERIC_ROLES:
                    uncached.append(ws.cell(r, c['col']).coordinate)
                continue
            if c['role'] is None:
                if isinstance(raw, (int, float)) and raw:
                    ignored_with_numbers.setdefault(c['header'], c['col'])
                continue
            values[c['col']] = raw
        rows.append({'row': r, 'kind': kind, 'values': values})

    if uncached:
        raise ImportFileError(
            'Nilai rumus belum tersimpan di file (contoh sel ' + ', '.join(uncached[:5]) + '). '
            'Buka file di Excel/Google Sheets, simpan ulang, lalu unggah lagi.'
        )
    warnings = [
        f'Kolom "{header}" berisi angka tapi tidak dikenali, sehingga diabaikan.'
        for header in ignored_with_numbers
    ]
    return columns, rows, warnings


def _dtp_threshold(period):
    config = (
        TaxConfig.objects.filter(year=period.period_year, is_active=True).first()
        or TaxConfig.objects.filter(year=period.period_year).first()
    )
    if config is None:
        return DEFAULT_DTP_THRESHOLD, (
            f'Konfigurasi pajak {period.period_year} belum ada; ambang DTP memakai Rp10.000.000.'
        )
    return config.dtp_threshold, None


def _employee_index():
    employees = list(Employee.objects.select_related('position').order_by('full_name'))
    by_norm = {}
    for e in employees:
        by_norm.setdefault(normalize_name(e.full_name), []).append(e)
    return employees, by_norm


def _employee_brief(e):
    return {
        'id': e.id,
        'employee_id': e.employee_id,
        'full_name': e.full_name,
        'position_name': e.position.name if e.position_id else None,
        'employment_status': e.employment_status,
    }


def _match(excel_name, employees, by_norm, mappings):
    """-> (employee | None, status, suggestions). mappings: {normalized name: employee id}."""
    norm = normalize_name(excel_name)
    mapped_id = mappings.get(norm)
    if mapped_id is not None:
        emp = next((e for e in employees if e.id == mapped_id), None)
        if emp is not None:
            return emp, 'mapped', []
    exact = by_norm.get(norm, [])
    if len(exact) == 1:
        return exact[0], 'auto', []
    pool = exact if exact else employees
    names = {normalize_name(e.full_name): e for e in pool}
    close = difflib.get_close_matches(norm, list(names), n=3, cutoff=0.5) if not exact else list(names)
    suggestions = [_employee_brief(names[n]) for n in close][:3]
    return None, 'ambiguous' if len(exact) > 1 else 'needs_mapping', suggestions


def build_preview(period, fileobj, mappings=None):
    """Parse + match + compute every row. Pure read: nothing is saved.

    `mappings` (HR's manual pairings) is {excel name: employee id}; names are
    normalized here, so callers can send the name exactly as shown.
    """
    # Pairings remembered from earlier imports, overridden by this request's.
    remembered = dict(PayrollImportAlias.objects.values_list('normalized_name', 'employee_id'))
    requested = {normalize_name(k): int(v) for k, v in (mappings or {}).items() if v not in (None, '')}
    mappings = {**remembered, **requested}
    columns, raw_rows, file_warnings = read_workbook(fileobj)
    threshold, threshold_warning = _dtp_threshold(period)
    if threshold_warning:
        file_warnings.append(threshold_warning)
    employees, by_norm = _employee_index()
    col_by_role = {}
    for c in columns:
        col_by_role.setdefault(c['role'], []).append(c)

    def first(values, role):
        cols = col_by_role.get(role) or []
        return values.get(cols[0]['col']) if cols else None

    rows, freelance = [], []
    for raw in raw_rows:
        v = raw['values']
        excel_name = str(first(v, 'name') or '').strip()
        errors, warnings = [], []

        def money(role, col=None, label=None):
            cell = v.get(col) if col is not None else first(v, role)
            try:
                amount = _money(cell)
            except ValueError:
                errors.append(f'Nilai "{cell}" di kolom {label or role} bukan angka.')
                return None
            if amount is not None and amount < 0:
                errors.append(f'Nilai di kolom {label or role} negatif.')
            return amount

        if raw['kind'] == 'FLC':
            fee = money('fee_freelance') or ZERO
            freelance.append({
                'row': raw['row'],
                'excel_name': excel_name,
                'position': first(v, 'position') or '',
                'fee_gross': str(fee),
                'thp_excel': str(money('thp_excel') or ZERO),
            })
            continue

        earnings = []
        for role in EARNING_ROLES:
            for c in col_by_role.get(role, []):
                amount = money(role, c['col'], c['header'])
                if amount:
                    earnings.append({
                        'label': 'Gaji Pokok' if role == 'gapok' else c['header'],
                        'code': 'IMP_GAPOK' if role == 'gapok' else _code_for(c['header']),
                        'category': EARNING_FIXED if role == 'gapok' else EARNING_VARIABLE,
                        'amount': str(amount),
                    })
        bruto = sum((Decimal(e['amount']) for e in earnings), ZERO)
        pph = money('pph') or ZERO
        kasbon = money('kasbon') or ZERO
        bruto_excel = money('bruto_excel')
        thp_excel = money('thp_excel')
        fee_freelance = money('fee_freelance')

        is_dtp = pph > 0 and bruto <= threshold
        thp = bruto - kasbon - pph
        transfer = thp + pph if is_dtp else thp

        if not excel_name:
            errors.append('Nama kosong.')
        if bruto == 0:
            warnings.append('Semua pendapatan 0.')
        if thp < 0:
            errors.append('THP minus (potongan lebih besar dari pendapatan).')
        if fee_freelance:
            warnings.append('Kolom Fee Freelance terisi di baris in-house; nilainya tidak dipakai.')
        if bruto_excel is not None and bruto_excel != bruto:
            warnings.append(f'Bruto di Excel {bruto_excel:,.0f} ≠ jumlah komponen {bruto:,.0f}.')
        if thp_excel is not None and thp_excel != thp:
            warnings.append(f'THP di Excel {thp_excel:,.0f} ≠ THP hitungan HRIS {thp:,.0f}.')
        if bruto > 0 and pph == 0 and first(v, 'pph') in (None, ''):
            warnings.append('PPh 21 kosong, dianggap 0.')

        employee, match_status, suggestions = _match(excel_name, employees, by_norm, mappings) if excel_name else (None, 'needs_mapping', [])
        if employee is not None and employee.employment_status != 'ACTIVE':
            warnings.append(f'Karyawan berstatus {employee.employment_status}.')

        deductions = []
        if pph:
            deductions.append({'label': 'Potongan Pajak (PPh 21)', 'code': 'PPh21', 'category': DEDUCTION, 'amount': str(pph)})
        if kasbon:
            deductions.append({'label': 'Kasbon', 'code': 'IMP_KASBON', 'category': DEDUCTION, 'amount': str(kasbon)})

        rows.append({
            'row': raw['row'],
            'excel_name': excel_name,
            'position': first(v, 'position') or '',
            'match': {
                'status': match_status,
                'employee': _employee_brief(employee) if employee else None,
                'suggestions': suggestions,
            },
            'earnings': earnings,
            'deductions': deductions,
            'bruto': str(bruto),
            'bruto_excel': None if bruto_excel is None else str(bruto_excel),
            'pph21': str(pph),
            'kasbon': str(kasbon),
            'thp': str(thp),
            'thp_excel': None if thp_excel is None else str(thp_excel),
            'is_dtp': is_dtp,
            'transfer': str(transfer),
            'errors': errors,
            'warnings': warnings,
        })

    # One employee may back only one row.
    seen = {}
    for row in rows:
        emp = row['match']['employee']
        if emp:
            seen.setdefault(emp['id'], []).append(row)
    for emp_id, dupes in seen.items():
        if len(dupes) > 1:
            for row in dupes:
                row['errors'].append(
                    'Karyawan yang sama dipasangkan ke baris ' + ', '.join(str(d['row']) for d in dupes if d is not row) + '.'
                )

    ready = [r for r in rows if r['match']['employee'] and not r['errors']]
    return {
        'period': {'id': period.id, 'month': period.period_month, 'year': period.period_year, 'status': period.status},
        'dtp_threshold': str(threshold),
        'columns': [{'header': c['header'], 'role': c['role']} for c in columns if c['role']],
        'warnings': file_warnings,
        'rows': rows,
        'freelance_skipped': {
            'count': len(freelance),
            'total_fee': str(sum((Decimal(f['fee_gross']) for f in freelance), ZERO)),
            'rows': freelance,
        },
        'summary': {
            'inhouse_rows': len(rows),
            'ready': len(ready),
            'needs_mapping': sum(1 for r in rows if not r['match']['employee']),
            'with_errors': sum(1 for r in rows if r['errors']),
            'with_warnings': sum(1 for r in rows if r['warnings']),
            'total_bruto': str(sum((Decimal(r['bruto']) for r in rows), ZERO)),
            'total_pph21': str(sum((Decimal(r['pph21']) for r in rows), ZERO)),
            'total_kasbon': str(sum((Decimal(r['kasbon']) for r in rows), ZERO)),
            'total_transfer': str(sum((Decimal(r['transfer']) for r in rows), ZERO)),
            'can_import': bool(rows) and len(ready) == len(rows),
        },
    }


def apply_import(period, fileobj, file_name, mappings, user, storage_path=''):
    """Replace the period's payroll with the file's rows (atomic).

    Raises ImportBlocked (with the preview) unless every in-house row is paired
    and error-free. Remembers HR's manual pairings for next month.
    """
    preview = build_preview(period, fileobj, mappings)
    if not preview['summary']['can_import']:
        raise ImportBlocked(preview)

    requested = {normalize_name(k): int(v) for k, v in (mappings or {}).items() if v not in (None, '')}
    with transaction.atomic():
        period.payrolls.all().delete()  # items cascade
        for row in preview['rows']:
            emp_id = row['match']['employee']['id']
            earnings = [(e, Decimal(e['amount'])) for e in row['earnings']]
            payroll = Payroll.objects.create(
                period=period,
                employee_id=emp_id,
                basic_salary=sum((a for e, a in earnings if e['code'] == 'IMP_GAPOK'), ZERO),
                total_fixed_earning=ZERO,
                total_variable_earning=sum((a for e, a in earnings if e['code'] != 'IMP_GAPOK'), ZERO),
                total_deduction=Decimal(row['pph21']) + Decimal(row['kasbon']),
                reimbursement_total=ZERO,
                gross_salary=Decimal(row['bruto']),
                net_salary=Decimal(row['thp']),
                is_dtp=row['is_dtp'],
                transfer_amount=Decimal(row['transfer']),
            )
            PayrollItem.objects.bulk_create([
                PayrollItem(
                    payroll=payroll,
                    component_name=item['label'][:128],
                    component_code=item['code'],
                    category=item['category'],
                    amount=Decimal(item['amount']),
                    source=PayrollItem.Source.IMPORT,
                    description=f'Impor Excel baris {row["row"]}',
                )
                for item in row['earnings'] + row['deductions']
            ])
            norm = normalize_name(row['excel_name'])
            if norm in requested:
                PayrollImportAlias.objects.update_or_create(
                    normalized_name=norm,
                    defaults={'excel_name': row['excel_name'][:200], 'employee_id': emp_id, 'created_by': user},
                )

        period.source = PayrollPeriod.Source.IMPORT
        if period.status == PayrollPeriod.Status.DRAFT:
            period.status = PayrollPeriod.Status.CALCULATED
        period.save()
        record = PayrollImport.objects.create(
            period=period,
            file_name=file_name[:255],
            storage_path=storage_path,
            row_count=len(preview['rows']),
            skipped_freelance=preview['freelance_skipped']['count'],
            total_transfer=Decimal(preview['summary']['total_transfer']),
            imported_by=user,
        )
    return record, preview
