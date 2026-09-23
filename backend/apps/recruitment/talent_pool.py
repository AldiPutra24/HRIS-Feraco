"""Freelance recruitment -> Freelance/Talent Pool bridge.

Accepts a freelance recruitment candidate into the EXISTING freelance module
(apps.freelance / Freelancer in apps.personnel). Dedup is by candidate email
against Freelancer personal_email/company_email. No Employee, User account,
or Onboarding is ever created here — that is the Inhouse path only.
"""

from django.db import transaction

from apps.audit.services import log_event
from apps.personnel.models import Freelancer

from .models import Candidate, CandidateStatusHistory


def _find_existing_freelancer(candidate: Candidate):
    """Match by email (personal/company) first, then phone/whatsapp."""
    email = (candidate.email or '').strip().lower()
    if email:
        existing = Freelancer.objects.filter(
            personal_email__iexact=email,
        ).first() or Freelancer.objects.filter(
            company_email__iexact=email,
        ).first()
        if existing:
            return existing
    phone = (candidate.phone or '').strip()
    if phone:
        return Freelancer.objects.filter(whatsapp=phone).first() or \
            Freelancer.objects.filter(phone=phone).first()
    return None


@transaction.atomic
def accept_candidate_to_talent_pool(candidate: Candidate, request):
    """Create or update the Freelancer record and mark the candidate accepted.

    Returns (freelancer, created).
    """
    existing = _find_existing_freelancer(candidate)
    defaults = {
        'full_name': candidate.full_name,
        'personal_email': candidate.email,
        'phone': candidate.phone or '',
        'whatsapp': candidate.phone or '',
    }
    # Map job location -> domicile and free-text position -> skill tag when available.
    job = candidate.job
    domicile = (job.location or '').strip()
    if domicile:
        defaults['domicile'] = domicile
    position_name = (job.position_text or (job.position.name if job.position else '') or '').strip()
    if existing:
        # Update only empty fields; do not overwrite curated data.
        for field, value in defaults.items():
            if not getattr(existing, field) and value:
                setattr(existing, field, value)
        existing.save()
        freelancer, created = existing, False
    else:
        freelancer = Freelancer.objects.create(**defaults)
        created = True

    # Map the job's position (free-text or FK name, e.g. 'MC') to a Skill tag so
    # the freelancer is searchable by role in the Talent Pool.
    if position_name:
        from apps.freelance.models import FreelancerSkill, Skill

        skill = Skill.objects.filter(name__iexact=position_name).first()
        if skill is None:
            skill = Skill.objects.create(name=position_name)
        FreelancerSkill.objects.get_or_create(freelancer=freelancer, skill=skill)

    # Move the CV into the freelancer's document list (metadata only; the
    # binary stays in the same recruitment-cvs bucket path).
    if candidate.cv_path:
        from apps.freelance.models import FreelancerDocument

        FreelancerDocument.objects.get_or_create(
            freelancer=freelancer,
            storage_path=candidate.cv_path,
            defaults={
                'doc_type': 'CV',
                'name': candidate.cv_name or f'CV {candidate.full_name}',
                'storage_path': candidate.cv_path,
                'content_type': candidate.cv_content_type or '',
            },
        )

    # Mark the candidate accepted (reuses the existing pipeline terminal state).
    if candidate.status != 'OFFER_ACCEPTED':
        CandidateStatusHistory.objects.create(
            candidate=candidate,
            from_status=candidate.status,
            to_status='OFFER_ACCEPTED',
            changed_by=request.user if request.user.is_authenticated else None,
            note='Accepted into Freelance / Talent Pool',
        )
        candidate.status = 'OFFER_ACCEPTED'
        candidate.save(update_fields=['status', 'updated_at'])

    action = 'create' if created else 'update'
    log_event(
        request,
        action if action != 'update' else 'update',
        obj=freelancer,
        description=(
            f'Freelance candidate "{candidate.full_name}" '
            + ('added to' if created else 'matched existing') +
            f' Talent Pool as "{freelancer.full_name}"'
        ),
    )
    return freelancer, created
