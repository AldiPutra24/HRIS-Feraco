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
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, send_mail
from django.db import close_old_connections, transaction
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
    'REIMBURSEMENT_SUBMITTED': 'REIMBURSEMENT_SUBMITTED',
    'REIMBURSEMENT_REVIEWED': 'REIMBURSEMENT_REVIEWED',
    'REIMBURSEMENT_APPROVED': 'REIMBURSEMENT_APPROVED',
    'REIMBURSEMENT_REJECTED': 'REIMBURSEMENT_REJECTED',
    'REIMBURSEMENT_PAID': 'REIMBURSEMENT_PAID',
    'CONTRACT': 'CONTRACT',
    'BIRTHDAY_HR': 'BIRTHDAY',
    'BIRTHDAY_EMPLOYEE': 'BIRTHDAY',
}

LEAVE_LINK = '/dashboard/leave'
MANAGEMENT_LEAVE_LINK = '/dashboard/management/leave'
REIMBURSEMENT_LINK = '/dashboard/reimbursements'

# HR roles that receive dashboard (bell) notifications for new submissions.
HR_NOTIFY_ROLES = ('HR_STAFF', 'HR_LEAD')


# New leave/izin: HR + Admin are informed (bell) next to the Reporting To.
# Approval rights are unchanged (Admin informed only, cannot approve leave).
LEAVE_NOTIFY_ROLES = ('ADMIN', 'HR_STAFF', 'HR_LEAD')

# Reimbursement bell follows the approval stage (Admin may act on both):
#   submitted -> HR Staff review; reviewed -> HR Lead final approval.
REIMBURSEMENT_REVIEW_ROLES = ('ADMIN', 'HR_STAFF')
REIMBURSEMENT_FINAL_ROLES = ('ADMIN', 'HR_LEAD')


def hr_notify_users(roles=HR_NOTIFY_ROLES, include_superusers=False):
    """Active user accounts with one of `roles` (in-app bell recipients)."""
    from django.db.models import Q

    from apps.accounts.models import User

    q = Q(role__key__in=roles)
    if include_superusers:
        q |= Q(is_superuser=True)
    return list(User.objects.filter(q, is_active=True).distinct())


def _own_leave_link_for(user):
    """Requester's own leave history page (employees live under /dashboard/employee)."""
    role = getattr(getattr(user, 'role', None), 'key', None)
    if role == 'EMPLOYEE':
        return '/dashboard/employee/leave'
    return _leave_link_for(user)


def _leave_link_for(user):
    """Approval page per recipient role (management has its own page)."""
    role = getattr(getattr(user, 'role', None), 'key', None)
    if role in ('MANAGEMENT', 'GENERAL_MANAGER'):
        return MANAGEMENT_LEAVE_LINK
    return LEAVE_LINK


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


# Request-path emails (leave/reimbursement hooks) are sent in the background
# so a slow SMTP server never blocks the submit/approve response (each SMTP
# SSL connect + login takes seconds, x every recipient). Scheduled jobs
# (cron commands) keep calling _send_email synchronously.
_EMAIL_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix='hris-mail')


def _email_async() -> bool:
    """Background sending only for real SMTP delivery (tests/dev backends
    stay synchronous). Override with settings.NOTIFICATION_EMAIL_ASYNC."""
    explicit = getattr(settings, 'NOTIFICATION_EMAIL_ASYNC', None)
    if explicit is not None:
        return bool(explicit)
    return settings.EMAIL_BACKEND.endswith('smtp.EmailBackend')


def _queue_email(event_key: str, event: str, email: str, subject: str, body: str,
                 html_body: str = ''):
    """Send after the DB transaction commits, off the request thread.

    Returns 'queued' (or the synchronous outcome when async is disabled).
    Delivery result is still recorded in NotificationDeliveryLog (idempotent
    per key), so HR sees SENT/FAILED in the delivery log page.
    """
    if not _email_async():
        return _send_email(event_key, event, email, subject, body, html_body)

    def run():
        try:
            _send_email(event_key, event, email, subject, body, html_body)
        except Exception:
            pass  # delivery log already captures SMTP errors; never crash the pool
        finally:
            close_old_connections()  # thread-local DB connection

    transaction.on_commit(lambda: _EMAIL_POOL.submit(run))
    return 'queued'


