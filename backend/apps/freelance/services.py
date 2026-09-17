"""Freelance task deadline reminder + escalation engine.

Design notes:
- Idempotent per run: TaskReminderLog doubles as dedup state. One row per
  (task, kind, offset_days) — a sent notification never repeats.
- Recipients: freelancer personal_email; PIC is free-text so the email goes
  to the freelancer record's company_email when present.
- Escalation: fires `escalate_after_days` after the deadline while the task is
  not SELESAI, repeating every `escalate_after_days` up to `max_escalations`
  total (dedup via TaskReminderLog), then silences.
- ESCALATE_CC always receives escalations; other toggles only control
  reminder recipients. All configured CCs also receive reminders.
"""
from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone

from apps.audit.services import log_event

from .emails import build_task_email
from .models import FreelanceTask, TaskEscalationPolicy, TaskReminderLog

OPEN_STATUSES = ('BELUM_MULAI', 'SEDANG_DIKERJAKAN', 'TERKENDALA')


def _split_emails(raw):
    emails = []
    for part in (raw or '').replace(';', ',').split(','):
        email = part.strip()
        if email:
            emails.append(email)
    return emails


def reminder_recipients(task, policy):
    """Deduped recipient list for a reminder email. Empty list = no email."""
    emails = []
    if policy.remind_freelancer and task.freelancer.personal_email:
        emails.append(task.freelancer.personal_email)
    if policy.remind_pic and task.pic and task.freelancer.company_email:
        emails.append(task.freelancer.company_email)
    emails.extend(_split_emails(policy.escalation_cc_emails))
    return list(dict.fromkeys(emails))


def escalation_recipients(task, policy):
    """Reminder recipients + always-CC list. Escalation never goes to nobody."""
    emails = reminder_recipients(task, policy)
    if not emails:
        emails = _split_emails(policy.escalation_cc_emails)
    return list(dict.fromkeys(emails))


def _send(task, *, kind, offset_days, escalation_no, recipients):
    subject, body = build_task_email(
        task, kind=kind, offset_days=offset_days, escalation_no=escalation_no
    )
    sent = send_mail(
        subject=subject,
        message=body,
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', '') or None,
        recipient_list=recipients,
        fail_silently=False,
    )
    TaskReminderLog.objects.create(
        task=task,
        kind=kind,
        offset_days=offset_days,
        recipient_emails=', '.join(recipients),
    )
    return sent > 0


def _log_errors(task, errors):
    """Persist send failures as audit entries so operators can diagnose."""
    for message in errors:
        log_event(
            None,
            'update',
            obj=task,
            user=None,
            description=f'Email gagal terkirim untuk task "{task.title}": {message}',
            metadata={'module': 'freelance', 'kind': 'reminder_error'},
        )


def gather_reminders(today=None):
    """Return [(task, kind, offset_days, escalation_no)] due for sending today.

    Dedup guarantees each tuple fires at most once: reminder by (task,
    offset_days) row, escalation by (task, offset_days=escalation_no) row.
    A task gets at most one email per run: the most urgent due reminder, or
    the next unsent due escalation. Escalation n fires once
    today >= deadline + n * escalate_after_days, regardless of how long ago
    the deadline passed (catch-up safe).
    """
    if today is None:
        today = timezone.localdate()
    policy = TaskEscalationPolicy.get_solo()
    if not policy.enabled:
        return []

    sent = set(
        TaskReminderLog.objects.filter(task__status__in=OPEN_STATUSES)
        .values_list('task_id', 'kind', 'offset_days')
    )
    due = []

    if policy.reminder_offset_list():
        tasks = (
            FreelanceTask.objects.filter(status__in=OPEN_STATUSES, deadline__isnull=False)
            .select_related('event', 'freelancer')
        )
        for task in tasks:
            days_left = (task.deadline - today).days
            if days_left < 0:
                continue  # overdue tasks are owned by the escalation ladder
            # Eligible = offsets whose window has opened and not yet sent.
            # Send the one closest to the deadline (min), so a late-created
            # task gets a single catch-up reminder, not the whole ladder.
            eligible = [
                offset for offset in policy.reminder_offset_list()  # descending
                if days_left <= offset
                and (offset >= 0 or days_left == offset)  # negative = exact day only
                and (task.id, 'REMINDER', offset) not in sent
            ]
            if not eligible:
                continue
            if not reminder_recipients(task, policy):
                continue
            # Fire the next reminder in chronological order (smallest
            # remaining offset): D-3 first, then D-1, then D-0 on the
            # deadline day — even for catch-up runs.
            due.append((task, 'REMINDER', min(eligible), None))

    interval = policy.escalate_after_days
    tasks = (
        FreelanceTask.objects.filter(
            status__in=OPEN_STATUSES,
            deadline__isnull=False,
            deadline__lte=today - timezone.timedelta(days=interval),
        )
        .select_related('event', 'freelancer')
    )
    for task in tasks:
        for escalation_no in range(1, policy.max_escalations + 1):
            fire_date = task.deadline + timezone.timedelta(days=interval * escalation_no)
            if today < fire_date:
                break  # not due yet; later escalations fire even later
            if (task.id, 'ESCALATION', escalation_no) in sent:
                continue
            due.append((task, 'ESCALATION', escalation_no, escalation_no))
            break
    return due


def send_due_reminders(*, recipient_override=None, today=None, actor=None, request=None):
    """Send every due reminder/escalation email. Returns a summary dict."""
    policy = TaskEscalationPolicy.get_solo()
    result = {'sent': 0, 'skipped': 0, 'failed': 0, 'details': []}
    for task, kind, offset_days, escalation_no in gather_reminders(today=today):
        if kind == 'ESCALATION':
            recipients = recipient_override or escalation_recipients(task, policy)
        else:
            recipients = recipient_override or reminder_recipients(task, policy)
        if not recipients:
            result['skipped'] += 1
            result['details'].append(
                {'task_id': task.id, 'kind': kind, 'offset_days': offset_days, 'status': 'no_recipients'}
            )
            continue
        try:
            if _send(task, kind=kind, offset_days=offset_days, escalation_no=escalation_no, recipients=recipients):
                result['sent'] += 1
                result['details'].append(
                    {'task_id': task.id, 'kind': kind, 'offset_days': offset_days, 'status': 'sent'}
                )
            else:
                # send_mail returned 0 without raising — count as not sent.
                result['skipped'] += 1
                result['details'].append(
                    {'task_id': task.id, 'kind': kind, 'offset_days': offset_days, 'status': 'not_sent'}
                )
        except Exception as exc:  # noqa: BLE001 — one bad address must not stop the run
            result['failed'] += 1
            result['details'].append(
                {
                    'task_id': task.id,
                    'kind': kind,
                    'offset_days': offset_days,
                    'status': 'failed',
                    'error': str(exc)[:255],
                }
            )
    if (result['sent'] or result['failed']) and request is not None:
        log_event(
            request,
            'update',
            description=(
                f'Send task reminders: {result["sent"]} terkirim, {result["failed"]} gagal'
            ),
            metadata={'module': 'freelance', 'result': {k: v for k, v in result.items() if k != 'details'}},
        )
    return result
