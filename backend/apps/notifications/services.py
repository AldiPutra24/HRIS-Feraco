"""Employee notification + email reminder services.

Reuses the Freelance 1C Phase 2 *pattern* (gather -> dedup key -> send with
per-recipient try/except -> delivery log -> --dry-run support; same EMAIL_*
settings and DEFAULT_FROM_EMAIL) but is a separate engine because the
freelance engine reads FreelanceTask directly and its templates/escalation
ladder are domain-bound. There is still exactly ONE scheduler mechanism:
a daily cron per management command, no second scheduler process.

Delivery units, all guarded by NotificationDeliveryLog unique keys
(idempotent: re-running any part never delivers the same unit twice):
- leave hooks: leave-submitted:{id}, leave-status:{id}:{STATUS}
- contract: contract:{contract_id}:{days_before} (per channel/recipient)
- birthday: birthday:{employee_id}:{year}:{offset}:{hr|employee}

Errors on one email never abort the whole job; each failure is logged
to the delivery log and audit.
"""
from datetime import date

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, send_mail
from django.utils import timezone

from apps.audit.services import log_event
from apps.personnel.models import Employee, EmployeeContract

from .emails import default_body, default_subject, fmt_date, render_email_parts
from .sanitize import sanitize_html
from .models import (
    Notification,
    NotificationDeliveryLog,
    NotificationEventConfig,
    NotificationSetting,
)

# Notification.KIND stays coarse; config rows split BIRTHDAY into two
# template rows. Mapping event config row -> coarse kind for logs/in-app.
CONFIG_KIND = {
    'LEAVE_SUBMITTED': 'LEAVE_SUBMITTED',
    'LEAVE_APPROVED': 'LEAVE_APPROVED',
    'LEAVE_REJECTED': 'LEAVE_REJECTED',
    'CONTRACT': 'CONTRACT',
    'BIRTHDAY_HR': 'BIRTHDAY',
    'BIRTHDAY_EMPLOYEE': 'BIRTHDAY',
}

LEAVE_LINK = '/dashboard/leave'


def _employee_email(employee: Employee):
    """Best-effort email for a personnel record."""
    return getattr(employee, 'company_email', '') or getattr(employee, 'personal_email', '') or ''


def _manager_user(employee: Employee):
    return getattr(getattr(employee, 'manager', None), 'user', None)


def _manager_employee(employee: Employee):
    return getattr(employee, 'manager', None)


def hr_recipients(setting: NotificationSetting | None = None):
    """Resolve HR recipient emails: default list + selected HR user emails.

    Never hardcodes recipients here — everything comes from the
    NotificationSetting singleton.
    """
    setting = setting or NotificationSetting.get_solo()
    return setting.hr_email_list()


def _config(event: str):
    obj, _ = NotificationEventConfig.objects.get_or_create(event=event)
    return obj


def _template(event: str):
    cfg = _config(event)
    subject = cfg.subject or default_subject(event)
    body = cfg.body or default_body(event)
    return cfg, subject, body


def _deliver_inapp(event_key: str, event: str, user, title: str, message: str,
                   link: str = '', object_id: str = ''):
    """Create one in-app notification, deduped by delivery-log key."""
    if user is None or not getattr(user, 'pk', None):
        return False
    key = f'{event_key}:inapp:{user.pk}'
    _, created = NotificationDeliveryLog.objects.get_or_create(
        key=key,
        defaults={
            'channel': 'IN_APP',
            'event': CONFIG_KIND.get(event, event),
            'recipient': user,
            'subject': title[:255],
            'status': 'SENT',
        },
    )
    if not created:
        return False
    Notification.objects.create(
        recipient=user,
        kind=CONFIG_KIND.get(event, event),
        title=title[:255],
        message=message,
        link=link or '',
        object_id=str(object_id or ''),
    )
    return True