# ---------------------------------------------------------------------------
# Leave workflow (called from leaves views; never raises into the request)
# ---------------------------------------------------------------------------

def _approver_name(leave) -> str:
    user = getattr(leave, 'approver', None)
    if user is None:
        return '-'
    personnel = getattr(user, 'personnel', None)
    name = getattr(personnel, 'full_name', '') if personnel else ''
    return name or user.get_full_name() or user.get_username()


def _leave_context(leave) -> dict:
    from apps.leaves.services import format_days, format_leave_dates

    employee = leave.employee
    manager = _manager_employee(employee)
    days = leave.selected_days() if hasattr(leave, 'selected_days') else []
    dates = [d for d, _ in days]
    half = [d for d, p in days if p == 'HALF']
    return {
        'employee_name': employee.full_name,
        'employee_email': _employee_email(employee),
        'manager_name': getattr(manager, 'full_name', '') or '-',
        'manager_email': _employee_email(manager) if manager else '',
        'leave_type': leave.leave_type.name,
        'leave_start': fmt_date(leave.start_date),
        'leave_end': fmt_date(leave.end_date),
        'leave_dates': format_leave_dates(dates, half) if dates else fmt_date(leave.start_date),
        'leave_days': format_days(leave.total_days or len(dates)),
        'leave_status': leave.get_status_display(),
        'approver_name': _approver_name(leave),
        'rejection_reason': getattr(leave, 'rejection_reason', '') or '-',
    }


def notify_leave_submitted(leave) -> dict:
    """Pengajuan baru -> Reporting To (primary approver) + Admin/HR Staff/HR Lead
    (informed; HR Staff/HR Lead are also fallback approvers): in-app + email.

    Idempotent per recipient via delivery-log keys; a user who is both the
    manager and HR gets exactly one in-app notification.
    """
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
            'Pengajuan Izin/Cuti Baru', text_body, link=_leave_link_for(manager_user), object_id=leave.pk,
        ):
            result['inapp'] += 1
        outcome = _queue_email(key, 'LEAVE_SUBMITTED', _employee_email(_manager_employee(leave.employee)),
                              subject, text_body, html_body)
        result[outcome] = result.get(outcome, 0) + 1
        # Admin / HR Staff / HR Lead: bell notification + HR email list (Settings).
        own_user_id = getattr(getattr(leave.employee, 'user', None), 'pk', None)
        for hr_user in hr_notify_users(LEAVE_NOTIFY_ROLES, include_superusers=True):
            if hr_user.pk == own_user_id:
                continue  # never notify someone about their own request
            if _deliver_inapp(
                key, 'LEAVE_SUBMITTED', hr_user,
                'Pengajuan Izin/Cuti Baru', text_body, link=LEAVE_LINK, object_id=leave.pk,
            ):
                result['inapp'] += 1
        for email in hr_recipients():
            outcome = _queue_email(f'{key}:hr', 'LEAVE_SUBMITTED', email, subject, text_body, html_body)
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
            text_body, link=_own_leave_link_for(user), object_id=leave.pk,
        ):
            result['inapp'] += 1
        outcome = _queue_email(key, event, _employee_email(leave.employee), subject, text_body, html_body)
        result[outcome] = result.get(outcome, 0) + 1
    except Exception as exc:
        log_event(None, 'update', obj=None,
                  description=f'notify_leave_status error leave={leave.pk}: {exc}')
    return result


# ---------------------------------------------------------------------------
# Reimbursement workflow (called from reimbursement submit; never raises)
# ---------------------------------------------------------------------------

def _rupiah(value) -> str:
    try:
        return 'Rp ' + f'{int(round(float(value))):,}'.replace(',', '.')
    except (TypeError, ValueError):
        return str(value or '-')


