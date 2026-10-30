import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('recruitment', '0012_backfill_candidate_profiles'),
    ]

    operations = [
        migrations.AlterField(
            model_name='candidate',
            name='profile',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='applications',
                to='recruitment.candidateprofile',
            ),
        ),
    ]
