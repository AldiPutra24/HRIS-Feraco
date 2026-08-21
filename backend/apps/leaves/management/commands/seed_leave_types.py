from django.core.management.base import BaseCommand

from apps.leaves.models import LeaveType

LEAVE_TYPES = [
    ('ANNUAL', 'Cuti Tahunan'),
    ('SICK', 'Cuti Sakit'),
    ('MATERNITY', 'Cuti Melahirkan'),
    ('PATERNITY', 'Cuti Paternity'),
    ('MARRIAGE', 'Cuti Menikah'),
    ('BEREAVEMENT', 'Cuti Duka'),
    ('UNPAID', 'Cuti Tanpa Gaji'),
]

class Command(BaseCommand):
    help = 'Seed default active leave types (idempotent).'

    def handle(self, *args, **options):
        for code, name in LEAVE_TYPES:
            _, created = LeaveType.objects.get_or_create(
                code=code, defaults={'name': name, 'is_active': True}
            )
            self.stdout.write(f'{"created" if created else "exists"}: {code}')
