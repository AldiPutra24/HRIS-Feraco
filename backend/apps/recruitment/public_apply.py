"""Unified public application form (Talent Pool stage 3, PRD 5.1).

One form for in-house AND freelance candidates, for an open vacancy or an
Open Application (no job). Creates/updates the person's CandidateProfile
(same email -> same profile) and one Candidate (application) row.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import Candidate, CandidateProfile, CandidateSkill, Job

# Bump when the consent wording shown on the form changes.
CONSENT_VERSION = 'v1-2026-10-30'
CONSENT_TEXT = (
    'I confirm that the information provided is accurate and consent to PT Fery Agung Corindotama '
    'processing my personal data for recruitment and candidate talent pool management purposes, '
    "in accordance with applicable data protection regulations and the company's privacy notice."
)

# ?ref=<channel> on the form link -> Candidate.source (internal source).
REF_SOURCES = {'linkedin', 'jobstreet', 'threads', 'instagram', 'website', 'referral'}


def ref_to_source(ref) -> str:
    ref = (ref or '').strip().lower()
    return ref.upper() if ref in REF_SOURCES else 'PORTAL'


class PublicApplySerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=32)
    city = serializers.CharField(max_length=128)
    linkedin_url = serializers.URLField(max_length=500, required=False, allow_blank=True)
    job = serializers.IntegerField(required=False, allow_null=True)
    skill_id = serializers.IntegerField(required=False, allow_null=True)
    employment_types = serializers.ListField(
        child=serializers.ChoiceField(choices=CandidateProfile.EMPLOYMENT_TYPES), allow_empty=False,
    )
    preferred_location = serializers.ChoiceField(choices=CandidateProfile.LOCATION_CHOICES)
    preferred_location_other = serializers.CharField(max_length=128, required=False, allow_blank=True)
    employment_status = serializers.ChoiceField(choices=CandidateProfile.EMPLOYMENT_STATUS_CHOICES)
    employment_status_other = serializers.CharField(max_length=128, required=False, allow_blank=True)
    availability = serializers.ChoiceField(choices=CandidateProfile.AVAILABILITY_CHOICES)
    portfolio_url = serializers.URLField(max_length=500, required=False, allow_blank=True)
    expected_monthly_salary = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=0, required=False, allow_null=True,
    )
    expected_project_fee = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=0, required=False, allow_null=True,
    )
    source_reported = serializers.ChoiceField(choices=CandidateProfile.SOURCE_CHOICES)
    source_other = serializers.CharField(max_length=255, required=False, allow_blank=True)
    consent = serializers.BooleanField()
    ref = serializers.CharField(max_length=32, required=False, allow_blank=True)

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Full name is required.')
        return value

    def validate_consent(self, value):
        if value is not True:
            raise serializers.ValidationError('Consent is required to submit the application.')
        return value

    def validate(self, attrs):
        for choice, other in (
            ('preferred_location', 'preferred_location_other'),
            ('employment_status', 'employment_status_other'),
            ('source_reported', 'source_other'),
        ):
            if attrs.get(choice) == 'OTHER' and not (attrs.get(other) or '').strip():
                raise serializers.ValidationError({other: 'Please specify.'})
        job = None
        if attrs.get('job'):
            job = Job.objects.filter(pk=attrs['job']).first()
            if job is None or not job.is_open():
                raise serializers.ValidationError({'job': 'This position is no longer accepting applications.'})
        attrs['job'] = job
        attrs['skill'] = None
        if job is not None and job.recruitment_type == 'FREELANCE':
            options = job.skills.filter(is_active=True)
            if options.exists():
                skill = options.filter(pk=attrs.get('skill_id')).first() if attrs.get('skill_id') else None
                if skill is None:
                    raise serializers.ValidationError({'skill_id': 'Choose one of the available roles.'})
                attrs['skill'] = skill
        return attrs


PROFILE_FIELDS = (
    'city', 'linkedin_url', 'portfolio_url', 'employment_types',
    'preferred_location', 'preferred_location_other', 'employment_status', 'employment_status_other',
    'availability', 'expected_monthly_salary', 'expected_project_fee', 'source_reported', 'source_other',
)


@transaction.atomic
def create_public_application(data):
    """Create the application and refresh the profile with the latest answers."""
    profile = CandidateProfile.match_or_create(data['full_name'], data['email'], data['phone'])
    profile.full_name = data['full_name']
    profile.phone = data['phone']
    for field in PROFILE_FIELDS:
        value = data.get(field)
        if value is None:
            value = None if field.startswith('expected_') else ''
        setattr(profile, field, value)
    profile.consent_at = timezone.now()
    profile.consent_version = CONSENT_VERSION
    profile.consent_withdrawn_at = None
    profile.save()

    candidate = Candidate.objects.create(
        profile=profile,
        job=data['job'],
        full_name=data['full_name'],
        email=data['email'],
        phone=data['phone'],
        source=ref_to_source(data.get('ref')),
        employment_types=data['employment_types'],
    )
    if data.get('skill') is not None:
        CandidateSkill.objects.create(candidate=candidate, skill=data['skill'])
    return candidate
