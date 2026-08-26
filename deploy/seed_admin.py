from apps.accounts.models import User, Role

role, _ = Role.objects.get_or_create(key='ADMIN', defaults={'name': 'Admin'})
u = User.objects.filter(email='admin@feraco.id').first()
if u is None:
    u = User.objects.create_user(
        username='admin',
        email='admin@feraco.id',
        password='password',
        role=role,
        is_staff=True,
        is_superuser=True,
    )
    print('created admin@feraco.id')
else:
    print('admin exists, id=', u.pk)
print('role=', role.key)
print('total users=', User.objects.count())