def _send_email(event_key: str, event: str, email: str, subject: str, body: str,
                html_body: str = ''):
    """Send one email with try/except; log delivery either way.

    ``body`` is always the plain-text version (fallback for HTML templates).
    When ``html_body`` is given the mail is sent via EmailMultiAlternatives
    with the (re-sanitized) rich text as the HTML alternative. Subject stays
    plain text in both modes.

    Idempotent: if a SENT log for this key already exists the email is not
    sent again (FAILED rows allow a retry on the next run).
    """
    email = (email or '').strip()
    if not email or '@' not in email:
        return 'skipped'
    kind = CONFIG_KIND.get(event, event)
    key = f'{event_key}:email:{email}'
    if NotificationDeliveryLog.objects.filter(key=key, status='SENT').exists():
        return 'skipped'
    try:
        if html_body:
            # Defense in depth: the stored template was sanitized on save,
            # sanitize the rendered body again right before sending.
            html_body = sanitize_html(html_body)
            msg = EmailMultiAlternatives(
                subject=subject,
                body=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[email],
            )
            msg.attach_alternative(html_body, 'text/html')
            msg.send(fail_silently=False)
        else:
            send_mail(
                subject=subject,
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=False,
            )
        NotificationDeliveryLog.objects.create(
            key=key,
            channel='EMAIL',
            event=kind,
            recipient_email=email,
            subject=subject[:255],
            status='SENT',
        )
        return 'sent'
    except Exception as exc:  # one bad address / SMTP error must not stop the job
        NotificationDeliveryLog.objects.create(
            key=key,
            channel='EMAIL',
            event=kind,
            recipient_email=email,
            subject=subject[:255],
            status='FAILED',
            detail=str(exc)[:2000],
        )
        return 'failed'


# ---------------------------------------------------------------------------
# Leave workflow (called from leaves views; never raises into the request)
# ---------------------------------------------------------------------------

def _leave_context(leave) -> dict:
    employee = leave.employee
    manager = _manager_employee(employee)
    return {
        'employee_name': employee.full_name,
        'employee_email': _employee_email(employee),
        'manager_name': getattr(manager, 'full_name', '') or '-',
        'manager_email': _employee_email(manager) if manager else '',
        'leave_type': leave.leave_type.name,
        'leave_start': fmt_date(leave.start_date),
        'leave_end': fmt_date(leave.end_date),
        'leave_status': leave.get_status_display(),
        'rejection_reason': getattr(leave, 'rejection_reason', '') or '-',
    }


def notify_leave_submitted(leave) -> dict:
    """Pengajuan baru -> Reporting To (manager user): in-app + email."""
    result = {'inapp': 0, 'sent': 0, 'skipped': 0, 'failed': 0}
    try:
        cfg, subject_tpl, body_tpl = _template('LEAVE_SUBMITTED')
        if not cfg.enabled:
            return result
        ctx = _leave_context(leave)
        subject, text_body, html_body, _ = render_email_parts(subject_tpl, body_tpl, ctx)
        key = f'leave-submitted:{leave.pk}'
        manager_user = _manager_user(leave.employee)
        if _deliver_inapp(
            key, 'LEAVE_SUBMITTED', manager_user,
            'Pengajuan Izin/Cuti Baru', text_body, link=LEAVE_LINK, object_id=leave.pk,
        ):
            result['inapp'] += 1
        outcome = _send_email(key, 'LEAVE_SUBMITTED', _employee_email(_manager_employee(leave.employee)),
                              subject, text_body, html_body)
        result[outcome] = result.get(outcome, 0) + 1
    except Exception as exc:
        log_event(None, 'update', obj=None,
                  description=f'notify_leave_submitted error leave={leave.pk}: {exc}')
    return result


def notify_leave_status(leave, new_status: str) -> dict:
    """APPROVED/REJECTED -> employee: in-app + email (rejected includes reason)."""
    result = {'inapp': 0, 'sent': 0, 'skipped': 0, 'failed': 0}
    if new_status not in ('APPROVED', 'REJECTED'):
        return result
    event = 'LEAVE_APPROVED' if new_status == 'APPROVED' else 'LEAVE_REJECTED'
    try:
        cfg, subject_tpl, body_tpl = _template(event)
        if not cfg.enabled:
            return result
        ctx = _leave_context(leave)
        subject, text_body, html_body, _ = render_email_parts(subject_tpl, body_tpl, ctx)
        key = f'leave-status:{leave.pk}:{new_status}'
        user = getattr(leave.employee, 'user', None)
        if _deliver_inapp(
            key, event, user,
            'Pengajuan Disetujui' if event == 'LEAVE_APPROVED' else 'Pengajuan Ditolak',
            text_body, link=LEAVE_LINK, object_id=leave.pk,
        ):
            result['inapp'] += 1
        outcome = _send_email(key, event, _employee_email(leave.employee), subject, text_body, html_body)
        result[outcome] = result.get(outcome, 0) + 1
    except Exception as exc:
        log_event(None, 'update', obj=None,
                  description=f'notify_leave_status error leave={leave.pk}: {exc}')
    return result


