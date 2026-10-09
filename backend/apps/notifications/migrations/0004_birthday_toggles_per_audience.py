from django.db import migrations, models


def copy_to_employee(apps, schema_editor):
    """Keep current behavior: the old toggles drove both HR and employee."""
    NotificationSetting = apps.get_model('notifications', 'NotificationSetting')
    for s in NotificationSetting.objects.all():
        s.birthday_employee_h1_enabled = s.birthday_hr_h1_enabled
        s.birthday_employee_h0_enabled = s.birthday_hr_h0_enabled
        s.save(update_fields=['birthday_employee_h1_enabled', 'birthday_employee_h0_enabled'])


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0003_reimbursement_stage_events'),
    ]

    operations = [
        migrations.RenameField(
            model_name='notificationsetting',
            old_name='birthday_h1_enabled',
            new_name='birthday_hr_h1_enabled',
        ),
        migrations.RenameField(
            model_name='notificationsetting',
            old_name='birthday_h0_enabled',
            new_name='birthday_hr_h0_enabled',
        ),
        migrations.AddField(
            model_name='notificationsetting',
            name='birthday_employee_h1_enabled',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='notificationsetting',
            name='birthday_employee_h0_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(copy_to_employee, migrations.RunPython.noop),
    ]
