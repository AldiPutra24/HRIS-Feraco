from django.core.management.base import BaseCommand

from apps.accounts.models import Role

ROLES = {
    'ADMIN': 'Admin',
    'HR_STAFF': 'HR Staff',
    'HR_LEAD': 'HR Lead',
    'EMPLOYEE': 'Employee',
    'MANAGEMENT': 'Management',
    'GENERAL_MANAGER': 'General Manager',
}


class Command(BaseCommand):
    help = 'Seed default roles and a demo admin user.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            default='password',
            help='Initial password for the demo admin, used only when it is created (default: password).',
        )

    def handle(self, *args, **options):
        for key, name in ROLES.items():
            _, created = Role.objects.get_or_create(key=key, defaults={'name': name})
            self.stdout.write(f'{"created" if created else "exists"}: role {key}')

        from apps.accounts.models import User

        password = options['password']
        user, created = User.objects.get_or_create(
            username='admin@feraco.id',
            defaults={'email': 'admin@feraco.id', 'is_staff': True, 'is_superuser': True},
        )
        # Runs on every container start: set the password ONLY when the admin
        # is first created — never overwrite a password changed afterwards.
        if created:
            user.set_password(password)
        user.role = Role.objects.get(key='ADMIN')
        user.save()
        self.stdout.write(f'{"created" if created else "updated"}: admin@feraco.id')