def _reimbursement_context(reimbursement) -> dict:
    employee = reimbursement.employee
    manager = _manager_employee(employee)
    return {
        'employee_name': employee.full_name,
        'employee_email': _employee_email(employee),
        'manager_name': getattr(manager, 'full_name', '') or '-',
        'manager_email': _employee_email(manager) if manager else '',
        'reimbursement_category': reimbursement.category.name,
        'reimbursement_amount': _rupiah(reimbursement.amount),
        'reimbursement_date': fmt_date(reimbursement.transaction_date),
        'reimbursement_description': reimbursement.description or '-',
        'reimbursement_approved_amount': (
            _rupiah(reimbursement.approved_amount) if reimbursement.approved_amount is not None else '-'
        ),
        'reimbursement_bank': ' '.join(filter(None, [
            reimbursement.bank_name, reimbursement.bank_account_number,
            f'a.n. {reimbursement.bank_account_name}' if reimbursement.bank_account_name else '',
        ])) or '-',
        'payment_reference': reimbursement.payment_reference or '-',
        'rejection_reason': reimbursement.rejection_reason or '-',
    }


def _own_reimbursement_link(user):
    """Requester's own reimbursement page (management has its own route)."""
    role = getattr(getattr(user, 'role', None), 'key', None)
    if role in ('MANAGEMENT', 'GENERAL_MANAGER'):
        return '/dashboard/management/reimbursement'
    return '/dashboard/employee/reimbursement'


def _notify_reimbursement_hr(reimbursement, event, title, roles) -> dict:
    """Bell for the HR layer that must act now + HR email list (submit only)."""
    result = {'inapp': 0, 'sent': 0, 'skipped': 0, 'failed': 0}
    try:
        cfg, subject_tpl, body_tpl = _template(event)
        if not cfg.enabled:
            return result
        ctx = _reimbursement_context(reimbursement)
        subject, text_body, html_body, _ = render_email_parts(subject_tpl, body_tpl, ctx)
        key = f'{event.lower().replace("_", "-")}:{reimbursement.pk}'
        link = f'{REIMBURSEMENT_LINK}?id={reimbursement.pk}'
        own_user_id = getattr(getattr(reimbursement.employee, 'user', None), 'pk', None)
        for hr_user in hr_notify_users(roles, include_superusers=True):
            if hr_user.pk == own_user_id:
                continue
            if _deliver_inapp(key, event, hr_user, title, text_body, link=link, object_id=reimbursement.pk):
                result['inapp'] += 1
        if event == 'REIMBURSEMENT_SUBMITTED':
            for email in hr_recipients():
                outcome = _queue_email(key, event, email, subject, text_body, html_body)
                result[outcome] = result.get(outcome, 0) + 1
    except Exception as exc:
        log_event(None, 'update', obj=None,
                  description=f'{event} notification error id={reimbursement.pk}: {exc}')
    return result


def _notify_reimbursement_employee(reimbursement, event, title) -> dict:
    """Requester: bell + email to the contact email given on the request
    (fallback: employee email). Idempotent per event."""
    result = {'inapp': 0, 'sent': 0, 'skipped': 0, 'failed': 0}
    try:
        cfg, subject_tpl, body_tpl = _template(event)
        if not cfg.enabled:
            return result
        ctx = _reimbursement_context(reimbursement)
        subject, text_body, html_body, _ = render_email_parts(subject_tpl, body_tpl, ctx)
        key = f'{event.lower().replace("_", "-")}:{reimbursement.pk}'
        user = getattr(reimbursement.employee, 'user', None)
        if _deliver_inapp(key, event, user, title, text_body,
                          link=_own_reimbursement_link(user), object_id=reimbursement.pk):
            result['inapp'] += 1
        email = reimbursement.contact_email or _employee_email(reimbursement.employee)
        outcome = _queue_email(key, event, email, subject, text_body, html_body)
        result[outcome] = result.get(outcome, 0) + 1
    except Exception as exc:
        log_event(None, 'update', obj=None,
                  description=f'{event} notification error id={reimbursement.pk}: {exc}')
    return result


