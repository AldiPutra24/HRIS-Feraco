from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.audit.services import log_event
from apps.leaves.models import LeaveType
from apps.leaves.services import format_days, recompute_allocation, tracks_quota
from apps.personnel.models import Employee


class Command(BaseCommand):
    help = (
        'Re-sync leave quota allocations with the current policy and data '
        '(join date, contracts, carry-forward). Usage and HR adjustments are kept.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--year', type=int, default=None, help='Year to recompute (default: current year).')
        parser.add_argument('--employee', type=int, action='append', default=None,
                            help='Employee PK (repeatable). Default: all ACTIVE employees.')
        parser.add_argument('--dry-run', action='store_true', help='Show changes without saving.')

    def handle(self, *args, **opts):
        year = opts['year'] or timezone.localdate().year
        if not 2000 <= year <= 2100:
            raise CommandError('Tahun tidak valid.')
        employees = Employee.objects.order_by('full_name', 'id')
        if opts['employee']:
            employees = employees.filter(pk__in=opts['employee'])
        else:
            employees = employees.filter(employment_status='ACTIVE')
        types = [t for t in LeaveType.objects.filter(is_active=True).order_by('name') if tracks_quota(t)]
        dry = opts['dry_run']
        changed = 0
        self.stdout.write(f'{"DRY RUN — " if dry else ""}Recompute leave quota {year}')
        for emp in employees:
            for lt in types:
                before, after = recompute_allocation(emp, lt, year, dry_run=dry)
                if before == after:
                    continue
                changed += 1
                self.stdout.write(
                    f'  {emp.full_name} [{lt.code}]: {format_days(before)} -> {format_days(after)}'
                )
                if not dry:
                    log_event(
                        None, 'update', obj=None,
                        description=(
                            f'Leave quota recomputed {lt.code} {year} for {emp.full_name}: '
                            f'{format_days(before)} -> {format_days(after)}'
                        ),
                        changes_before={'allocated_days': str(before)},
                        changes_after={'allocated_days': str(after)},
                    )
        self.stdout.write(f'{changed} balance(s) {"would change" if dry else "updated"}.')
