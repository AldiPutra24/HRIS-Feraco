"""Talent Pool stage 5: Talent Pool dashboard (PRD 5.8) and Recruitment
Pipeline dashboard (PRD 5.9). HR only.

Talent Pool numbers count unique people (CandidateProfile); pipeline numbers
count applications (Candidate) — PRD 5.8 requires the two to stay distinct.
"""

from collections import Counter
from datetime import date, timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Candidate, CandidateProfile
from .permissions import IsRecruitmentAdmin

ACTIVE_STATUSES = ['NEW', 'SCREENED', 'CONTACTED', 'HR_INTERVIEW', 'USER_INTERVIEW']
# Active applications untouched this long need a follow-up (PRD 5.9).
FOLLOW_UP_AFTER = timedelta(days=7)


def _date_param(request, key):
    try:
        return date.fromisoformat(request.query_params.get(key, ''))
    except ValueError:
        return None


def _rows(counter, labels):
    """[{key, label, count}] sorted by count desc, choice order as tie-break."""
    order = {k: i for i, k in enumerate(labels)}
    return [
        {'key': k, 'label': labels.get(k, k), 'count': n}
        for k, n in sorted(counter.items(), key=lambda kv: (-kv[1], order.get(kv[0], 99), str(kv[0])))
        if n
    ]


def _application_filter(request):
    q = Q()
    track = request.query_params.get('track')
    if track in ('INHOUSE', 'FREELANCE', 'UNDECIDED'):
        q &= Q(track=track)
    job = request.query_params.get('job')
    if job == 'open':
        q &= Q(job__isnull=True)
    elif (job or '').isdigit():
        q &= Q(job_id=int(job))
    return q


class TalentPoolDashboardView(APIView):
    """GET /api/recruitment/dashboard/talent-pool/?from=&to=&employment_type=&job=&track=

    ``from``/``to`` filter by registration date. ``job``/``track`` keep only
    people with a matching application (area of interest).
    """

    permission_classes = [IsRecruitmentAdmin]

    def get(self, request):
        profiles = CandidateProfile.objects.filter(anonymized_at__isnull=True)
        start, end = _date_param(request, 'from'), _date_param(request, 'to')
        if start:
            profiles = profiles.filter(created_at__date__gte=start)
        if end:
            profiles = profiles.filter(created_at__date__lte=end)
        etype = request.query_params.get('employment_type')
        if etype:
            profiles = profiles.filter(employment_types__icontains=f'"{etype}"')
        app_q = _application_filter(request)
        if app_q:
            profiles = profiles.filter(pk__in=Candidate.objects.filter(app_q).values('profile_id'))
        profiles = profiles.distinct()
        ids = list(profiles.values_list('pk', flat=True))
        # order_by(): drop Meta.ordering so GROUP BY / DISTINCT stay exact.
        apps = Candidate.objects.filter(profile_id__in=ids).order_by()
        if app_q:
            apps = apps.filter(app_q)

        employment = Counter()
        availability = Counter()
        source = Counter()
        for types, avail, src in profiles.order_by().values_list('employment_types', 'availability', 'source_reported'):
            employment.update(set(types or []))
            availability[avail or 'UNKNOWN'] += 1
            source[src or 'UNKNOWN'] += 1

        # Area of interest = vacancy applied for; one person counts once per area.
        interest = Counter()
        for title in apps.values('profile_id', 'job__title').distinct().values_list('job__title', flat=True):
            interest[title or 'Open Application'] += 1

        months = (
            profiles.annotate(month=TruncMonth('created_at')).values('month')
            .annotate(n=Count('pk')).order_by('month')
        )
        qualified = apps.filter(screening_result='QUALIFIED').values('profile_id').distinct().count()
        # Available for future opportunities: consent kept, nothing in
        # progress and never hired.
        busy = apps.filter(Q(status__in=ACTIVE_STATUSES) | Q(status='HIRED')).values('profile_id')
        available = profiles.filter(consent_withdrawn_at__isnull=True).exclude(pk__in=busy).count()

        unknown = {'UNKNOWN': 'Tidak diisi'}
        return Response({
            'total_profiles': len(ids),
            'total_applications': apps.count(),
            'qualified_profiles': qualified,
            'available_profiles': available,
            'by_employment_type': _rows(employment, dict(CandidateProfile.EMPLOYMENT_TYPES)),
            'by_interest': _rows(interest, {}),
            'by_source': _rows(source, {**dict(CandidateProfile.SOURCE_CHOICES), **unknown}),
            'by_availability': _rows(availability, {**dict(CandidateProfile.AVAILABILITY_CHOICES), **unknown}),
            'by_month': [{'month': m['month'].date().isoformat()[:7], 'count': m['n']} for m in months if m['month']],
        })


class PipelineDashboardView(APIView):
    """GET /api/recruitment/dashboard/pipeline/?track=&job=  (applications)."""

    permission_classes = [IsRecruitmentAdmin]

    def get(self, request):
        apps = Candidate.objects.filter(_application_filter(request)).order_by()
        stage = Counter(dict(apps.values_list('status').annotate(n=Count('pk'))))
        follow_up = apps.filter(
            status__in=['NEW', 'SCREENED', 'CONTACTED'], updated_at__lt=timezone.now() - FOLLOW_UP_AFTER,
        ).select_related('job').order_by('updated_at')

        by_position = {}
        for title, track, st, n in (
            apps.values_list('job__title', 'track', 'status').annotate(n=Count('pk')).order_by()
        ):
            key = (title or 'Open Application', track)
            row = by_position.setdefault(key, {'position': key[0], 'track': track, 'total': 0, 'statuses': {}})
            row['statuses'][st] = row['statuses'].get(st, 0) + n
            row['total'] += n

        labels = dict(Candidate.STATUS_CHOICES)
        return Response({
            'total_applications': apps.count(),
            'by_stage': [{'key': s, 'label': labels[s], 'count': stage.get(s, 0)} for s, _ in Candidate.STATUS_CHOICES],
            'hr_interview': stage.get('HR_INTERVIEW', 0),
            'user_interview': stage.get('USER_INTERVIEW', 0),
            'hired': stage.get('HIRED', 0),
            'awaiting_follow_up': follow_up.count(),
            'follow_up': [
                {
                    'id': c.id, 'full_name': c.full_name, 'status': c.status,
                    'position': c.job.title if c.job_id else 'Open Application', 'updated_at': c.updated_at,
                }
                for c in follow_up[:10]
            ],
            'by_source': _rows(Counter(dict(apps.values_list('source').annotate(n=Count('pk')))),
                               dict(Candidate.SOURCE_CHOICES)),
            'by_position': sorted(by_position.values(), key=lambda r: -r['total']),
        })
