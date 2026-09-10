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
    """PRD Section 6 payslip layout. Guard: period must be PAID/LOCKED."""
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

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = (
        f'inline; filename="slip-gaji-{emp.employee_id}-{period.period_year}'
        f'-{period.period_month:02d}.pdf"'
    )

    p = canvas.Canvas(response, pagesize=A4)
    width, height = A4
    left, right = 20 * mm, width - 20 * mm
    y = height - 15 * mm

    def line(text, x, y_pos, font='Helvetica', size=9, bold=False):
        p.setFont('Helvetica-Bold' if bold else font, size)
        p.drawString(x, y_pos, text)

    def row(label, value, y_pos, bold_value=False):
        line(label, left, y_pos)
        p.drawRightString(right, y_pos, value)
        if bold_value:
            p.line(right - 40 * mm, y_pos - 1 * mm, right, y_pos - 1 * mm)

    # Header
    p.setFont('Helvetica-Bold', 14)
    p.drawString(left, y, company.name)
    y -= 5 * mm
    p.setFont('Helvetica', 8)
    for addr_line in (company.address or '').splitlines() or ['']:
        p.drawString(left, y, addr_line)
        y -= 4 * mm
    y -= 2 * mm
    p.line(left, y, right, y)
    y -= 7 * mm

    # Title + info box
    p.setFont('Helvetica-Bold', 12)
    p.drawCentredString(width / 2, y, f'SLIP GAJI {month_name.upper()} {period.period_year}')
    y -= 6 * mm
    p.setFont('Helvetica', 9)
    p.drawString(left, y, f'No. Slip : {slip_number}')
    p.drawRightString(right, y, f'Periode : {period.period_start} s/d {period.period_end}')
    y -= 8 * mm

    # Employee data
    line('Nama', left, y, bold=True)
    line(f': {emp.full_name}', left + 25 * mm, y)
    line('Departemen', width / 2, y, bold=True)
    line(f': {emp.department.name if emp.department else "-"}', width / 2 + 25 * mm, y)
    y -= 5 * mm
    line('Jabatan', left, y, bold=True)
    line(f': {emp.position.name if emp.position else "-"}', left + 25 * mm, y)
    line('Status', width / 2, y, bold=True)
    line(f': {emp.employment_status}', width / 2 + 25 * mm, y)
    y -= 8 * mm

    # Earnings / deductions columns
    col2 = width / 2 + 5 * mm
    p.setFont('Helvetica-Bold', 10)
    p.drawString(left, y, 'PENGHASILAN')
    p.drawString(col2, y, 'POTONGAN')
    y -= 2 * mm
    p.line(left, y, width / 2 - 5 * mm, y)
    p.line(col2, y, right, y)
    y -= 5 * mm

    def draw_items(items_list, x, y_pos):
        p.setFont('Helvetica', 9)
        for item in items_list:
            p.drawString(x, y_pos, item.component_name)
            p.drawRightString(width / 2 - 5 * mm if x == left else right, y_pos,
                              _fmt(item.amount))
            y_pos -= 4.5 * mm
        return y_pos

    y_earn = draw_items(earnings, left, y)
    y_ded = draw_items(deductions, col2, y)
    y = min(y_earn, y_ded) - 1 * mm

    # Totals
    p.setFont('Helvetica-Bold', 9)
    p.drawString(left, y, 'Jumlah Penghasilan')
    p.drawRightString(width / 2 - 5 * mm, y, _fmt(payroll.gross_salary))
    p.drawString(col2, y, 'Jumlah Potongan')
    p.drawRightString(right, y, _fmt(payroll.total_deduction))
    y -= 8 * mm

    # THP + terbilang
    p.setFont('Helvetica-Bold', 11)
    p.drawString(left, y, 'THP (Take Home Pay)')
    p.drawRightString(right, y, f'Rp {_fmt(payroll.net_salary)}')
    y -= 6 * mm
    p.setFont('Helvetica-Oblique', 9)
    p.drawString(left, y, f'Terbilang: {terbilang(payroll.net_salary)}')
    y -= 10 * mm

    # Signature block
    p.setFont('Helvetica', 9)
    p.drawRightString(right, y, f'{company.department_name},')
    y -= 15 * mm
    p.drawRightString(right, y, '( ............................ )')
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
