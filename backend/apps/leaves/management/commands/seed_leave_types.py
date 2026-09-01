from django.core.management.base import BaseCommand

from apps.leaves.models import LeaveType

LEAVE_TYPES = [
    ('ANNUAL', 'Cuti Tahunan', 'LEAVE'),
    ('MATERNITY', 'Cuti Melahirkan', 'LEAVE'),
    ('MARRIAGE', 'Cuti Menikah', 'LEAVE'),
    ('MISCARRIAGE', 'Cuti Keguguran', 'LEAVE'),
    ('MEDICAL', 'Cuti Berobat', 'LEAVE'),
    ('VACCINE', 'Cuti Vaksin', 'LEAVE'),
    ('PATERNITY', 'Cuti Paternity', 'LEAVE'),
    ('CHILD_CIRCUMCISION', 'Cuti Anak Karyawan Khitan', 'LEAVE'),
    ('SPECIAL', 'Cuti Special Leave', 'LEAVE'),
]

PERMISSION_TYPES = [
    ('SICK', 'Izin Sakit', 'PERMISSION'),
    ('FAMILY', 'Izin Kepentingan Keluarga', 'PERMISSION'),
    ('PERSONAL', 'Izin Pribadi', 'PERMISSION'),
    ('LATE', 'Izin Keterlambatan', 'PERMISSION'),
]


class Command(BaseCommand):
    help = 'Seed default leave/permission categories (idempotent).'

    def handle(self, *args, **options):
        for code, name, kind in LEAVE_TYPES + PERMISSION_TYPES:
            obj, created = LeaveType.objects.get_or_create(
                code=code, defaults={'name': name, 'kind': kind, 'is_active': True}
            )
            if not created:
                changed = []
                if obj.name != name:
                    obj.name = name
                    changed.append('name')
                if obj.kind != kind:
                    obj.kind = kind
                    changed.append('kind')
                if changed:
                    obj.save(update_fields=changed)
                    self.stdout.write(f'updated: {code} ({", ".join(changed)})')
                else:
                    self.stdout.write(f'exists: {code}')
            else:
                self.stdout.write(f'created: {code}')
