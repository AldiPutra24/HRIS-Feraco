"""Tahap 3c: payslip PDF (reportlab) + payroll recap XLSX (openpyxl)."""

from decimal import Decimal
from pathlib import Path

from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from .models import CompanyConfig, PayrollPeriod, TaxConfig
from .terbilang import terbilang

MONTHS_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

# Letterhead (top of the official payslip template).
LOGO_PATH = Path(__file__).resolve().parent / 'assets' / 'feraco-logo.png'
LETTERHEAD_NAME = 'PT. Fery Agung Corindotama'
LETTERHEAD_ADDRESS = 'Puri Sentra Niaga B-42. Jl. Raya Kalimalang, Jakarta 13620'
LETTERHEAD_CONTACTS = ['(021) 8606819 (Hunting),  (021) 86605154', 'info@feraco.co.id']


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
    """Payslip PDF — layout per the official FERACO template (logo letterhead,
    bordered company box + green title bar, boxed slip number, underlined
    employee data, tinted total bars, boxed terbilang, italic notes,
    signature, brand footer band). Business logic untouched: same items,
    same totals, same guard (period must be PAID/LOCKED), same slip
    numbering, terbilang and DTP rules.

    Layout rules: A4 portrait, single page, coordinates follow the template
    PDF (measured in points from the top edge).
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

    # --- colors — tints taken from the official template --------------------
    TITLE_GREEN = (0.7725, 0.8745, 0.7059)   # title bar  #C5DFB4
    EARN_GREEN = (0.851, 0.9176, 0.8275)     # JUMLAH PENGHASILAN  #D9EAD3
    DEDU_ORANGE = (0.9882, 0.898, 0.8039)    # JUMLAH POTONGAN  #FCE5CD
    THP_BLUE = (0.8118, 0.8863, 0.9529)      # TAKE HOME PAY  #CFE2F3
    NUMBER_BLUE = (0.8667, 0.9216, 0.9686)   # slip number box  #DDE9F7
    NAVY = (0.106, 0.31, 0.541)              # logo wordmark / letterhead
    BAND_TEAL = (0.0, 0.62, 0.71)            # footer band, gradient start
    BAND_NAVY = (0.11, 0.2, 0.4)             # footer band, gradient end
    BAND_ORANGE = (0.965, 0.643, 0.11)       # footer band, right half

    p = canvas.Canvas(response, pagesize=A4)
    width, height = A4
    L, R = 72, 497                # template content area
    CW = R - L
    BOX_L, BOX_R = 79, 496        # bordered header box + title bar
    VALUE_R = 491                 # right edge of amounts

    def top(y_top):
        return height - y_top

    def wrap_runs(runs, max_w, size):
        """Word-wrap [(text, font), ...] keeping each word's font."""
        words = [(w, font) for text, font in runs for w in text.split()]
        lines, cur, cur_w = [], [], 0.0
        space = p.stringWidth(' ', 'Helvetica', size)
        for w, font in words:
            ww = p.stringWidth(w, font, size)
            if cur and cur_w + space + ww > max_w:
                lines.append(cur)
                cur, cur_w = [], 0.0
            cur_w += (space if cur else 0) + ww
            cur.append((w, font))
        if cur:
            lines.append(cur)
        return lines

    addr_lines = [ln.strip().rstrip(',') for ln in (company.address or '').splitlines() if ln.strip()]

    # -- 1. Letterhead: logo + wordmark (left), company contact (right) -------
    if LOGO_PATH.exists():
        logo_h = 48
        logo_w = logo_h * 216 / 400
        p.drawImage(str(LOGO_PATH), 94, top(42 + logo_h), logo_w, logo_h, mask='auto')
    p.setFillColorRGB(*NAVY)
    p.setFont('Times-Bold', 17)
    p.drawCentredString(106, top(106), 'FERACO')
    p.setFont('Helvetica', 12.5)
    p.drawString(356, top(74), LETTERHEAD_NAME)
    p.setFillColorRGB(0.25, 0.25, 0.25)
    p.setFont('Helvetica', 6.3)
    p.drawString(356, top(85), LETTERHEAD_ADDRESS)
    for i, line in enumerate(LETTERHEAD_CONTACTS):
        cy = 95 + i * 9.5
        p.setFillColorRGB(*NAVY)
        p.circle(359, top(cy - 2), 2.6, stroke=0, fill=1)
        p.setFillColorRGB(0.25, 0.25, 0.25)
        p.drawString(365, top(cy), line)

    # -- 2. Bordered company box + green title bar ------------------------------
    p.setFillColorRGB(*TITLE_GREEN)
    p.rect(BOX_L, top(220), BOX_R - BOX_L, 33, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setLineWidth(1.4)
    p.rect(BOX_L, top(188), BOX_R - BOX_L, 57, stroke=1, fill=0)
    p.setFont('Helvetica-Bold', 8)
    p.drawCentredString((BOX_L + BOX_R) / 2, top(156), company.name)
    p.setFont('Helvetica', 7)
    p.drawCentredString((BOX_L + BOX_R) / 2, top(166), ', '.join(addr_lines) + ',')
    p.setFont('Helvetica-Bold', 8)
    p.drawCentredString((BOX_L + BOX_R) / 2, top(206), f'SLIP GAJI {month_name.upper()} {period.period_year}')

    # -- 3. Company info (left) + Nomor + slip number box (right) ----------------
    p.setFillColorRGB(*NUMBER_BLUE)
    p.rect(400, top(270), BOX_R - 400, 38, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 8)
    p.drawCentredString((400 + BOX_R) / 2, top(254), slip_number)
    p.setFont('Helvetica', 7.5)
    p.drawString(357, top(242), 'Nomor')
    p.setFont('Helvetica-Bold', 8)
    p.drawString(L + 8, top(242), company.name)
    p.setFont('Helvetica', 7.5)
    for i, line in enumerate(addr_lines[:2]):
        p.drawString(L + 8, top(255 + i * 9.5), line + ',')

    # -- 4. Employee data (separator + underlined values) ------------------------
    p.setLineWidth(0.7)
    p.line(BOX_L, top(285), BOX_R, top(285))
    value_x = 182
    rows = [
        ('Nama Pegawai', emp.full_name),
        ('Jabatan', emp.position.name if emp.position else None),
        ('Alamat', (emp.address or '').splitlines()[0] if emp.address else None),
        ('Periode', f'{month_name} {period.period_year}'),
    ]
    ry = 297
    p.setLineWidth(0.6)
    for idx, (label, val) in enumerate(rows):
        p.setFont('Helvetica', 8)
        p.drawString(80, top(ry), label)
        p.drawString(value_x, top(ry), val or '-')
        if idx < len(rows) - 1:
            p.line(value_x - 2, top(ry + 2.5), BOX_R, top(ry + 2.5))
        ry += 10.5

    # -- 5. PENGHASILAN ----------------------------------------------------------------
    ry = 364
    p.setFont('Helvetica-Bold', 8)
    p.drawString(L + 3, top(ry), 'PENGHASILAN')
    ry += 9
    p.setFont('Helvetica', 7.5)
    for item in earnings:
        p.drawString(95, top(ry), item.component_name)
        p.drawRightString(VALUE_R, top(ry), _fmt(item.amount))
        ry += 9
    ry = max(ry + 8, 429)
    p.setFillColorRGB(*EARN_GREEN)
    p.rect(L, top(ry + 27), CW, 27, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 8)
    p.drawString(80, top(ry + 16), 'JUMLAH PENGHASILAN')
    p.drawRightString(VALUE_R, top(ry + 16), _fmt(payroll.gross_salary))
    ry += 27

    # -- 6. POTONGAN ---------------------------------------------------------------------
    ry += 25
    p.setFont('Helvetica-Bold', 8)
    p.drawString(L - 4, top(ry), 'POTONGAN')
    ry += 9
    p.setFont('Helvetica', 7.5)
    for item in deductions:
        p.drawString(93, top(ry), item.component_name)
        p.drawRightString(VALUE_R, top(ry), _fmt(item.amount))
        ry += 9
    ry += 8
    p.setFillColorRGB(*DEDU_ORANGE)
    p.rect(L, top(ry + 27), CW, 27, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 8)
    p.drawString(80, top(ry + 16), 'JUMLAH POTONGAN')
    p.drawRightString(VALUE_R, top(ry + 16), _fmt(payroll.total_deduction))
    ry += 27

    # -- 7. TAKE HOME PAY ------------------------------------------------------------------
    ry += 21
    p.setFillColorRGB(*THP_BLUE)
    p.rect(L, top(ry + 35), CW, 35, stroke=0, fill=1)
    p.setFillColorRGB(0, 0, 0)
    p.setFont('Helvetica-Bold', 8)
    p.drawString(80, top(ry + 20), 'TAKE HOME PAY')
    p.drawRightString(VALUE_R, top(ry + 20), f'Rp {_fmt(thp)}')
    ry += 35

    # -- 8. Terbilang (label + single bordered box, value centred) -------------------------
    ry += 15
    p.setFont('Helvetica', 7.5)
    p.drawString(L, top(ry), 'Terbilang :')
    ry += 8
    p.setLineWidth(0.8)
    p.rect(L, top(ry + 27), CW, 27, stroke=1, fill=0)
    p.setFont('Helvetica-Oblique', 7.5)
    p.drawCentredString((L + R) / 2, top(ry + 16), terbilang(payroll.net_salary))
    ry += 27

    # -- 9. Notes (italic; DTP rule in bold italic) -------------------------------------------
    ry += 17
    notes = [[('*) Penghasilan berupa Natura/Kenikmatan tidak ditambahkan karena bersifat non tunai',
               'Helvetica-Oblique')]]
    tax_note = [('*) PPh ditampilkan sebagai pajak terutang.', 'Helvetica-Oblique')]
    if payroll.is_dtp:
        cfg = TaxConfig.objects.filter(year=period.period_year).first()
        threshold = f'Rp{_fmt(cfg.dtp_threshold)}' if cfg and cfg.dtp_threshold else 'ambang DTP'
        tax_note += [
            ('Pada periode ini PPh bersifat DTP (Ditanggung Pemerintah), sehingga pemotongan pajak',
             'Helvetica-Oblique'),
            (f'hanya berlaku bagi karyawan dengan penghasilan di atas {threshold}', 'Helvetica-BoldOblique'),
        ]
    notes.append(tax_note)
    for runs in notes:
        for line in wrap_runs(runs, 290, 7.5):
            # One drawString per same-font run so the PDF text stays searchable.
            segments = []
            for w, font in line:
                if segments and segments[-1][1] == font:
                    segments[-1][0].append(w)
                else:
                    segments.append(([w], font))
            x = L
            for i, (words, font) in enumerate(segments):
                text = ' '.join(words) + ('' if i == len(segments) - 1 else ' ')
                p.setFont(font, 7.5)
                p.drawString(x, top(ry), text)
                x += p.stringWidth(text, font, 7.5)
            ry += 9.5

    # -- 10. Signature (department underlined, company bold) ----------------------------------
    sig_y = max(ry + 14, 735)
    p.setFont('Helvetica', 7.5)
    dept_w = p.stringWidth(company.department_name, 'Helvetica', 7.5)
    p.drawRightString(483, top(sig_y), company.department_name)
    p.setLineWidth(0.5)
    p.line(483 - dept_w, top(sig_y + 1.5), 483, top(sig_y + 1.5))
    p.setFont('Helvetica-Bold', 7.5)
    p.drawRightString(489, top(sig_y + 17), company.name)

    # -- 11. Brand footer band (teal → navy gradient, then orange) ------------------------------
    band_top, band_h, split = 770, 27, 313
    steps = 80
    for i in range(steps):
        t = i / (steps - 1)
        p.setFillColorRGB(*(a + (b - a) * t for a, b in zip(BAND_TEAL, BAND_NAVY)))
        p.rect(split * i / steps, top(band_top + band_h), split / steps + 0.5, band_h, stroke=0, fill=1)
    p.setFillColorRGB(*BAND_ORANGE)
    p.rect(split, top(band_top + band_h), width - split, band_h, stroke=0, fill=1)
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
