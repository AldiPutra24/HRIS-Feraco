from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.freelance.models import Skill, SkillCategory
from apps.personnel.permissions import _role
from apps.personnel.storage import is_configured, signed_url, upload_bytes

from .models import Candidate, FreelanceApplyForm, Job
from .permissions import IsRecruitmentAdmin, RECRUITMENT_ADMIN_ROLES
from . import antispam
from .serializers import (
    CandidateSerializer,
    FreelanceApplyFormSerializer,
    JobPublicSerializer,
    JobSerializer,
)
from rest_framework.views import APIView
from .services import _bucket, transition_candidate
from .talent_pool import accept_candidate_to_talent_pool

# CV upload validation: PDF or Word (DOC/DOCX) only, max 5 MB. Extension,
# content type and file signature (magic bytes) must match the same format.
CV_FORMATS = {
    '.pdf': ({'application/pdf', 'application/x-pdf'}, (b'%PDF-',)),
    '.doc': ({'application/msword'}, (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1',)),  # OLE2
    '.docx': (
        {'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
        (b'PK\x03\x04',),  # Office Open XML (zip)
    ),
}
CV_GENERIC_MIME = {'application/octet-stream', ''}
CV_MAX_SIZE = 5 * 1024 * 1024
CV_FORMAT_ERROR = 'Format CV harus PDF atau DOC (Word).'


def _validate_cv(file):
    """Return an error message for an invalid CV file, or None if valid."""
    import os

    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in CV_FORMATS:
        return CV_FORMAT_ERROR
    if file.size and file.size > CV_MAX_SIZE:
        return 'Ukuran CV maksimal 5 MB.'
    mimes, signatures = CV_FORMATS[ext]
    content_type = (getattr(file, 'content_type', '') or '').lower()
    if content_type not in mimes and content_type not in CV_GENERIC_MIME:
        return CV_FORMAT_ERROR
    head = file.read(8)
    file.seek(0)
    if not any(head.startswith(sig) for sig in signatures):
        return CV_FORMAT_ERROR
    return None


class JobViewSet(viewsets.ModelViewSet):
    """HR admin: manage job postings."""

    queryset = Job.objects.select_related('department', 'position').prefetch_related('applications', 'skills__category').all()
    serializer_class = JobSerializer
    permission_classes = [IsRecruitmentAdmin]
    filterset_fields = ['status', 'department', 'employment_type', 'recruitment_type']
    search_fields = ['title', 'location']
    ordering_fields = ['created_at', 'open_date', 'close_date']

    def perform_create(self, serializer):
        slug = self._unique_slug(serializer.validated_data['title'])
        obj = serializer.save(created_by=self.request.user, slug=slug)
        log_event(self.request, 'create', obj=obj, description=f'Job "{obj.title}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Job "{obj.title}" updated')

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.status != 'DRAFT':
            return Response({'detail': 'Hanya job DRAFT yang dapat dihapus.'}, status=status.HTTP_400_BAD_REQUEST)
        log_event(request, 'delete', obj=obj, description=f'Job "{obj.title}" deleted')
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        """Permanent delete — admin/superuser only (bypasses DRAFT restriction)."""
        if not (request.user.is_superuser or _role(request.user) == 'ADMIN'):
            return Response({'detail': 'Hanya admin yang dapat menghapus permanen.'}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        title = obj.title
        obj.delete()
        log_event(request, 'delete', obj=None, description=f'Job "{title}" hard-deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        obj = self.get_object()
        if obj.status == 'OPEN':
            return Response({'detail': 'Job sudah OPEN.'}, status=status.HTTP_400_BAD_REQUEST)
        if not obj.is_complete():
            return Response({'detail': 'Job tidak lengkap. Lengkapi semua field wajib sebelum membuka.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'OPEN'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'approve', obj=obj, description=f'Job "{obj.title}" opened')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        obj = self.get_object()
        if obj.status != 'OPEN':
            return Response({'detail': 'Hanya job OPEN yang dapat ditutup.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'CLOSED'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'close', obj=obj, description=f'Job "{obj.title}" closed')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        obj = self.get_object()
        if obj.status != 'CLOSED':
            return Response({'detail': 'Hanya job CLOSED yang dapat dibuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        if obj.close_date and obj.close_date < timezone.localdate():
            return Response({'detail': 'Close date sudah lewat. Perbarui close_date sebelum membuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        if not obj.is_complete():
            return Response({'detail': 'Job tidak lengkap. Lengkapi semua field wajib sebelum membuka ulang.'}, status=status.HTTP_400_BAD_REQUEST)
        obj.status = 'OPEN'
        obj.save(update_fields=['status', 'updated_at'])
        log_event(request, 'approve', obj=obj, description=f'Job "{obj.title}" reopened')
        return Response(JobSerializer(obj, context={'request': request}).data)

    @staticmethod
    def _unique_slug(title, attempt=0):
        base = slugify(title)[:250]
        slug = f'{base}-{attempt}' if attempt else base
        if Job.objects.filter(slug=slug).exists():
            return JobViewSet._unique_slug(title, attempt + 1)
        return slug


class PublicJobViewSet(viewsets.ReadOnlyModelViewSet):
    """Public: list OPEN jobs, view job detail by slug."""

    queryset = Job.objects.filter(status='OPEN').select_related('department', 'position').prefetch_related('skills__category').all()
    serializer_class = JobPublicSerializer
    permission_classes = [AllowAny]
    lookup_field = 'slug'
    pagination_class = None

    def get_queryset(self):
        today = timezone.localdate()
        # Exclude jobs where close_date is in the past
        return self.queryset.filter(
            status='OPEN',
        ).exclude(
            close_date__lt=today,
        )


class CandidateViewSet(viewsets.ModelViewSet):
    """HR: view candidates. Public: create via Apply."""

    queryset = Candidate.objects.select_related('job', 'applied_skill__skill__category').all()
    serializer_class = CandidateSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    filterset_fields = ['job', 'source', 'status']
    search_fields = ['full_name', 'email']

    def get_queryset(self):
        """Optional ?recruitment_type=INHOUSE|FREELANCE filter via the related
        job — keeps Inhouse and Freelance candidate lists isolated."""
        qs = super().get_queryset()
        rtype = self.request.query_params.get('recruitment_type')
        if rtype in ('INHOUSE', 'FREELANCE'):
            qs = qs.filter(job__recruitment_type=rtype)
        # ?skill=<id>: applicants per position (replaces the retired
        # apply-form "applicants by skill" view).
        skill = self.request.query_params.get('skill')
        if skill and skill.isdigit():
            qs = qs.filter(applied_skill__skill_id=int(skill))
        return qs

    def create(self, request, *args, **kwargs):
        """Public apply. FREELANCE jobs get the portal guards: per-IP rate
        limit (429), CV or portfolio URL required (400), and duplicate
        email + position on the same job within 24h (409). INHOUSE unchanged."""
        job_id = str(request.data.get('job') or '')
        job = Job.objects.filter(pk=job_id).first() if job_id.isdigit() else None
        if job is not None and job.recruitment_type == 'FREELANCE':
            if antispam.rate_limited(request):
                return Response(
                    {'detail': 'Terlalu banyak percobaan. Coba lagi nanti.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            portfolio_url = (request.data.get('portfolio_url') or '').strip()
            if request.FILES.get('cv') is None and not portfolio_url:
                return Response({'cv': ['Upload CV atau isi URL portfolio.']}, status=status.HTTP_400_BAD_REQUEST)
            if antispam.duplicate_application(job, request.data.get('email'), request.data.get('skill_id')):
                return Response(
                    {'detail': 'Lamaran dengan email dan posisi yang sama sudah dikirim dalam 24 jam terakhir.'},
                    status=status.HTTP_409_CONFLICT,
                )
        return super().create(request, *args, **kwargs)

    def _is_public_apply(self):
        # POST on the list route (no pk) == create == public apply.
        request = getattr(self, 'request', None)
        return request is not None and request.method == 'POST' and 'pk' not in self.kwargs

    def get_authenticators(self):
        # Public apply is anonymous: skip SessionAuthentication so a visitor
        # who happens to be logged in to the HRIS in the same browser is not
        # hit by DRF's session CSRF check ("CSRF token missing") on /jobs/<slug>.
        if self._is_public_apply():
            return []
        return super().get_authenticators()

    def get_permissions(self):
        if self.action == 'create':
            return [AllowAny()]
        return [IsRecruitmentAdmin()]

    def perform_create(self, serializer):
        obj = serializer.save()
        file = self.request.FILES.get('cv')
        if file:
            err = _validate_cv(file)
            if err:
                obj.delete()
                from rest_framework.exceptions import ValidationError

                raise ValidationError({'cv': err})
        if file and is_configured():
            path = f'cvs/{obj.id}/{file.name}'
            try:
                upload_bytes(_bucket(), path, file.read(), file.content_type or 'application/octet-stream')
            except Exception as exc:
                obj.delete()
                return Response(
                    {'detail': f'Gagal mengunggah CV ke storage: {str(exc)[:150]}'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            try:
                obj.cv_name = file.name
                obj.cv_path = path
                obj.cv_content_type = file.content_type or ''
                obj.save(update_fields=['cv_name', 'cv_path', 'cv_content_type', 'updated_at'])
            except Exception:
                # DB failed after storage succeeded — remove the orphaned object.
                from apps.personnel.storage import delete_object

                try:
                    delete_object(_bucket(), path)
                except Exception:
                    pass
                raise
            log_event(self.request, 'upload', obj=obj, description=f'CV uploaded for candidate "{obj.full_name}"')
        log_event(self.request, 'create', obj=obj, description=f'Candidate "{obj.full_name}" applied for "{obj.job.title}"')

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        """Move candidate to next status. Only HR roles (IsRecruitmentAdmin)."""
        obj = self.get_object()
        to_status = request.data.get('status')
        note = (request.data.get('note') or '').strip()
        if not to_status or to_status not in dict(Candidate.STATUS_CHOICES):
            return Response({'detail': 'Status tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        candidate, history = transition_candidate(obj, to_status, request, note)
        if candidate is None:
            return Response(
                {'detail': f'Transisi dari {obj.status} ke {to_status} tidak diizinkan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(CandidateSerializer(candidate, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='accept-freelance')
    def accept_freelance(self, request, pk=None):
        """Freelance flow: accepted candidate enters the Freelance/Talent Pool.

        Creates or updates (dedup by email) the Freelancer record from the
        candidate's data and marks the candidate OFFER_ACCEPTED. Never creates
        an Employee/User/Onboarding — that is the Inhouse path only.
        """
        obj = self.get_object()
        if obj.job.recruitment_type != 'FREELANCE':
            return Response(
                {'detail': 'Hanya kandidat recruitment Freelance yang dapat masuk Talent Pool.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if obj.status in Candidate.TERMINAL:
            return Response(
                {'detail': f'Kandidat berstatus {obj.status} tidak dapat diterima.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        freelancer, created = accept_candidate_to_talent_pool(obj, request)
        return Response({
            'candidate': CandidateSerializer(obj, context={'request': request}).data,
            'freelancer_id': freelancer.id,
            'created': created,
            'detail': (
                f'Kandidat "{obj.full_name}" masuk Freelance / Talent Pool.'
                if created else
                f'Data freelancer "{freelancer.full_name}" diperbarui dari kandidat.'
            ),
        })

    @action(detail=True, methods=['get', 'post'])
    def cv(self, request, pk=None):
        obj = self.get_object()
        if request.method == 'GET':
            return self._download_cv(request, obj)
        return self._upload_cv(request, obj)

    def _upload_cv(self, request, obj):
        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'File wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        err = _validate_cv(file)
        if err:
            return Response({'detail': err}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        path = f'cvs/{obj.id}/{file.name}'
        try:
            upload_bytes(_bucket(), path, file.read(), file.content_type or 'application/octet-stream')
        except Exception as exc:
            return Response(
                {'detail': f'Gagal mengunggah ke storage: {str(exc)[:150]}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        try:
            obj.cv_name = file.name
            obj.cv_path = path
            obj.cv_content_type = file.content_type or ''
            obj.save(update_fields=['cv_name', 'cv_path', 'cv_content_type', 'updated_at'])
        except Exception:
            # DB failed after storage succeeded — remove the orphaned object.
            from apps.personnel.storage import delete_object

            try:
                delete_object(_bucket(), path)
            except Exception:
                pass
            raise
        log_event(request, 'upload', obj=obj, description=f'CV uploaded for candidate "{obj.full_name}"')
        return Response({'detail': 'CV uploaded.', 'cv_name': file.name})

    def _download_cv(self, request, obj):
        if not obj.cv_path or not is_configured():
            return Response({'detail': 'CV not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            url = signed_url(_bucket(), obj.cv_path)
            return Response({'url': url, 'name': obj.cv_name})
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def destroy(self, request, *args, **kwargs):
        """Permanent delete — admin/superuser only."""
        if not (request.user.is_superuser or _role(request.user) == 'ADMIN'):
            return Response({'detail': 'Hanya admin yang dapat menghapus kandidat.'}, status=status.HTTP_403_FORBIDDEN)
        obj = self.get_object()
        name = obj.full_name
        obj.delete()
        log_event(request, 'delete', obj=None, description=f'Candidate "{name}" deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['delete'], url_path='hard-delete')
    def hard_delete(self, request, pk=None):
        return self.destroy(request, pk=pk)

class FreelanceApplyFormViewSet(viewsets.ReadOnlyModelViewSet):
    """RETIRED apply forms — read-only history.

    Freelance intake is consolidated into Job Freelance (/jobs/<slug>);
    migration 0010 converted every form into its `portal-<slug>` job.
    Kept for historical applicants per form (no create/update/delete).
    """

    from apps.freelance.permissions import IsFreelanceManager

    queryset = FreelanceApplyForm.objects.prefetch_related('skills').all()
    serializer_class = FreelanceApplyFormSerializer
    permission_classes = [IsFreelanceManager]
    filterset_fields = ['is_active']
    search_fields = ['title']
    pagination_class = None

    @action(detail=True, methods=['get'])
    def applicants(self, request, pk=None):
        """Applicants of this form, optionally ?skill_id= filtered, with the
        chosen skill per applicant."""
        form = self.get_object()
        qs = Candidate.objects.filter(applied_skill__form=form).select_related(
            'job', 'applied_skill__skill'
        ).order_by('-created_at')
        skill_id = request.query_params.get('skill_id')
        if skill_id and skill_id.isdigit():
            qs = qs.filter(applied_skill__skill_id=int(skill_id))
        page = self.paginate_queryset(qs)
        data = []
        cands = page if page is not None else qs
        for c in cands:
            item = CandidateSerializer(c, context={'request': request}).data
            item['skill_name'] = c.applied_skill.skill.name
            item['skill_id'] = c.applied_skill.skill_id
            item['submitted_at'] = c.applied_skill.submitted_at
            data.append(item)
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class PublicFreelancePortalView(APIView):
    """RETIRED public /freelance/apply/<slug> portal -> 410 Gone.

    The form was converted into Job Freelance `portal-<slug>` (migration
    0010); old links are redirected by the frontend to /jobs/portal-<slug>.
    """

    from rest_framework.authentication import BaseAuthentication

    class _NoAuth(BaseAuthentication):
        def authenticate(self, request):
            return None  # request.user = AnonymousUser, no session needed

    authentication_classes = [_NoAuth]
    permission_classes = [AllowAny]

    def _gone(self, slug):
        return Response(
            {
                'detail': 'Form ini sudah dipindahkan ke lowongan freelance.',
                'job_slug': f'portal-{slug}',
            },
            status=status.HTTP_410_GONE,
        )

    def get(self, request, slug):
        return self._gone(slug)

    def post(self, request, slug):
        return self._gone(slug)