# ---------------------------------------------------------------------------
# Scheduled: contract end + birthday
# ---------------------------------------------------------------------------

def _contract_queryset(today: date):
    return (
        EmployeeContract.objects
        .filter(
            status='ACTIVE',
            deleted_at__isnull=True,
            end_date__isnull=False,
        )
        .select_related('employee', 'employee__manager')
    )


def _birthday_employees(today: date):
    """ACTIVE employees whose birthday (month/day) matches target dates."""
    return (
        Employee.objects
        .filter(employment_status='ACTIVE', birth_date__isnull=False)
        .select_related('manager')
    )


def gather_contract(today: date = None):
    """Contract reminders due today: (contract, days_before, offset)."""
    today = today or timezone.localdate()
    setting = NotificationSetting.get_solo()
    cfg = _config('CONTRACT')
    if not cfg.enabled:
        return []
    offsets = setting.contract_offset_list()
    due = []
    for contract in _contract_queryset(today):
        days_remaining = (contract.end_date - today).days
        if days_remaining < 0:
            continue  # already ended -> not relevant anymore
        for offset in offsets:
            if days_remaining == offset:
                due.append((contract, offset, days_remaining))
                break  # one reminder per contract per run
    return due


def gather_birthdays(today: date = None):
    """Birthday notifications due today: list of (employee, offset).

    offset 0 = today (H-0), 1 = tomorrow (H-1). Toggle-independent checks
    happen at send time so each of H-1/H-0 can be switched off separately.
    """
    today = today or timezone.localdate()
    setting = NotificationSetting.get_solo()
    due = []
    targets = []
    if setting.birthday_h0_enabled:
        targets.append((today, 0))
    if setting.birthday_h1_enabled:
        from datetime import timedelta
        targets.append((today + timedelta(days=1), 1))
    if not targets:
        return due
    for employee in _birthday_employees(today):
        for target, offset in targets:
            if employee.birth_date.month == target.month and employee.birth_date.day == target.day:
                due.append((employee, offset))
                break  # one birthday notification per employee per run
    return due


def _contract_context(contract, days_remaining: int) -> dict:
    employee = contract.employee
    manager = _manager_employee(employee)
    return {
        'employee_name': employee.full_name,
        'employee_email': _employee_email(employee),
        'manager_name': getattr(manager, 'full_name', '') or '-',
        'manager_email': _employee_email(manager) if manager else '',
        'contract_end_date': fmt_date(contract.end_date),
        'days_remaining': str(days_remaining),
    }


def _send_contract_one(contract, offset: int, days_remaining: int, dry_run: bool = False):
    """Deliver contract reminder to employee + manager + HR. Returns unit list."""
    ctx = _contract_context(contract, days_remaining)
    cfg, subject_tpl, body_tpl = _template('CONTRACT')
    subject, text_body, html_body, _ = render_email_parts(subject_tpl, body_tpl, ctx)
    event_key = f'contract:{contract.pk}:{offset}'
    kind = 'CONTRACT'

    plan = []
    # employee (in-app + email)
    emp_user = getattr(contract.employee, 'user', None)
    emp_email = _employee_email(contract.employee)
    if emp_user or '@' in emp_email:
        plan.append(('employee', emp_user, emp_email))
    # manager (in-app + email)
    mgr = _manager_employee(contract.employee)
    mgr_user = getattr(mgr, 'user', None)
    mgr_email = _employee_email(mgr) if mgr else ''
    if mgr_user or '@' in mgr_email:
        plan.append(('manager', mgr_user, mgr_email))
    # HR (email only)
    for email in hr_recipients():
        plan.append(('hr', None, email))
    return subject, text_body, html_body, event_key, kind, plan


