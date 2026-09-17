"""Email rendering for freelance task reminders and escalations."""
from django.conf import settings


def _default_from():
    return getattr(settings, 'DEFAULT_FROM_EMAIL', '') or 'noreply@feraco.id'


def build_task_email(task, *, kind='REMINDER', offset_days=None, escalation_no=None):
    """Return (subject, body) for a task notification email.

    kind: REMINDER (offset_days = days before deadline, may be negative when
    sent after the deadline passed) or ESCALATION (escalation_no = 1-based).
    """
    freelancer_name = task.freelancer.full_name
    title = task.title
    event_name = task.event.name
    deadline = task.deadline.strftime('%d %b %Y') if task.deadline else '-'
    status = task.get_status_display()

    if kind == 'ESCALATION':
        subject = f'[ESKALASI] Task freelance terlambat: {title}'
        intro = (
            f'Task freelance berikut melewati deadline dan belum selesai '
            f'(eskalasi ke-{escalation_no}).'
        )
    elif offset_days is not None and offset_days > 0:
        subject = f'[Reminder] Task freelance: {title}'
        intro = f'Task freelance berikut akan mencapai deadline {offset_days} hari lagi.'
    else:
        subject = f'[Reminder] Task freelance deadline hari ini: {title}'
        intro = 'Task freelance berikut berdeadline hari ini.'

    lines = [
        intro,
        '',
        f'Event      : {event_name}',
        f'Task       : {title}',
        f'Freelancer : {freelancer_name}',
        f'Deadline   : {deadline}',
        f'Status     : {status}',
    ]
    if task.pic:
        lines.append(f'PIC        : {task.pic}')
    if task.description:
        lines += ['', 'Deskripsi / Catatan:', task.description]
    lines += [
        '',
        'Mohon follow up atau perbarui status task melalui HRIS.',
        '',
        'Email otomatis dari HRIS Feraco. Mohon tidak membalas email ini.',
    ]
    return subject, '\n'.join(lines)
