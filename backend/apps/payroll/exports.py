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

    # --- colors — exact tints extracted from the official template PDF -------
    TITLE_GREEN = (0.7725, 0.8745, 0.7059)   # title bar  #C5DFB4
    EARN_GREEN = (0.851, 0.9176, 0.8275)     # JUMLAH PENGHASILAN  #D9EAD3
    DEDU_ORANGE = (0.9882, 0.898, 0.8039)    # JUMLAH POTONGAN  #FCE5CD
    THP_BLUE = (0.8118, 0.8863, 0.9529)      # TAKE HOME PAY  #CFE2F3
    NUMBER_BLUE = (0.8667, 0.9216, 0.9686)   # slip number box  #DDE9F7

    p = canvas.Canvas(response, pagesize=A4)
    width, height = A4
    L, R = 72, 497                # template content area (matches template PDF)
    CW = R - L

    def top(y_top):
        return height - y_top

    def wrap(text_str, max_w, font='Helvetica', size=8):
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
        return lines or ['']

    box_w = 95
    addr_lines = wrap(company.address or '', CW - box_w - 20, 'Helvetica', 8)[:2]

    # -- 1. Bordered company header + attached green title bar (template exact) --
    hdr_top = 60
    hdr_h = 34 + 11 * len(addr_lines)
    hdr_bottom = hdr_top + hdr_h
    title_h = 30
    p.setFillColorRGB(*TITLE_GREEN)
    p.rect(L, top(hdr_bottom + title_h), CW, title_h, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.rect(L, top(hdr_bottom + title_h), CW, title_h + hdr_h, stroke=1, fill=0)
    p.setFont('Helvetica-Bold', 11)
    p.drawCentredString(width / 2, top(hdr_top + 16), company.name)
    p.setFont('Helvetica', 8)
    ay = hdr_top + 30
    for al in addr_lines:
        p.drawCentredString(width / 2, top(ay), al)
        ay += 11
    p.setFont('Helvetica-Bold', 11.5)
    p.drawCentredString(width / 2, top(hdr_bottom + title_h / 2 + 4),
                        f'SLIP GAJI | {month_name} | {period.period_year}')

    # -- 2. Company info (left) + Nomor box (right, light blue) ------------------
    info_top = hdr_bottom + title_h + 12
    box_w, box_h = 95, 38
    p.setFillColorRGB(*NUMBER_BLUE)
    p.rect(R - box_w, top(info_top + box_h), box_w, box_h, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica', 7.5)
    p.drawString(R - box_w + 6, top(info_top + 12), 'Nomor')
    p.setFont('Helvetica-Bold', 9.5)
    p.drawCentredString(R - box_w / 2, top(info_top + 27), slip_number)

    p.setFont('Helvetica-Bold', 10)
    p.drawString(L, top(info_top + 10), company.name)
    p.setFont('Helvetica', 8)
    ay = info_top + 21
    for al in addr_lines:
        p.drawString(L, top(ay), al)
        ay += 10
    info_bottom = max(ay, info_top + box_h + 2)

    # Separator line under the info block (template: full-width thin line).
    p.setLineWidth(0.7)
    p.line(L, top(info_bottom + 8), R, top(info_bottom + 8))

    # -- 3. Employee data (labels left, underlined values) ------------------------
    rows = [
        ('Nama Pegawai', emp.full_name),
        ('Jabatan', emp.position.name if emp.position else None),
        ('Alamat', (emp.address or '').splitlines()[0] if emp.address else None),
        ('Periode', f'{period.period_start} s/d {period.period_end}'),
    ]
    value_x = L + 110
    ry = info_bottom + 24
    for label, val in rows:
        if val is None:
            continue  # conditional rendering: hide the whole row when unavailable
        p.setFont('Helvetica', 9)
        p.drawString(L, top(ry), label)
        p.drawString(value_x, top(ry), f': {val}')
        p.setLineWidth(0.5)
        p.line(value_x, top(ry + 3), R, top(ry + 3))
        ry += 13

    # -- 4. PENGHASILAN section -----------------------------------------------------
    ry += 8
    p.setFont('Helvetica-Bold', 10)
    p.drawString(L, top(ry), 'PENGHASILAN')
    ry += 16
    p.setFont('Helvetica', 9)
    for item in earnings:
        p.drawString(L + 18, top(ry), item.component_name)
        p.drawRightString(R - 4, top(ry), _fmt(item.amount))
        ry += 13
    ry += 4
    p.setFillColorRGB(*EARN_GREEN)
    p.rect(L - 1, top(ry + 26), CW + 2, 26, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 10)
    p.drawString(L + 2, top(ry + 17), 'JUMLAH PENGHASILAN')
    p.drawRightString(R - 4, top(ry + 17), _fmt(payroll.gross_salary))
    ry += 26

    # -- 5. POTONGAN section ---------------------------------------------------------
    ry += 12
    p.setFont('Helvetica-Bold', 10)
    p.drawString(L, top(ry), 'POTONGAN')
    ry += 16
    p.setFont('Helvetica', 9)
    for item in deductions:
        p.drawString(L + 18, top(ry), item.component_name)
        p.drawRightString(R - 4, top(ry), _fmt(item.amount))
        ry += 13
    ry += 4
    p.setFillColorRGB(*DEDU_ORANGE)
    p.rect(L - 1, top(ry + 28), CW + 2, 28, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 10)
    p.drawString(L + 2, top(ry + 18), 'JUMLAH POTONGAN')
    p.drawRightString(R - 4, top(ry + 18), _fmt(payroll.total_deduction))
    ry += 28

    # -- 6. TAKE HOME PAY bar ---------------------------------------------------------
    ry += 22
    p.setFillColorRGB(*THP_BLUE)
    p.rect(L - 1, top(ry + 32), CW + 2, 32, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 11)
    p.drawString(L + 2, top(ry + 20), 'TAKE HOME PAY')
    p.drawRightString(R - 4, top(ry + 20), f'Rp {_fmt(thp)}')
    ry += 32

    # -- 7. Terbilang (bordered two-row block, value centered) -------------------------
    ry += 14
    row1_h, row2_h = 22, 26
    p.setLineWidth(0.7)
    p.rect(L, top(ry + row1_h + row2_h), CW, row1_h + row2_h, stroke=1, fill=0)
    p.line(L, top(ry + row1_h), R, top(ry + row1_h))
    p.line(L + 231, top(ry + row1_h), L + 231, top(ry))  # divider on the label row
    p.setFont('Helvetica', 9)
    p.drawString(L + 8, top(ry + 15), 'Terbilang :')
    p.setFont('Helvetica-Oblique', 9.5)
    p.drawCentredString(width / 2, top(ry + row1_h + 16), terbilang(payroll.net_salary))
    ry += row1_h + row2_h

    # -- 8. Notes footer (wrapped inside the content width) ----------------------------
    ry += 14
    dtp_note = (
        ' Pada periode ini PPh bersifat DTP (Ditanggung Pemerintah), sehingga'
        ' pemotongan pajak hanya berlaku bagi karyawan dengan penghasilan di'
        ' atas ambang DTP.'
        if payroll.is_dtp else ''
    )
    notes = [
        '*) Penghasilan berupa Natura/Kenikmatan tidak ditambahkan karena'
        ' bersifat non tunai.',
        '*) PPh ditampilkan sebagai pajak terutang.' + dtp_note,
    ]
    p.setFont('Helvetica', 8)
    for note in notes:
        for ln in wrap(note, CW - 4, 'Helvetica', 8):
            p.setFont('Helvetica', 8)
            p.drawString(L, top(ry), ln)
            ry += 10
        ry += 4  # blank line between notes

    # -- 9. Signature block (right bottom, per template: dotted line, dept, company) ----
    sig_top = ry + 26
    p.setLineWidth(0.7)
    p.line(R - 90, top(sig_top), R - 12, top(sig_top))
    p.setFont('Helvetica-Bold', 9)
    p.drawRightString(R, top(sig_top + 14), company.department_name)
    p.drawRightString(R, top(sig_top + 26), company.name)
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
