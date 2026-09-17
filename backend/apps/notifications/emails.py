"""Email templates + placeholder rendering for employee notifications.

Each event has a default subject/body (Indonesian). Settings UI lets HR
override subject/body per event; placeholders are rendered before send.
Unknown placeholders render as empty string (never leak raw braces).

Bodies may be plain text (legacy/default templates) or rich-text HTML
authored in the Settings email editor. `render_email_parts` detects which
one it got, sanitizes HTML through the whitelist sanitizer, escapes every
placeholder value when the body is HTML (values can never inject markup)
and derives a plain-text fallback for the HTML alternative.
"""
import html
import re

from .sanitize import html_to_text, is_rich_html, sanitize_html

PLACEHOLDER_RE = re.compile(r'\{\{\s*([a-z0-9_]+)\s*\}\}')

AVAILABLE_PLACEHOLDERS = [
    '{{employee_name}}',
    '{{employee_email}}',
    '{{manager_name}}',
    '{{manager_email}}',
    '{{contract_end_date}}',
    '{{days_remaining}}',
    '{{leave_type}}',
    '{{leave_start}}',
    '{{leave_end}}',
    '{{leave_status}}',
    '{{rejection_reason}}',
]

DEFAULT_TEMPLATES = {
    'LEAVE_SUBMITTED': (
        '[HRIS] Pengajuan Izin/Cuti Baru - {{employee_name}}',
        'Halo {{manager_name}},\n\n'
        '{{employee_name}} mengajukan {{leave_type}}.\n\n'
        'Periode: {{leave_start}} s/d {{leave_end}}\n'
        'Status: {{leave_status}}\n\n'
        'Silakan tinjau di menu Leave di HRIS Feraco.\n\n'
        'Terima kasih,\nHRIS Feraco',
    ),
    'LEAVE_APPROVED': (
        '[HRIS] Pengajuan Izin/Cuti Disetujui',
        'Halo {{employee_name}},\n\n'
        'Pengajuan {{leave_type}} Anda ({{leave_start}} s/d {{leave_end}}) '
        'telah DISETUJUI oleh {{manager_name}}.\n\n'
        'Terima kasih,\nHRIS Feraco',
    ),
    'LEAVE_REJECTED': (
        '[HRIS] Pengajuan Izin/Cuti Ditolak',
        'Halo {{employee_name}},\n\n'
        'Pengajuan {{leave_type}} Anda ({{leave_start}} s/d {{leave_end}}) '
        'DITOLAK oleh {{manager_name}}.\n\n'
        'Alasan: {{rejection_reason}}\n\n'
        'Terima kasih,\nHRIS Feraco',
    ),
    'CONTRACT': (
        '[HRIS] Pengingat Akhir Kontrak - {{employee_name}} ({{days_remaining}} hari)',
        'Halo,\n\n'
        'Kontrak {{employee_name}} akan berakhir pada {{contract_end_date}} '
        '({{days_remaining}} hari lagi).\n\n'
        'Penerima email ini: karyawan, atasan ({{manager_name}}), dan HR.\n\n'
        'Terima kasih,\nHRIS Feraco',
    ),
    'BIRTHDAY_HR': (
        '[HRIS] Ulang Tahun Karyawan {{employee_name}}',
        'Halo HR,\n\n'
        '{{employee_name}} berulang tahun'
        '{{birthday_today}}.\n\n'
        'Email: {{employee_email}}\n\n'
        'Terima kasih,\nHRIS Feraco',
    ),
    'BIRTHDAY_EMPLOYEE': (
        '[HRIS] Selamat Ulang Tahun, {{employee_name}}!',
        'Halo {{employee_name}},\n\n'
        'Selamat ulang tahun! Semoga sehat, bahagia, dan sukses selalu.\n\n'
        'Salam hangat,\nTim HRIS Feraco',
    ),
}


def default_subject(event: str) -> str:
    return DEFAULT_TEMPLATES.get(event, ('[HRIS] Notifikasi', ''))[0]


def default_body(event: str) -> str:
    return DEFAULT_TEMPLATES.get(event, ('[HRIS] Notifikasi', ''))[1]


def render_template(text: str, context: dict) -> str:
    """Replace {{placeholders}}; unknown ones become empty string."""

    def _sub(match):
        return str(context.get(match.group(1), ''))

    return PLACEHOLDER_RE.sub(_sub, text or '')


def render_email_parts(subject_tpl: str, body_tpl: str, context: dict) -> tuple[str, str, str, bool]:
    """Render subject + body template into sendable email parts.

    Returns ``(subject, text_body, html_body, is_html)``. For plain-text
    templates (all defaults + legacy rows) behaviour is identical to the
    original ``render_template`` flow. For HTML templates the template is
    sanitized first, every context value is HTML-escaped before substitution
    (placeholder values can never inject markup), and a plain-text fallback
    is derived from the rendered HTML for ``EmailMultiAlternatives``.
    """
    subject = render_template(subject_tpl or '', context)
    if is_rich_html(body_tpl or ''):
        safe_body = sanitize_html(body_tpl or '')
        escaped_ctx = {k: html.escape(str(v), quote=False) for k, v in (context or {}).items()}
        html_body = render_template(safe_body, escaped_ctx)
        text_body = html_to_text(html_body)
        return subject, text_body, html_body, True
    return subject, render_template(body_tpl or '', context), '', False


# Dummy values used by the Settings "Preview Email" action. Never sent —
# only rendered into a copy of the template for the preview response.
PREVIEW_CONTEXT = {
    'employee_name': 'Budi Santoso',
    'employee_email': 'budi.santoso@feraco.co.id',
    'manager_name': 'Andi Pratama',
    'manager_email': 'andi.pratama@feraco.co.id',
    'contract_end_date': '31 Des 2026',
    'days_remaining': '30',
    'leave_type': 'Cuti Tahunan',
    'leave_start': '05 Okt 2026',
    'leave_end': '07 Okt 2026',
    'leave_status': 'Menunggu Persetujuan',
    'rejection_reason': 'Kuota cuti tidak mencukupi',
    'birthday_today': ' HARI INI',
}


def fmt_date(value) -> str:
    return value.strftime('%d %b %Y') if value else '-'