def notify_reimbursement_reviewed(reimbursement) -> dict:
    """HR Staff set Nominal Disetujui -> HR Lead (+Admin) bell."""
    return _notify_reimbursement_hr(
        reimbursement, 'REIMBURSEMENT_REVIEWED', 'Reimbursement Menunggu Approval HR Lead',
        REIMBURSEMENT_FINAL_ROLES,
    )


def notify_reimbursement_approved(reimbursement) -> dict:
    return _notify_reimbursement_employee(reimbursement, 'REIMBURSEMENT_APPROVED', 'Reimbursement Disetujui')


def notify_reimbursement_rejected(reimbursement) -> dict:
    return _notify_reimbursement_employee(reimbursement, 'REIMBURSEMENT_REJECTED', 'Reimbursement Ditolak')


def notify_reimbursement_paid(reimbursement) -> dict:
    """Transfer confirmation to the requester (email from the request)."""
    return _notify_reimbursement_employee(reimbursement, 'REIMBURSEMENT_PAID', 'Reimbursement Dibayar')


def notify_reimbursement_submitted(reimbursement) -> dict:
    """Pengajuan reimbursement baru -> HR Staff (+Admin) bell for review +
    HR email list. Idempotent via key `reimbursement-submitted:{id}`."""
    return _notify_reimbursement_hr(
        reimbursement, 'REIMBURSEMENT_SUBMITTED', 'Pengajuan Reimbursement Baru',
        REIMBURSEMENT_REVIEW_ROLES,
    )


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


def birthday_audiences(setting, offset: int) -> dict:
    """Which audiences get a birthday notification at this offset (0=H-0, 1=H-1)."""
    if offset == 0:
        return {'hr': setting.birthday_hr_h0_enabled, 'employee': setting.birthday_employee_h0_enabled}
    return {'hr': setting.birthday_hr_h1_enabled, 'employee': setting.birthday_employee_h1_enabled}


def gather_birthdays(today: date = None):
    """Birthday notifications due today: list of (employee, offset, audiences).

    offset 0 = today (H-0), 1 = tomorrow (H-1). HR and employee have their
    own H-1/H-0 switches; an offset is due when at least one audience is on.
    """
    from datetime import timedelta

    today = today or timezone.localdate()
    setting = NotificationSetting.get_solo()
    due = []
    targets = []
    for offset in (0, 1):
        audiences = birthday_audiences(setting, offset)
        if any(audiences.values()):
            targets.append((today + timedelta(days=offset), offset, audiences))
    if not targets:
        return due
    for employee in _birthday_employees(today):
        for target, offset, audiences in targets:
            if employee.birth_date.month == target.month and employee.birth_date.day == target.day:
                due.append((employee, offset, audiences))
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
        for employee, offset, audiences in due:
            targets = '+'.join(k.upper() for k, on in audiences.items() if on)
            summary['details'].append(
                f'[BIRTHDAY H-{offset}] {employee.full_name} ({employee.birth_date}) -> {targets}'
            )
        return summary
    year = today.year
    for employee, offset, audiences in due:
        ctx = _birthday_context(employee)
        # HR info email (BIRTHDAY_HR row): recipients = HR emails, no in-app.
        cfg_hr, subj_hr_tpl, body_hr_tpl = _template('BIRTHDAY_HR')
        if audiences['hr'] and cfg_hr.enabled:
            hr_ctx = {**ctx, 'birthday_today': ' HARI INI' if offset == 0 else ' besok (H-1)'}
            subject_hr, text_hr, html_hr, _ = render_email_parts(subj_hr_tpl, body_hr_tpl, hr_ctx)
            event_key = f'birthday:{employee.pk}:{year}:{offset}:hr'
            for email in hr_recipients():
                outcome = _send_email(event_key, 'BIRTHDAY_HR', email, subject_hr, text_hr, html_hr)
                summary[outcome] = summary.get(outcome, 0) + 1
        # Employee greeting email (BIRTHDAY_EMPLOYEE row).
        cfg_emp, subj_emp_tpl, body_emp_tpl = _template('BIRTHDAY_EMPLOYEE')
        if audiences['employee'] and cfg_emp.enabled:
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
