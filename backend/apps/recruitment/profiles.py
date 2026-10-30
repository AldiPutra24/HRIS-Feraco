"""Talent Pool stage 4: HR API over CandidateProfile (PRD 5.2, 5.7, 5.13).

List/search/filter people, view a profile with its applications, edit
contact/preference data, merge duplicates, start a new application for an
existing profile, and anonymize a profile on consent withdrawal.
"""

from datetime import timedelta

from django.db import models, transaction
from django.db.models import Count, Max
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.permissions import _role

from .models import Candidate, CandidateProfile, Job
from .permissions import IsRecruitmentAdmin

# Decision 2026-10-30: profiles idle this long show up as "Perlu ditinjau".
RETENTION_REVIEW_AFTER = timedelta(days=730)
ANONYMIZE_ROLES = {'ADMIN', 'HR_LEAD'}


class ProfileApplicationSerializer(serializers.ModelSerializer):
    job_title = serializers.CharField(source='job.title', read_only=True, default=None)

    class Meta:
        model = Candidate
        fields = ('id', 'job', 'job_title', 'track', 'status', 'inactive_reason', 'source', 'created_at', 'updated_at')


class CandidateProfileListSerializer(serializers.ModelSerializer):
    applications_count = serializers.IntegerField(read_only=True)
    last_activity = serializers.DateTimeField(read_only=True)
    latest_application = serializers.SerializerMethodField()
    possible_duplicate_code = serializers.CharField(source='possible_duplicate_of.code', read_only=True, default=None)

    class Meta:
        model = CandidateProfile
        fields = (
            'id', 'code', 'full_name', 'email', 'phone', 'city', 'employment_types', 'preferred_location',
            'employment_status', 'availability', 'source_reported', 'possible_duplicate_of',
            'possible_duplicate_code', 'freelancer', 'employee', 'consent_at', 'consent_withdrawn_at',
            'anonymized_at', 'applications_count', 'last_activity', 'latest_application', 'created_at', 'updated_at',
        )

    def get_latest_application(self, obj):
        app = obj.applications.select_related('job').order_by('-created_at').first()
        return ProfileApplicationSerializer(app).data if app else None


class CandidateProfileSerializer(CandidateProfileListSerializer):
    applications = serializers.SerializerMethodField()
    cv_url = serializers.SerializerMethodField()

    class Meta(CandidateProfileListSerializer.Meta):
        fields = CandidateProfileListSerializer.Meta.fields + (
            'linkedin_url', 'portfolio_url', 'preferred_location_other', 'employment_status_other',
            'expected_monthly_salary', 'expected_project_fee', 'source_other', 'consent_version',
            'cv_name', 'cv_url', 'applications',
        )
        read_only_fields = (
            'id', 'code', 'possible_duplicate_of', 'freelancer', 'employee', 'consent_at', 'consent_version',
            'consent_withdrawn_at', 'anonymized_at', 'cv_name', 'created_at', 'updated_at',
        )

    def get_applications(self, obj):
        apps = obj.applications.select_related('job').order_by('-created_at')
        return ProfileApplicationSerializer(apps, many=True).data

    def get_cv_url(self, obj):
        request = self.context.get('request')
        if not obj.cv_path or request is None:
            return None
        return request.build_absolute_uri(f'/api/recruitment/talent-pool/{obj.id}/cv/')


def _merge_into(source, target):
    """Move every application of ``source`` to ``target`` and fill target's
    empty fields from source, then delete source."""
    copy_fields = [
        'phone', 'city', 'linkedin_url', 'portfolio_url', 'preferred_location', 'preferred_location_other',
        'employment_status', 'employment_status_other', 'availability', 'source_reported', 'source_other',
        'cv_name', 'cv_path', 'cv_content_type', 'freelancer', 'employee', 'consent_at', 'consent_version',
        'expected_monthly_salary', 'expected_project_fee',
    ]
    for field in copy_fields:
        if not getattr(target, field) and getattr(source, field):
            setattr(target, field, getattr(source, field))
    target.employment_types = sorted(set(target.employment_types or []) | set(source.employment_types or []))
    if target.possible_duplicate_of_id == source.pk:
        target.possible_duplicate_of = None
    target.save()
    source.applications.update(profile=target)
    CandidateProfile.objects.filter(possible_duplicate_of=source).exclude(pk=target.pk).update(
        possible_duplicate_of=target,
    )
    source.delete()


