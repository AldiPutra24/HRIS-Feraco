from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audit', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='action',
            field=models.CharField(choices=[('login', 'Login'), ('logout', 'Logout'), ('create', 'Create'), ('update', 'Update'), ('delete', 'Delete'), ('approve', 'Approve'), ('reject', 'Reject'), ('activate', 'Activate'), ('terminate', 'Terminate'), ('renew', 'Renew'), ('upload', 'Upload'), ('download', 'Download'), ('permission_change', 'Permission Change'), ('role_change', 'Role Change')], max_length=32),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='changes_after',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='changes_before',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='metadata',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='auditlog',
            name='user_agent',
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
