from django.core.management.base import BaseCommand
from django.conf import settings

from apps.personnel.models import Department, Position

# Org tree: {department: {code, positions: [(code, name, parent_code_or_None)]}}.
# Position parent referenced by code; None = top of that department.
ORG = {
    'Board of Directors': {
        'code': 'BOD',
        'positions': [
            ('DUN', 'Direktur Utama', None),
            ('DK', 'Direktur Keuangan', 'DUN'),
        ],
    },
    'General Management': {
        'code': 'GM',
        'positions': [
            ('GM', 'General Manager', None),
        ],
    },
    'Production': {
        'code': 'PROD',
        'positions': [
            ('PM', 'Project Manager', None),
            ('GD', 'Graphic Designer', 'PM'),
            ('PO', 'Project Officer', 'PM'),
        ],
    },
    'Sales': {
        'code': 'SALES',
        'positions': [
            ('SS', 'Sales Supervisor', None),
            ('SAE', 'Sales Account Executive', 'SS'),
            ('SSS', 'Sales Support Specialist', 'SS'),
        ],
    },
    'Marketing': {
        'code': 'MKT',
        'positions': [
            ('CMSL', 'Creative Marketing Strategist Lead', None),
            ('CMSO', 'Creative Marketing Strategist Officer', 'CMSL'),
        ],
    },
    'HR & Finance': {
        'code': 'HRFIN',
        'positions': [
            ('HRGA', 'HRGA Officer', None),
            ('GA', 'GA Support', 'HRGA'),
            ('FATS', 'FAT Supervisor', None),
            ('FATO', 'FAT Officer', 'FATS'),
            ('FATA', 'FAT Admin', 'FATO'),
            ('TAX', 'Tax Officer', None),
        ],
    },
    'IT Support': {
        'code': 'IT',
        'positions': [
            ('IT', 'IT Support', None),
        ],
    },
}


class Command(BaseCommand):
    help = 'Seed organization structure (departments + positions + reporting hierarchy). Idempotent.'

    def handle(self, *args, **options):
        if settings.APP_ENV == 'production':
            self.stdout.write(self.style.WARNING('ENV = production. Summary of planned data:'))

        # Print planned tree first.
        for dept_name, cfg in ORG.items():
            self.stdout.write(f'  {dept_name} ({cfg["code"]})')
            for code, name, parent in cfg['positions']:
                suffix = f' -> {parent}' if parent else ''
                self.stdout.write(f'    - {name} [{code}]{suffix}')

        created_depts = 0
        created_pos = 0
        linked = 0

        for dept_name, cfg in ORG.items():
            dept, dept_created = Department.objects.get_or_create(
                name=dept_name,
                defaults={'code': cfg['code'], 'is_active': True},
            )
            if dept_created:
                created_depts += 1
                self.stdout.write(f'created: department {dept_name}')
            else:
                self.stdout.write(f'exists: department {dept_name}')

            by_code = {}
            for code, name, parent_code in cfg['positions']:
                pos, created = Position.objects.get_or_create(
                    name=name,
                    department=dept,
                    defaults={'code': code, 'is_active': True},
                )
                if created:
                    created_pos += 1
                    self.stdout.write(f'created: position {name}')
                else:
                    self.stdout.write(f'exists: position {name}')
                by_code[code] = pos

            for code, name, parent_code in cfg['positions']:
                if parent_code is None:
                    continue
                pos = by_code[code]
                parent = by_code[parent_code]
                if pos.parent_position_id != parent.id:
                    pos.parent_position = parent
                    pos.save(update_fields=['parent_position', 'updated_at'])
                    linked += 1
                    self.stdout.write(f'linked: {name} -> {parent.name}')

        self.stdout.write(self.style.SUCCESS(
            f'Organization structure seeded. '
            f'departments={Department.objects.count()} ({created_depts} new), '
            f'positions={Position.objects.count()} ({created_pos} new), '
            f'{linked} parent links set.'
        ))
