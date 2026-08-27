from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.personnel.models import Department, Employee, Position

EMPLOYEES = [
    {
        'employee_id': 'EMP-0001',
        'full_name': 'Budi Santoso',
        'nik': '3273010101900001',
        'birth_place': 'Jakarta',
        'birth_date': '1990-01-01',
        'address': 'Jl. Merdeka No. 1, Jakarta',
        'phone': '081234567890',
        'personal_email': 'budi.santoso@example.com',
        'emergency_contact_name': 'Siti Rahayu',
        'emergency_contact_phone': '081298765432',
        'bank_account_number': '1234567890',
        'bank_account_name': 'Budi Santoso',
        'npwp': '123456789012345',
        'bpjs_kesehatan': '0001234567890',
        'bpjs_ketenagakerjaan': '123456789012',
        'department': 'Production',
        'position': 'Graphic Designer',
        'join_date': '2021-03-15',
        'employment_status': 'ACTIVE',
    },
    {
        'employee_id': 'EMP-0002',
        'full_name': 'Dewi Lestari',
        'nik': '3273020202950002',
        'birth_place': 'Bandung',
        'birth_date': '1995-02-02',
        'address': 'Jl. Asia Afrika No. 2, Bandung',
        'phone': '082198765432',
        'personal_email': 'dewi.lestari@example.com',
        'emergency_contact_name': 'Agus Wijaya',
        'emergency_contact_phone': '082112345678',
        'bank_account_number': '0987654321',
        'bank_account_name': 'Dewi Lestari',
        'npwp': '987654321098765',
        'bpjs_kesehatan': '0009876543210',
        'bpjs_ketenagakerjaan': '987654321098',
        'department': 'Sales',
        'position': 'Sales Account Executive',
        'join_date': '2022-07-01',
        'employment_status': 'ACTIVE',
    },
]


class Command(BaseCommand):
    help = 'Seed 2 test employees. Idempotent.'

    def handle(self, *args, **options):
        created = 0
        for data in EMPLOYEES:
            dept = Department.objects.get(name=data.pop('department'))
            pos = Position.objects.get(name=data.pop('position'), department=dept)
            _, was_created = Employee.objects.get_or_create(
                employee_id=data['employee_id'],
                defaults={**data, 'department': dept, 'position': pos},
            )
            created += was_created
            self.stdout.write(f'{"created" if was_created else "exists"}: {data["employee_id"]} {data["full_name"]}')

        self.stdout.write(self.style.SUCCESS(f'Employees seeded. {created} new, total={Employee.objects.count()}.'))