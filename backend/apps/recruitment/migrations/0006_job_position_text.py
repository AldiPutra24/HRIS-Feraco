from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('recruitment', '0005_job_recruitment_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='job',
            name='position_text',
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
