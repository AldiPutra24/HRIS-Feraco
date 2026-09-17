"""Send due freelance task deadline reminders + escalations.

Schedule daily (host crontab on the VPS, or the container entrypoint):

    python manage.py send_task_reminders            # send due emails
    python manage.py send_task_reminders --dry-run  # list only, send nothing
"""
from django.core.management.base import BaseCommand

from apps.freelance.services import gather_reminders, send_due_reminders


class Command(BaseCommand):
    help = 'Send freelance task deadline reminders and overdue escalations.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List due notifications without sending anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        due = gather_reminders()
        if not due:
            self.stdout.write('Tidak ada reminder/eskalasi yang jatuh tempo hari ini.')
            return
        self.stdout.write(f'{len(due)} notifikasi jatuh tempo:')
        for task, kind, offset, esc_no in due:
            label = 'ESKALASI' if kind == 'ESCALATION' else f'REMINDER D-{offset}'
            self.stdout.write(f'  [{label}] {task.title} — {task.freelancer.full_name} '
                              f'@ {task.event.name} (deadline {task.deadline})')
        if dry_run:
            self.stdout.write('Dry-run: tidak ada email dikirim.')
            return
        result = send_due_reminders()
        self.stdout.write(
            f"Selesai: {result['sent']} terkirim, {result['skipped']} dilewati, "
            f"{result['failed']} gagal."
        )
