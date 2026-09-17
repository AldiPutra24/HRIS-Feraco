"""Send employee notifications: end-of-contract reminders + birthdays.

Run daily next to send_task_reminders (host crontab / container entrypoint):

    python manage.py send_employee_notifications            # deliver due items
    python manage.py send_employee_notifications --dry-run  # list only
"""
from django.core.management.base import BaseCommand

from apps.notifications.services import run_all


class Command(BaseCommand):
    help = 'Send contract end reminders and birthday notifications (in-app + email).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List due reminders without sending anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        result = run_all(dry_run=dry_run)

        contract = result['contract']
        birthday = result['birthday']

        if not contract['due'] and not birthday['due']:
            self.stdout.write('Tidak ada reminder kontrak / birthday yang jatuh tempo hari ini.')
            return

        for line in contract['details']:
            self.stdout.write(f'  {line}')
        for line in birthday['details']:
            self.stdout.write(f'  {line}')

        if dry_run:
            self.stdout.write('Dry-run: tidak ada email/notification dikirim.')
            return

        self.stdout.write(
            f"Kontrak: {contract['due']} jatuh tempo -> "
            f"{contract['sent']} email terkirim, {contract['failed']} gagal, "
            f"{contract['inapp']} in-app."
        )
        self.stdout.write(
            f"Birthday: {birthday['due']} karyawan -> "
            f"{birthday['sent']} email terkirim, {birthday['failed']} gagal, "
            f"{birthday['inapp']} in-app."
        )
