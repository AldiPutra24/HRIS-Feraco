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
    header, tinted section bars, boxed slip number, wrapped notes footer,
    signature block ). Business logic untouched: same items, same totals,
    same guard (period must be PAID/LOCKED), same slip numbering, terbilang
    and DTP rules.

    Layout rules: A4 portrait, single page, everything inside the left/right
    margins, no row overlap (each section bar reserves its own vertical slot),
    notes wrap within the content width.
    """
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
    GREEN_TINT = (0.855, 0.918, 0.827)   # title + PENGHASILAN bars
    ORANGE_TINT = (0.996, 0.898, 0.812)  # POTONGAN bars
    BLUE_TINT = (0.835, 0.902, 0.976)    # TAKE HOME PAY bar
    NUMBER_TINT = (0.906, 0.929, 0.969)  # slip number box

    p = canvas.Canvas(response, pagesize=A4)
    width, height = A4
    margin = 16 * mm
    left, right = margin, width - margin
    content_w = right - left
    y = height - 15 * mm

    BAR_H = 7 * mm          # section bar height
    ROW_H = 5.2 * mm        # item row height (>= bar so nothing is overlapped)
    BAR_PAD = 2.5 * mm      # gap after each bar/section

    def bar(label, y_pos, tint, size=9.5, value=None, value_size=9.5):
        """Full-width tinted section bar occupying its own [y_pos-1.5mm .. y_pos+BAR_H-1.5mm] slot."""
        p.setFillColorRGB(*tint)
        p.rect(left, y_pos - 2 * mm, content_w, BAR_H, stroke=0, fill=1)
        p.setFillColorRGB(0, 0, 0)
        p.setFont('Helvetica-Bold', size)
        p.drawString(left + 2.5 * mm, y_pos, label)
        if value is not None:
            p.setFont('Helvetica-Bold', value_size)
            p.drawRightString(right - 2.5 * mm, y_pos, value)

    # -- 1. Bordered company header (compact, centered) -----------------------
    name_line = company.name
    addr_lines = (company.address or '').splitlines() or ['']
    line_h = 4.6 * mm
    header_h = line_h * (1 + len(addr_lines)) + 4 * mm
    header_top = y
    header_bottom = header_top - header_h
    p.rect(left, header_bottom, content_w, header_h, stroke=1, fill=0)
    ty = header_top - line_h + 1 * mm
    p.setFont('Helvetica-Bold', 10.5)
    p.drawCentredString(width / 2, ty, name_line)
    ty -= line_h
    p.setFont('Helvetica', 8)
    for al in addr_lines:
        p.drawCentredString(width / 2, ty, al)
        ty -= line_h
    y = header_bottom - 4 * mm

    # -- 2. Title bar (light green) -------------------------------------------
    p.setFillColorRGB(*GREEN_TINT)
    p.rect(left, y - 2 * mm, content_w, 7.5 * mm, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 11)
    p.drawCentredString(width / 2, y, f'SLIP GAJI | {month_name} | {period.period_year}')
    y -= 7.5 * mm + 3 * mm

    # -- 3. Company info (left) + slip number box (right) ---------------------
    info_y = y
    box_w = 50 * mm
    box_h = 9.5 * mm
    # Box first so its height defines the row; text sits to its left.
    p.setFillColorRGB(*NUMBER_TINT)
    p.rect(right - box_w, info_y - box_h + 2.5 * mm, box_w, box_h, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica', 7.5)
    p.drawString(right - box_w + 2 * mm, info_y - 1.4 * mm, 'Nomor')
    p.setFont('Helvetica-Bold', 9)
    p.drawCentredString(right - box_w / 2, info_y - 5.6 * mm, slip_number)

    p.setFont('Helvetica-Bold', 9.5)
    p.drawString(left, info_y, company.name)
    p.setFont('Helvetica', 7.8)
    ay = info_y - 4 * mm
    for al in addr_lines:
        p.drawString(left, ay, al)
        ay -= 3.5 * mm
    y = min(ay, info_y - box_h + 1 * mm) - 2 * mm

    # -- 4. Employee data ------------------------------------------------------
    label_x = left
    value_x = left + 24 * mm
    rows = [
        ('Nama Pegawai', emp.full_name),
        ('Jabatan', emp.position.name if emp.position else None),
        ('Alamat', (emp.address or '').splitlines()[0] if emp.address else None),
        ('Periode', f'{period.period_start} s/d {period.period_end}'),
    ]
    p.setFont('Helvetica', 9)
    for label, val in rows:
        if val is None:
            continue  # conditional rendering: hide the whole row when unavailable
        p.drawString(label_x, y, label)
        p.drawString(value_x, y, f': {val}')
        y -= 4.8 * mm
    y -= 2.5 * mm

    # -- 5. PENGHASILAN section -----------------------------------------------
    bar('PENGHASILAN', y, GREEN_TINT)
    y -= BAR_H - 2 * mm + ROW_H  # full bar slot + first row slot
    p.setFont('Helvetica', 9)
    for item in earnings:
        p.drawString(left + 5 * mm, y, item.component_name)
        p.drawRightString(right - 2.5 * mm, y, _fmt(item.amount))
        y -= ROW_H
    # Total bar occupies the slot right below the last item row.
    bar('JUMLAH PENGHASILAN', y, GREEN_TINT,
        value=_fmt(payroll.gross_salary))
    y -= BAR_H + BAR_PAD

    # -- 6. POTONGAN section ----------------------------------------------------
    bar('POTONGAN', y, ORANGE_TINT)
    y -= BAR_H - 2 * mm + ROW_H
    p.setFont('Helvetica', 9)
    for item in deductions:
        p.drawString(left + 5 * mm, y, item.component_name)
        p.drawRightString(right - 2.5 * mm, y, _fmt(item.amount))
        y -= ROW_H
    bar('JUMLAH POTONGAN', y, ORANGE_TINT,
        value=_fmt(payroll.total_deduction))
    y -= BAR_H + BAR_PAD

    # -- 7. TAKE HOME PAY ---------------------------------------------------------
    bar('TAKE HOME PAY', y, BLUE_TINT, size=10, value=f'Rp {_fmt(thp)}', value_size=11)
    y -= BAR_H + BAR_PAD

    # -- 8. Terbilang ----------------------------------------------------------------
    p.setFont('Helvetica', 8.5)
    p.drawString(left, y, 'Terbilang :')
    y -= 5.5 * mm
    p.setFont('Helvetica-Oblique', 9.5)
    p.drawCentredString(width / 2, y, terbilang(payroll.net_salary))
    y -= 8 * mm

    # -- 9. Notes footer (word-wrapped inside margins) --------------------------------
    p.setFont('Helvetica-Oblique', 8)
    dtp_note = (
        ' Pada periode ini PPh bersifat DTP (Ditanggung Pemerintah), sehingga'
        ' pemotongan pajak hanya berlaku bagi karyawan dengan penghasilan di'
        ' atas ambang DTP.'
        if payroll.is_dtp else ''
    )
    notes = [
        '*) Penghasilan berupa Natura/Kenikmatan tidak ditambahkan karena'
        ' bersifat non monetary.',
        '*) PPh ditampilkan sebagai pajak terutang.' + dtp_note,
    ]

    def wrap(text_str, max_w, font='Helvetica-Oblique', size=8):
        p.setFont(font, size)
        words = text_str.split()
        lines, cur = [], ''
        for w in words:
            cand = f'{cur} {w}'.strip()
            if p.stringWidth(cand, font, size) <= max_w:
                cur = cand
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    for note in notes:
        for ln in wrap(note, content_w - 2 * mm):
            p.drawString(left, y, ln)
            y -= 3.8 * mm
        y -= 1 * mm  # blank line between notes
    y -= 4 * mm

    # -- 10. Signature block (right, clear of the notes) -----------------------------
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
