"""Email templates + placeholder rendering for employee notifications.

Each event has a default subject/body (Indonesian). Settings UI lets HR
override subject/body per event; placeholders are rendered before send.
Unknown placeholders render as empty string (never leak raw braces).
"""
import re

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


def fmt_date(value) -> str:
    return value.strftime('%d %b %Y') if value else '-'
