from django.db import migrations
from django.utils import timezone


def convert_forms_to_jobs(apps, schema_editor):
    """Consolidate freelance intake into Job Freelance.

    Each FreelanceApplyForm becomes its internal `portal-<slug>` Job (the job
    its candidates were already filed under): the form's Skills are copied to
    Job.skills, an active form keeps the job OPEN (public at
    /jobs/portal-<slug>), an inactive one closes it. Forms are only
    deactivated — never deleted — so applicant history stays intact.
    """
    Form = apps.get_model('recruitment', 'FreelanceApplyForm')
    Job = apps.get_model('recruitment', 'Job')
    for form in Form.objects.all():
        job, created = Job.objects.get_or_create(
            slug=f'portal-{form.slug}',
            defaults={
                'title': form.title,
                'position_text': form.title,
                'description': form.description,
                'employment_type': 'FREELANCE',
                'recruitment_type': 'FREELANCE',
                'open_date': timezone.localdate(),
                'status': 'OPEN' if form.is_active else 'CLOSED',
            },
        )
        job.skills.add(*form.skills.all())
        names = ', '.join(s.name for s in job.skills.order_by('name'))
        if names:
            job.position_text = names[:255]
        if not job.description:
            job.description = form.description
        if not form.is_active and job.status == 'OPEN':
            job.status = 'CLOSED'
        job.save()
        if form.is_active:
            form.is_active = False
            form.save(update_fields=['is_active'])


class Migration(migrations.Migration):

    dependencies = [
        ('recruitment', '0009_job_skills'),
    ]

    operations = [
        migrations.RunPython(convert_forms_to_jobs, migrations.RunPython.noop),
    ]
