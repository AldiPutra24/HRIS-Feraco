from django.db import migrations


def _normalize_phone(value):
    # Same rule as recruitment.models.normalize_phone (historical models
    # cannot import model-module helpers safely, so it is repeated here).
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if digits.startswith('0'):
        digits = '62' + digits[1:]
    elif digits.startswith('8'):
        digits = '62' + digits
    return digits


def backfill_profiles(apps, schema_editor):
    """Group existing applications into Talent Pool profiles.

    One profile per email (case-insensitive); applications without an email
    fall back to the normalized phone. Profile contact data and CV come from
    the newest application. Statuses are NOT touched here (stage 2).
    Profiles are linked to an existing Freelancer (same email/phone rule as
    talent_pool._find_existing_freelancer) and to the Employee created by a
    completed Onboarding.
    """
    Candidate = apps.get_model('recruitment', 'Candidate')
    CandidateProfile = apps.get_model('recruitment', 'CandidateProfile')
    Freelancer = apps.get_model('personnel', 'Freelancer')
    Onboarding = apps.get_model('onboarding', 'Onboarding')

    groups = {}
    for cand in Candidate.objects.select_related('job').order_by('created_at', 'pk'):
        email = (cand.email or '').strip().lower()
        key = ('email', email) if email else ('phone', _normalize_phone(cand.phone) or f'id-{cand.pk}')
        groups.setdefault(key, []).append(cand)

    for apps_list in groups.values():
        newest = apps_list[-1]
        with_cv = [c for c in apps_list if c.cv_path]
        cv = with_cv[-1] if with_cv else None
        profile = CandidateProfile.objects.create(
            full_name=newest.full_name,
            email=(newest.email or '').strip(),
            phone=newest.phone or '',
            phone_normalized=_normalize_phone(newest.phone),
            cv_name=cv.cv_name if cv else '',
            cv_path=cv.cv_path if cv else '',
            cv_content_type=cv.cv_content_type if cv else '',
            consent_version='legacy',
        )
        CandidateProfile.objects.filter(pk=profile.pk).update(
            code=f'TP-{profile.pk:06d}', created_at=apps_list[0].created_at,
        )

        freelancer = None
        email = (newest.email or '').strip()
        if email:
            freelancer = (
                Freelancer.objects.filter(personal_email__iexact=email).first()
                or Freelancer.objects.filter(company_email__iexact=email).first()
            )
        phone = (newest.phone or '').strip()
        if freelancer is None and phone:
            freelancer = Freelancer.objects.filter(whatsapp=phone).first() or Freelancer.objects.filter(phone=phone).first()
        onboarding = (
            Onboarding.objects.filter(candidate__in=apps_list, employee__isnull=False).order_by('-pk').first()
        )
        CandidateProfile.objects.filter(pk=profile.pk).update(
            freelancer=freelancer, employee=onboarding.employee if onboarding else None,
        )

        for cand in apps_list:
            Candidate.objects.filter(pk=cand.pk).update(
                profile=profile, track=cand.job.recruitment_type or 'INHOUSE',
            )


def unlink_profiles(apps, schema_editor):
    Candidate = apps.get_model('recruitment', 'Candidate')
    CandidateProfile = apps.get_model('recruitment', 'CandidateProfile')
    Candidate.objects.update(profile=None, track='UNDECIDED')
    CandidateProfile.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('onboarding', '0004_onboardingdocument_rejection_reason'),
        ('personnel', '0017_employee_change_request'),
        ('recruitment', '0011_talent_pool_profile'),
    ]

    operations = [
        migrations.RunPython(backfill_profiles, unlink_profiles),
    ]
