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

from .models import Candidate, CandidateSkill, FreelanceApplyForm, Job
from .permissions import IsRecruitmentAdmin, RECRUITMENT_ADMIN_ROLES
from .serializers import (
    CandidateSerializer,
    FreelanceApplyFormSerializer,
    JobPublicSerializer,
    JobSerializer,
    PublicFreelanceApplySerializer,
)
from rest_framework.views import APIView
from .services import _bucket, transition_candidate
from .talent_pool import accept_candidate_to_talent_pool

# CV upload validation: PDF/DOC/DOCX only, max 10 MB.
CV_ALLOWED_EXTENSIONS = {'.pdf', '.doc', '.docx'}
CV_ALLOWED_MIME = {
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
CV_MAX_SIZE = 10 * 1024 * 1024


def _validate_cv(file):
    """Return an error message for an invalid CV file, or None if valid."""
    import os

    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in CV_ALLOWED_EXTENSIONS:
        return 'Format CV harus PDF, DOC, atau DOCX.'
    if file.size and file.size > CV_MAX_SIZE:
        return 'Ukuran CV maksimal 10MB.'
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
        return qs

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

class FreelanceApplyFormViewSet(viewsets.ModelViewSet):
    """HR management of public freelance apply forms.

    CRUD + applicant browsing per form. Uses the freelance-management roles
    (same as the /dashboard/freelance Skill/Kategori master).
    """

    from apps.freelance.permissions import IsFreelanceManager

    queryset = FreelanceApplyForm.objects.prefetch_related('skills').all()
    serializer_class = FreelanceApplyFormSerializer
    permission_classes = [IsFreelanceManager]
    filterset_fields = ['is_active']
    search_fields = ['title']
    pagination_class = None

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'Freelance apply form "{obj.title}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Freelance apply form "{obj.title}" updated')

    def perform_destroy(self, instance):
        name = instance.title
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Freelance apply form "{name}" deleted')

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
    """Public (no login) endpoints for the /freelance/apply/<slug> portal.

    GET: the form's open skills (only skills HR selected, form must be active).
    POST: submit an application -> ONE Candidate linked to the chosen Skill.
    CSRF-exempt (session-less public form); anti-spam via per-IP rate limit +
    duplicate guard. Never exposes HR/internal endpoints or data.
    """

    from rest_framework.authentication import BaseAuthentication

    class _NoAuth(BaseAuthentication):
        def authenticate(self, request):
            return None  # request.user = AnonymousUser, no session needed

    authentication_classes = [_NoAuth]
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    # Simple in-memory per-IP rate limit: max 5 submissions / 10 minutes.
    RATE_LIMIT = 5
    RATE_WINDOW_SECONDS = 600
    _rate: dict = {}

    def _client_ip(self, request):
        fwd = request.META.get('HTTP_X_FORWARDED_FOR', '')
        return (fwd.split(',')[0].strip() if fwd else request.META.get('REMOTE_ADDR', '')) or 'unknown'

    def _rate_limited(self, request):
        import time

        now = time.monotonic()
        ip = self._client_ip(request)
        hits = [t for t in self._rate.get(ip, []) if now - t < self.RATE_WINDOW_SECONDS]
        if len(hits) >= self.RATE_LIMIT:
            return True
        hits.append(now)
        self._rate[ip] = hits
        return False

    def _duplicate(self, form, email, skill_id):
        """Same email + same skill submitted in the last 24h -> duplicate."""
        from datetime import timedelta

        since = timezone.now() - timedelta(hours=24)
        return CandidateSkill.objects.filter(
            form=form,
            skill_id=skill_id,
            candidate__email=(email or '').strip().lower(),
            submitted_at__gte=since,
        ).exists()

    def _get_form(self, slug):
        form = FreelanceApplyForm.objects.filter(slug=slug).first()
        if form is None or not form.is_active:
            return None
        return form

    def get(self, request, slug):
        form = self._get_form(slug)
        if form is None:
            return Response({'detail': 'Form tidak ditemukan atau tidak aktif.'}, status=status.HTTP_404_NOT_FOUND)
        skills = form.skills.filter(is_active=True).order_by('name')
        return Response({
            'title': form.title,
            'description': form.description,
            'skills': [
                {'id': s.id, 'name': s.name, 'category': s.category.name if s.category_id else None}
                for s in skills
            ],
        })

    def post(self, request, slug):
        form = self._get_form(slug)
        if form is None:
            return Response({'detail': 'Form tidak ditemukan atau tidak aktif.'}, status=status.HTTP_404_NOT_FOUND)
        if self._rate_limited(request):
            return Response(
                {'detail': 'Terlalu banyak percobaan. Coba lagi nanti.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        data = request.data.dict() if hasattr(request.data, 'dict') else dict(request.data)
        file = request.FILES.get('cv')
        portfolio_url = (data.get('portfolio_url') or '').strip()
        if file is None and not portfolio_url:
            return Response({'cv': ['Upload CV atau isi URL portfolio.']}, status=status.HTTP_400_BAD_REQUEST)
        if file is not None:
            err = _validate_cv(file)
            if err:
                return Response({'cv': [err]}, status=status.HTTP_400_BAD_REQUEST)
        ser = PublicFreelanceApplySerializer(data=data, context={'request': request, 'form': form})
        ser.is_valid(raise_exception=True)
        if self._duplicate(form, ser.validated_data.get('email'), ser.validated_data.get('skill_id')):
            return Response(
                {'detail': 'Lamaran dengan email dan posisi yang sama sudah dikirim dalam 24 jam terakhir.'},
                status=status.HTTP_409_CONFLICT,
            )
        if file is not None and not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        cand = ser.save()
        if file is not None:
            path = f'cvs/portal/{cand.id}/{file.name}'
            try:
                upload_bytes(_bucket(), path, file.read(), file.content_type or 'application/octet-stream')
            except Exception as exc:
                cand.delete()
                return Response(
                    {'detail': f'Gagal mengunggah CV ke storage: {str(exc)[:150]}'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            cand.cv_name = file.name
            cand.cv_path = path
            cand.cv_content_type = file.content_type or ''
            cand.save(update_fields=['cv_name', 'cv_path', 'cv_content_type', 'updated_at'])
        log_event(request, 'create', obj=cand, description=f'Public freelance application "{cand.full_name}" via form "{form.title}"')
        return Response(
            {'detail': 'Lamaran berhasil dikirim. Terima kasih!'},
            status=status.HTTP_201_CREATED,
        )