def send_contract_reminders(today: date = None, dry_run: bool = False, request=None):
    today = today or timezone.localdate()
    due = gather_contract(today)
    summary = {'due': len(due), 'sent': 0, 'skipped': 0, 'failed': 0, 'inapp': 0, 'details': []}
    if dry_run:
        for contract, offset, days_remaining in due:
            summary['details'].append(
                f'[KONTRAK H-{offset}] {contract.employee.full_name} '
                f'(end {contract.end_date}, {days_remaining} hari)'
            )
        return summary
    for contract, offset, days_remaining in due:
        subject, text_body, html_body, event_key, kind, plan = _send_contract_one(contract, offset, days_remaining)
        for role, user, email in plan:
            if user is not None:
                if _deliver_inapp(event_key, kind, user, subject, text_body,
                                  link='/dashboard/karyawan', object_id=contract.pk):
                    summary['inapp'] += 1
            outcome = _send_email(f'{event_key}:{role}', kind, email, subject, text_body, html_body)
            summary[outcome] = summary.get(outcome, 0) + 1
        summary['details'].append(
            f'[KONTRAK H-{offset}] {contract.employee.full_name}: {len(plan)} penerima'
        )
    if due:
        try:
            log_event(request, 'update', obj=None,
                      description=f'Contract reminders: {summary["due"]} contract(s) processed')
        except Exception:
            pass
    return summary


def _birthday_context(employee) -> dict:
    manager = _manager_employee(employee)
    return {
        'employee_name': employee.full_name,
        'employee_email': _employee_email(employee),
        'manager_name': getattr(manager, 'full_name', '') or '-',
        'manager_email': _employee_email(manager) if manager else '',
    }


def send_birthday_notifications(today: date = None, dry_run: bool = False, request=None):
    today = today or timezone.localdate()
    due = gather_birthdays(today)
    summary = {'due': len(due), 'sent': 0, 'skipped': 0, 'failed': 0, 'inapp': 0, 'details': []}
    if dry_run:
        for employee, offset in due:
            summary['details'].append(
                f'[BIRTHDAY H-{offset}] {employee.full_name} ({employee.birth_date})'
            )
        return summary
    year = today.year
    for employee, offset in due:
        ctx = _birthday_context(employee)
        # HR info email (BIRTHDAY_HR row): recipients = HR emails, no in-app.
        cfg_hr, subj_hr_tpl, body_hr_tpl = _template('BIRTHDAY_HR')
        if cfg_hr.enabled:
            hr_ctx = {**ctx, 'birthday_today': ' HARI INI' if offset == 0 else ' besok (H-1)'}
            subject_hr, text_hr, html_hr, _ = render_email_parts(subj_hr_tpl, body_hr_tpl, hr_ctx)
            event_key = f'birthday:{employee.pk}:{year}:{offset}:hr'
            for email in hr_recipients():
                outcome = _send_email(event_key, 'BIRTHDAY_HR', email, subject_hr, text_hr, html_hr)
                summary[outcome] = summary.get(outcome, 0) + 1
        # Employee greeting email (BIRTHDAY_EMPLOYEE row).
        cfg_emp, subj_emp_tpl, body_emp_tpl = _template('BIRTHDAY_EMPLOYEE')
        if cfg_emp.enabled:
            subject_emp, text_emp, html_emp, _ = render_email_parts(subj_emp_tpl, body_emp_tpl, ctx)
            event_key = f'birthday:{employee.pk}:{year}:{offset}:employee'
            outcome = _send_email(event_key, 'BIRTHDAY_EMPLOYEE',
                                  _employee_email(employee), subject_emp, text_emp, html_emp)
            summary[outcome] = summary.get(outcome, 0) + 1
            # In-app greeting if the employee has a user account.
            emp_user = getattr(employee, 'user', None)
            if emp_user is not None and _deliver_inapp(event_key, 'BIRTHDAY', emp_user,
                                                       subject_emp, text_emp):
                summary['inapp'] += 1
        summary['details'].append(f'[BIRTHDAY H-{offset}] {employee.full_name} terkirim')
    if due:
        try:
            log_event(request, 'update', obj=None,
                      description=f'Birthday notifications: {summary["due"]} employee(s) processed')
        except Exception:
            pass
    return summary


def run_all(today: date = None, dry_run: bool = False, request=None):
    """Entry point for the management command: contract + birthday."""
    contract_summary = send_contract_reminders(today=today, dry_run=dry_run, request=request)
    birthday_summary = send_birthday_notifications(today=today, dry_run=dry_run, request=request)
    return {
        'contract': contract_summary,
        'birthday': birthday_summary,
    }
