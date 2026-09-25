"""Tahap 3c: payslip PDF (reportlab) + payroll recap XLSX (openpyxl)."""

from decimal import Decimal

from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from .models import CompanyConfig, PayrollPeriod
from .terbilang import terbilang

MONTHS_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]


def assign_slip_number(payroll) -> str:
    """Sequential per period (resets monthly, PRD decision #4). Idempotent."""
    if payroll.slip_number:
        return payroll.slip_number
    seq = payroll.period.payrolls.exclude(slip_number='').count() + 1
    number = f'{seq:03d}/HRGA/{payroll.period.period_month:02d}/{payroll.period.period_year}'
    payroll.slip_number = number
    payroll.save(update_fields=['slip_number'])
    return number


def _fmt(value) -> str:
    return f'{Decimal(value):,.0f}'.replace(',', '.')


def build_payslip_pdf(payroll) -> HttpResponse:
    """Payslip PDF — layout per official FERACO template ( bordered company
    header, tinted section bars, boxed slip number, notes footer, signature
    block ). Business logic untouched: same items, same totals, same guard
    (period must be PAID/LOCKED), same slip numbering and terbilang."""
    period = payroll.period
    if period.status not in (PayrollPeriod.Status.PAID, PayrollPeriod.Status.LOCKED):
        return HttpResponse(
            {'detail': 'Slip gaji hanya tersedia setelah periode dibayar (PAID/LOCKED).'},
            status=400, content_type='application/json',
        )
    company = CompanyConfig.load()
    emp = payroll.employee
    slip_number = assign_slip_number(payroll)
    month_name = MONTHS_ID[period.period_month - 1]

    items = list(payroll.items.all())
    earnings = [i for i in items if i.category != 'DEDUCTION']
    deductions = [i for i in items if i.category == 'DEDUCTION']
    # Displayed THP: net (DTP rule stays intact — transfer_amount differs but
    # is NOT re-rendered here; the note footer explains DTP).
    thp = payroll.net_salary

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = (
        f'inline; filename="slip-gaji-{emp.employee_id}-{period.period_year}'
        f'-{period.period_month:02d}.pdf"'
    )

    # --- colors (light tints per template) ----------------------------------
    GREEN_TINT = (0.855, 0.918, 0.827)   # title + PENGHASILAN bar
    ORANGE_TINT = (0.996, 0.898, 0.812)  # POTONGAN bar
    BLUE_TINT = (0.835, 0.902, 0.976)    # TAKE HOME PAY bar
    NUMBER_TINT = (0.906, 0.929, 0.969)  # slip number box

    p = canvas.Canvas(response, pagesize=A4)
    width, height = A4
    left, right = 16 * mm, width - 16 * mm
    y = height - 16 * mm

    def text(t, x, y_pos, font='Helvetica', size=9, bold=False, color=None):
        p.setFont('Helvetica-Bold' if bold else font, size)
        if color:
            p.setFillColorRGB(*color)
        p.drawString(x, y_pos, t)
        p.setFillColorRGB(0, 0, 0)

    def bar(label, y_pos, tint, size=9.5):
        """Full-width tinted section bar (PENGHASILAN / POTONGAN / THP)."""
        p.setFillColorRGB(*tint)
        p.rect(left, y_pos - 1.5 * mm, right - left, 6.5 * mm, stroke=0, fill=1)
        p.setFillColorRGB(0, 0, 0)
        p.setFont('Helvetica-Bold', size)
        p.drawString(left + 2 * mm, y_pos, label)

    # -- 1. Bordered company header ------------------------------------------
    header_lines = [
        company.name,
        *((company.address or '').splitlines() or ['']),
    ]
    header_h = 6.5 * mm * len(header_lines) + 3 * mm
    p.rect(left, y - header_h + 5 * mm, right - left, header_h, stroke=1, fill=0)
    ty = y - 1 * mm
    for idx, hl in enumerate(header_lines):
        if idx == 0:
            p.setFont('Helvetica-Bold', 10.5)
            p.drawCentredString(width / 2, ty, hl)
        else:
            p.setFont('Helvetica', 8)
            p.drawCentredString(width / 2, ty, hl)
        ty -= 5.5 * mm
    y -= header_h + 2 * mm

    # -- 2. Title bar (light green) ------------------------------------------
    p.setFillColorRGB(*GREEN_TINT)
    p.rect(left, y - 2 * mm, right - left, 8 * mm, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 11)
    p.drawCentredString(
        width / 2, y,
        f'SLIP GAJI | {month_name} | {period.period_year}',
    )
    y -= 8 * mm

    # -- 3. Company info (left) + slip number box (right) -------------------
    info_y = y
    p.setFont('Helvetica-Bold', 9.5)
    p.drawString(left, info_y, company.name)
    p.setFont('Helvetica', 8)
    addr_lines = (company.address or '').splitlines() or ['']
    ay = info_y - 4 * mm
    for al in addr_lines:
        p.drawString(left, ay, al)
        ay -= 3.6 * mm
    # Number box (right)
    box_w = 52 * mm
    box_h = 9 * mm
    p.setFillColorRGB(*NUMBER_TINT)
    p.rect(right - box_w, info_y - box_h + 3 * mm, box_w, box_h, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica', 8)
    p.drawString(right - box_w + 2 * mm, info_y - 2.2 * mm, 'Nomor')
    p.setFont('Helvetica-Bold', 9)
    p.drawCentredString(
        right - box_w / 2, info_y - 6.5 * mm,
        slip_number,
    )
    y = ay - 2 * mm

    # -- 4. Employee data -----------------------------------------------------
    label_x = left
    value_x = left + 22 * mm
    rows = [
        ('Nama Pegawai', emp.full_name),
        ('Jabatan', emp.position.name if emp.position else None),
        ('Alamat', (emp.address or '').splitlines()[0] if emp.address else None),
        ('Periode', f'{period.period_start} s/d {period.period_end}'),
    ]
    for label, val in rows:
        if val is None:
            continue  # don't render unavailable fields
        p.setFont('Helvetica', 9)
        p.drawString(label_x, y, label)
        p.drawString(value_x, y, f': {val}')
        y -= 4.6 * mm
    y -= 2 * mm

    # -- 5. PENGHASILAN section -----------------------------------------------
    bar('PENGHASILAN', y, GREEN_TINT)
    y -= 6 * mm
    p.setFont('Helvetica', 9)
    for item in earnings:
        p.drawString(left + 4 * mm, y, item.component_name)
        p.drawRightString(right - 2 * mm, y, _fmt(item.amount))
        y -= 4.6 * mm
    # Jumlah Penghasilan bar (same tint, bold)
    bar('JUMLAH PENGHASILAN', y, GREEN_TINT)
    p.setFont('Helvetica-Bold', 9.5)
    p.drawRightString(right - 2 * mm, y, _fmt(payroll.gross_salary))
    y -= 9 * mm

    # -- 6. POTONGAN section ---------------------------------------------------
    bar('POTONGAN', y, ORANGE_TINT)
    y -= 6 * mm
    p.setFont('Helvetica', 9)
    for item in deductions:
        p.drawString(left + 4 * mm, y, item.component_name)
        p.drawRightString(right - 2 * mm, y, _fmt(item.amount))
        y -= 4.6 * mm
    bar('JUMLAH POTONGAN', y, ORANGE_TINT)
    p.setFont('Helvetica-Bold', 9.5)
    p.drawRightString(right - 2 * mm, y, _fmt(payroll.total_deduction))
    y -= 9 * mm

    # -- 7. TAKE HOME PAY section ----------------------------------------------
    bar('TAKE HOME PAY', y, BLUE_TINT, size=10)
    p.setFont('Helvetica-Bold', 11)
    p.drawRightString(right - 2 * mm, y, f'Rp {_fmt(thp)}')
    y -= 9 * mm

    # -- 8. Terbilang -----------------------------------------------------------
    p.setFont('Helvetica', 8.5)
    p.drawString(left, y, 'Terbilang :')
    y -= 5 * mm
    p.setFont('Helvetica-Oblique', 9)
    p.drawCentredString(width / 2, y, terbilang(payroll.net_salary))
    y -= 8 * mm

    # -- 9. Notes footer ----------------------------------------------------------
    p.setFont('Helvetica-Oblique', 7.5)
    notes = [
        '*) Penghasilan berupa Natura/Kenikmatan tidak ditambahkan karena bersifat non monetary.',
        '*) PPh ditampilkan sebagai pajak terutang.'
        + (
            ' Pada periode ini PPh bersifat DTP (Ditanggung Pemerintah), sehingga'
            ' pemotongan pajak hanya berlaku bagi karyawan dengan penghasilan di atas ambang DTP.'
            if payroll.is_dtp else ''
        ),
    ]
    for note in notes:
        p.drawString(left, y, note)
        y -= 4 * mm
    y -= 2 * mm

    # -- 10. Signature block --------------------------------------------------------
    p.setFont('Helvetica-Bold', 9)
    p.drawRightString(right, y, company.department_name)
    y -= 14 * mm
    p.setFont('Helvetica', 9)
    p.drawRightString(right, y, '(..............................)')
    y -= 5 * mm
    p.setFont('Helvetica-Bold', 9)
    p.drawRightString(right, y, company.name)
    p.save()
    return response


def build_recap_xlsx(period) -> HttpResponse:
    """Rekap transfer per rekening for manual internet banking (PRD langkah 5)."""
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = (
        f'attachment; filename="rekap-payroll-{period.period_year}-'
        f'{period.period_month:02d}.xlsx"'
    )
    wb = Workbook()
    ws = wb.active
    ws.title = 'Rekap'
    headers = ['No', 'Nama Karyawan', 'Bank', 'No Rekening', 'Nominal Transfer']
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    payrolls = list(period.payrolls.select_related('employee').order_by('employee__full_name'))
    for idx, payroll in enumerate(payrolls, start=1):
        emp = payroll.employee
        ws.append([
            idx, emp.full_name, emp.bank_account_name or '-',
            emp.bank_account_number or '-', int(payroll.transfer_amount),
        ])
    total_row = ws.max_row + 2
    ws.cell(row=total_row, column=4, value='TOTAL').font = Font(bold=True)
    ws.cell(row=total_row, column=5, value=int(sum(p.transfer_amount for p in payrolls))).font = Font(bold=True)
    for col, w in zip('ABCDE', (5, 30, 25, 25, 18)):
        ws.column_dimensions[col].width = w
    wb.save(response)
    return response