class CandidateProfileViewSet(viewsets.ModelViewSet):
    """/api/recruitment/talent-pool/ — HR only (decided 2026-10-30)."""

    permission_classes = [IsRecruitmentAdmin]
    http_method_names = ['get', 'patch', 'post', 'head', 'options']
    search_fields = ['code', 'full_name', 'email', 'phone', 'city']

    def get_serializer_class(self):
        return CandidateProfileListSerializer if self.action == 'list' else CandidateProfileSerializer

    def get_queryset(self):
        qs = CandidateProfile.objects.select_related('possible_duplicate_of').annotate(
            applications_count=Count('applications', distinct=True),
            last_activity=Greatest('updated_at', Coalesce(Max('applications__updated_at'), 'updated_at')),
        ).order_by('-last_activity', '-pk')
        p = self.request.query_params
        for field in ('availability', 'preferred_location', 'employment_status', 'source_reported'):
            if p.get(field):
                qs = qs.filter(**{field: p[field]})
        if p.get('employment_type'):
            # JSON list stored as text on every backend: match the quoted key.
            qs = qs.filter(employment_types__icontains=f'"{p["employment_type"]}"')
        if p.get('location'):
            qs = qs.filter(
                models.Q(city__icontains=p['location']) | models.Q(preferred_location_other__icontains=p['location'])
            )
        if p.get('status'):
            qs = qs.filter(applications__status=p['status'])
        if p.get('track'):
            qs = qs.filter(applications__track=p['track'])
        if p.get('job') == 'open':
            qs = qs.filter(applications__job__isnull=True)
        elif (p.get('job') or '').isdigit():
            qs = qs.filter(applications__job_id=int(p['job']))
        if p.get('registered_from'):
            qs = qs.filter(created_at__date__gte=p['registered_from'])
        if p.get('registered_to'):
            qs = qs.filter(created_at__date__lte=p['registered_to'])
        if p.get('duplicates') == '1':
            qs = qs.filter(possible_duplicate_of__isnull=False)
        if p.get('needs_review') == '1':
            qs = qs.filter(last_activity__lt=timezone.now() - RETENTION_REVIEW_AFTER, anonymized_at__isnull=True)
        return qs.distinct()

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Profil Talent Pool {obj.code} diperbarui')

    def create(self, request, *args, **kwargs):
        return Response({'detail': 'Profil dibuat lewat form lamaran.'}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def _anonymized_guard(self, obj):
        if obj.anonymized_at:
            return Response({'detail': 'Profil ini sudah dianonimkan.'}, status=status.HTTP_400_BAD_REQUEST)
        return None

    @action(detail=True, methods=['post'])
    def merge(self, request, pk=None):
        """Merge this (duplicate) profile into ``into``; applications move over."""
        source = self.get_object()
        into = str(request.data.get('into') or '')
        target = CandidateProfile.objects.filter(pk=into).first() if into.isdigit() else None
        if target is None or target.pk == source.pk:
            return Response({'into': ['Pilih profil tujuan yang berbeda.']}, status=status.HTTP_400_BAD_REQUEST)
        if source.anonymized_at or target.anonymized_at:
            return Response({'detail': 'Profil yang dianonimkan tidak dapat digabung.'}, status=status.HTTP_400_BAD_REQUEST)
        code = source.code
        with transaction.atomic():
            _merge_into(source, target)
        log_event(request, 'update', obj=target, description=f'Profil {code} digabung ke {target.code}')
        target = self.get_queryset().get(pk=target.pk)
        return Response(CandidateProfileSerializer(target, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='not-duplicate')
    def not_duplicate(self, request, pk=None):
        obj = self.get_object()
        obj.possible_duplicate_of = None
        obj.save(update_fields=['possible_duplicate_of', 'updated_at'])
        log_event(request, 'update', obj=obj, description=f'Profil {obj.code} ditandai bukan duplikat')
        return Response(CandidateProfileSerializer(self.get_queryset().get(pk=obj.pk), context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def applications(self, request, pk=None):
        """HR sourcing: consider an existing profile for a (new) vacancy."""
        obj = self.get_object()
        blocked = self._anonymized_guard(obj)
        if blocked:
            return blocked
        job = None
        job_id = str(request.data.get('job') or '')
        if job_id:
            job = Job.objects.filter(pk=job_id).first() if job_id.isdigit() else None
            if job is None:
                return Response({'job': ['Lowongan tidak ditemukan.']}, status=status.HTTP_400_BAD_REQUEST)
            if obj.applications.filter(job=job).exclude(status='INACTIVE').exists():
                return Response({'job': ['Kandidat sudah punya lamaran aktif untuk lowongan ini.']},
                                status=status.HTTP_400_BAD_REQUEST)
        track = request.data.get('track') or (job.recruitment_type if job else 'UNDECIDED')
        if track not in ('INHOUSE', 'FREELANCE', 'UNDECIDED') or (job and track != job.recruitment_type):
            return Response({'track': ['Track tidak sesuai.']}, status=status.HTTP_400_BAD_REQUEST)
        app = Candidate.objects.create(
            profile=obj, job=job, track=track, full_name=obj.full_name, email=obj.email, phone=obj.phone,
            source='OTHER', employment_types=obj.employment_types,
            cv_name=obj.cv_name, cv_path=obj.cv_path, cv_content_type=obj.cv_content_type,
        )
        log_event(request, 'create', obj=app, description=(
            f'Lamaran baru untuk {obj.code} dibuat HR'
            + (f' ({job.title})' if job else ' (Open Application)')
        ))
        return Response(ProfileApplicationSerializer(app).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def cv(self, request, pk=None):
        from apps.personnel.storage import is_configured, stream_link_or_file

        from .services import _bucket

        obj = self.get_object()
        if not obj.cv_path or not is_configured():
            return Response({'detail': 'CV not found.'}, status=status.HTTP_404_NOT_FOUND)
        return stream_link_or_file(request, _bucket(), obj.cv_path, obj.cv_name, name=obj.cv_name)

    @action(detail=True, methods=['post'])
    def anonymize(self, request, pk=None):
        """Consent withdrawal / deletion request (PRD 5.13). HR Lead / Admin.

        Removes personal data and CV files of the profile and its
        applications; statuses, dates, tracks and sources stay for reporting.
        CV files still used by a Freelancer document are kept.
        """
        if not (request.user.is_superuser or _role(request.user) in ANONYMIZE_ROLES):
            return Response({'detail': 'Hanya HR Lead / Admin yang dapat menganonimkan profil.'},
                            status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        blocked = self._anonymized_guard(obj)
        if blocked:
            return blocked
        from apps.freelance.models import FreelancerDocument
        from apps.personnel.storage import delete_object, is_configured

        from .models import CandidateNote, Interview
        from .services import _bucket

        apps = list(obj.applications.all())
        paths = {p for p in [obj.cv_path, *(a.cv_path for a in apps)] if p}
        kept = set(FreelancerDocument.objects.filter(storage_path__in=paths).values_list('storage_path', flat=True))
        code = obj.code
        with transaction.atomic():
            label = f'Anonymized {code}'
            placeholder = f'anonymized+{code.lower()}@invalid.local'
            for field in (
                'phone', 'phone_normalized', 'city', 'linkedin_url', 'portfolio_url', 'preferred_location_other',
                'employment_status_other', 'source_other', 'cv_name', 'cv_path', 'cv_content_type',
            ):
                setattr(obj, field, '')
            obj.full_name = label
            obj.email = placeholder
            obj.expected_monthly_salary = None
            obj.expected_project_fee = None
            obj.possible_duplicate_of = None
            obj.consent_withdrawn_at = timezone.now()
            obj.anonymized_at = timezone.now()
            obj.save()
            obj.applications.update(
                full_name=label, email=placeholder, phone='', cv_name='', cv_path='', cv_content_type='',
                screening_notes='', inactive_note='',
            )
            CandidateNote.objects.filter(candidate__in=apps).delete()
            Interview.objects.filter(application__in=apps).update(notes='')
        if is_configured():
            for path in paths - kept:
                try:
                    delete_object(_bucket(), path)
                except Exception:
                    pass  # profile is already anonymized; a leftover file is logged below
        log_event(request, 'delete', obj=obj, description=f'Profil Talent Pool {code} dianonimkan')
        return Response(CandidateProfileSerializer(self.get_queryset().get(pk=obj.pk), context={'request': request}).data)
