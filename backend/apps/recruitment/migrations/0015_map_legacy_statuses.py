from django.db import migrations

# Decision #7 (talentpool.md): old pipeline status -> (PRD status, inactive reason).
STATUS_MAP = {
    'APPLIED': ('NEW', ''),
    'SCREENING': ('SCREENED', ''),
    'INTERVIEW_HR': ('HR_INTERVIEW', ''),
    'INTERVIEW_USER': ('USER_INTERVIEW', ''),
    'INTERVIEW_GM': ('USER_INTERVIEW', ''),
    'OFFERING': ('USER_INTERVIEW', ''),
    'OFFER_ACCEPTED': ('HIRED', ''),
    'REJECTED': ('INACTIVE', 'NOT_QUALIFIED'),
    'WITHDRAWN': ('INACTIVE', 'CANDIDATE_WITHDREW'),
}


def map_statuses(apps, schema_editor):
    """Move applications to the PRD statuses, keeping the old value in
    legacy_status. CandidateStatusHistory is left untouched so the history
    still shows what really happened (e.g. "Interview GM")."""
    Candidate = apps.get_model('recruitment', 'Candidate')
    for old, (new, reason) in STATUS_MAP.items():
        Candidate.objects.filter(status=old).update(status=new, inactive_reason=reason, legacy_status=old)


def restore_statuses(apps, schema_editor):
    Candidate = apps.get_model('recruitment', 'Candidate')
    for old in STATUS_MAP:
        Candidate.objects.filter(legacy_status=old).update(status=old, inactive_reason='', legacy_status='')
    # Applications created after the switch have no legacy value.
    reverse = {'NEW': 'APPLIED', 'SCREENED': 'SCREENING', 'CONTACTED': 'SCREENING',
               'HR_INTERVIEW': 'INTERVIEW_HR', 'USER_INTERVIEW': 'INTERVIEW_USER',
               'HIRED': 'OFFER_ACCEPTED', 'INACTIVE': 'REJECTED'}
    for new, old in reverse.items():
        Candidate.objects.filter(status=new, legacy_status='').update(status=old)


class Migration(migrations.Migration):

    dependencies = [
        ('recruitment', '0014_prd_status_screening_interview'),
    ]

    operations = [
        migrations.RunPython(map_statuses, restore_statuses),
    ]
