from django.db import migrations
from django.db.models import Q

# Kept in sync with services.DISCONTINUED_LEAVE_CODES / _NAMES. Rows are only
# deactivated (never deleted) so historical requests/balances stay intact.
CODES = ['UNPAID']
NAMES = ['Cuti Tanpa Gaji', 'Cuti Tidak Berbayar']


def deactivate(apps, schema_editor):
    LeaveType = apps.get_model('leaves', 'LeaveType')
    q = Q(code__in=CODES)
    for name in NAMES:
        q |= Q(name__iexact=name)
    LeaveType.objects.filter(q).update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ('leaves', '0005_leaverequestdate'),
    ]

    operations = [
        migrations.RunPython(deactivate, migrations.RunPython.noop),
    ]
