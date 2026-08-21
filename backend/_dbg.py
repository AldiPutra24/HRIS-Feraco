import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.test import Client
from apps.accounts.models import User
u = User.objects.filter(is_superuser=True).first()
c = Client(SERVER_NAME='localhost')
c.force_login(u)
r = c.get('/api/leaves/types/')
print('status:', r.status_code)
print('body:', r.content[:200])
