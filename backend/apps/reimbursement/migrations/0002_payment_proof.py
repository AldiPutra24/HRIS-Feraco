from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reimbursement', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='reimbursement',
            name='payment_proof_content_type',
            field=models.CharField(blank=True, max_length=128),
        ),
        migrations.AddField(
            model_name='reimbursement',
            name='payment_proof_name',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='reimbursement',
            name='payment_proof_path',
            field=models.CharField(blank=True, max_length=512),
        ),
    ]
