from django.core.management.base import BaseCommand

from apps.reimbursement.models import ReimbursementCategory

CATEGORIES = [
    {'name': 'Transportasi', 'code': 'TRANSPORT', 'requires_attachment': True},
    {'name': 'Kesehatan', 'code': 'MEDICAL', 'requires_attachment': True},
    {'name': 'Makan', 'code': 'MEAL', 'requires_attachment': False},
    {'name': 'Akomodasi', 'code': 'LODGING', 'requires_attachment': True},
    {'name': 'Lainnya', 'code': 'OTHER', 'requires_attachment': False},
]


class Command(BaseCommand):
    help = 'Seed default reimbursement categories.'

    def handle(self, *args, **options):
        created = 0
        for data in CATEGORIES:
            _, was_created = ReimbursementCategory.objects.get_or_create(
                code=data['code'],
                defaults={**data, 'is_active': True},
            )
            created += int(was_created)
        self.stdout.write(self.style.SUCCESS(f'{created} reimbursement categories created.'))
