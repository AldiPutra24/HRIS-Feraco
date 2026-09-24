from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.models import Freelancer

from .models import (
    Event,
    EventAssignment,
    FreelanceTask,
    FreelanceTaskUpdate,
    FreelancerDocument,
    FreelancerPerformance,
    FreelancerSkill,
    Skill,
    SkillCategory,
    TaskEscalationPolicy,
)
from .permissions import IsFreelanceManager
from .serializers import (
    EventAssignmentSerializer,
    EventSerializer,
    FreelanceTaskSerializer,
    FreelanceTaskUpdateSerializer,
    FreelancerDetailSerializer,
    FreelancerDocumentSerializer,
    FreelancerListSerializer,
    FreelancerPerformanceSerializer,
    FreelancerSkillSerializer,
    FreelancerWriteSerializer,
    SkillCategorySerializer,
    SkillSerializer,
    TaskEscalationPolicySerializer,
)
from .services import send_due_reminders
from .storage import _bucket, delete_object, is_configured, signed_url, upload_bytes


class SkillCategoryViewSet(viewsets.ModelViewSet):
    queryset = SkillCategory.objects.all()
    serializer_class = SkillCategorySerializer
    permission_classes = [IsFreelanceManager]
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'SkillCategory "{obj.name}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'SkillCategory "{obj.name}" updated')

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'SkillCategory "{name}" deleted')


class SkillViewSet(viewsets.ModelViewSet):
    queryset = Skill.objects.select_related('category').all()
    serializer_class = SkillSerializer
    permission_classes = [IsFreelanceManager]
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']
    filterset_fields = ['category', 'is_active']

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Skill "{obj.name}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Skill "{obj.name}" updated')

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Skill "{name}" deleted')


class FreelancerViewSet(viewsets.ModelViewSet):
    queryset = Freelancer.objects.all()
    permission_classes = [IsFreelanceManager]
    search_fields = ['full_name', 'personal_email', 'whatsapp', 'domicile']
    ordering_fields = ['full_name', 'created_at', 'updated_at']
    filterset_fields = ['status', 'is_blacklisted']
    # Honor ?page_size= so the frontend can fetch the full Talent Pool in one
    # request; without it the default PAGE_SIZE=20 hides newer freelancers
    # (e.g. candidates just mapped into the pool) behind page 2.
    pagination_class = type('LargePagePagination', (PageNumberPagination,), {'page_size_query_param': 'page_size'})

    def get_serializer_class(self):
        if self.action == 'list':
            return FreelancerListSerializer
        if self.action == 'retrieve':
            return FreelancerDetailSerializer
        return FreelancerWriteSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action != 'list':
            return qs
        params = self.request.query_params
        skill = params.get('skill')
        if skill:
            qs = qs.filter(freelancer_skills__skill__name__iexact=skill)
        rating = params.get('rating')
        if rating in ('1', '2', '3', '4', '5'):
            qs = qs.filter(
                assignments__performance__rating__gte=int(rating)
            )
        recommendation = params.get('recommendation')
        if recommendation:
            qs = qs.filter(assignments__performance__recommendation=recommendation)
        event = params.get('event')
        if event:
            qs = qs.filter(assignments__event_id=event)
        return qs.distinct()

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Freelancer "{obj.full_name}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Freelancer "{obj.full_name}" updated')

    def perform_destroy(self, instance):
        name = instance.full_name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Freelancer "{name}" deleted')

    @action(detail=True, methods=['post', 'delete'], url_path='skills')
    def skills(self, request, pk=None):
        freelancer = self.get_object()
        if request.method == 'POST':
            skill_id = request.data.get('skill')
            if not skill_id:
                return Response({'detail': 'skill wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
            skill = Skill.objects.filter(id=skill_id).first()
            if not skill:
                return Response({'detail': 'Skill tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
            fs, created = FreelancerSkill.objects.get_or_create(
                freelancer=freelancer, skill=skill,
                defaults={'note': (request.data.get('note') or '').strip()},
            )
            if not created:
                return Response({'detail': 'Skill sudah ditambahkan.'}, status=status.HTTP_400_BAD_REQUEST)
            log_event(request, 'update', obj=freelancer, description=f'Skill "{skill.name}" added')
            return Response(FreelancerSkillSerializer(fs).data, status=status.HTTP_201_CREATED)
        # DELETE
        skill_id = request.query_params.get('skill') or request.data.get('skill')
        if not skill_id:
            return Response({'detail': 'skill wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = FreelancerSkill.objects.filter(freelancer=freelancer, skill_id=skill_id).delete()
        if not deleted:
            return Response({'detail': 'Skill tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        log_event(request, 'update', obj=freelancer, description=f'Skill {skill_id} removed')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], url_path='documents')
    def documents(self, request, pk=None):
        freelancer = self.get_object()
        if request.method == 'GET':
            docs = freelancer.documents.all()
            return Response(FreelancerDocumentSerializer(docs, many=True, context={'request': request}).data)
        # POST: upload file and/or URL
        doc_type = (request.data.get('doc_type') or 'CV').upper()
        name = (request.data.get('name') or '').strip()
        url = (request.data.get('url') or '').strip()
        file = request.FILES.get('file')
        if not name and not file:
            name = file.name if file else 'Document'
        if not file and not url:
            return Response({'detail': 'Sediakan file atau URL.'}, status=status.HTTP_400_BAD_REQUEST)
        storage_path = ''
        content_type = ''
        size = 0
        if file:
            if not is_configured():
                return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            storage_path = f'freelancers/{freelancer.id}/{file.name}'
            upload_bytes(_bucket(), storage_path, file.read(), file.content_type or 'application/octet-stream')
            content_type = file.content_type or ''
            size = file.size
            name = name or file.name
        doc = FreelancerDocument.objects.create(
            freelancer=freelancer,
            doc_type=doc_type,
            name=name,
            url=url,
            storage_path=storage_path,
            content_type=content_type,
            size=size,
            uploaded_by=request.user if request.user.is_authenticated else None,
        )
        log_event(request, 'upload', obj=freelancer, description=f'Document "{doc.name}" uploaded')
        return Response(FreelancerDocumentSerializer(doc, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='documents/(?P<doc_id>[^/.]+)/download')
    def document_download(self, request, pk=None, doc_id=None):
        freelancer = self.get_object()
        doc = freelancer.documents.filter(id=doc_id).first()
        if not doc:
            return Response({'detail': 'Document tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        if doc.url and not doc.storage_path:
            return Response({'url': doc.url, 'name': doc.name})
        if not doc.storage_path or not is_configured():
            return Response({'detail': 'Document tidak tersedia.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            signed = signed_url(_bucket(), doc.storage_path)
            return Response({'url': signed, 'name': doc.name})
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['delete'], url_path='documents/(?P<doc_id>[^/.]+)')
    def document_delete(self, request, pk=None, doc_id=None):
        freelancer = self.get_object()
        doc = freelancer.documents.filter(id=doc_id).first()
        if not doc:
            return Response({'detail': 'Document tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        if doc.storage_path and is_configured():
            try:
                delete_object(_bucket(), doc.storage_path)
            except Exception:
                pass
        name = doc.name
        doc.delete()
        log_event(request, 'delete', obj=freelancer, description=f'Document "{name}" deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [IsFreelanceManager]
    search_fields = ['name', 'client', 'location']
    ordering_fields = ['event_date', 'name', 'created_at']

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)
        log_event(self.request, 'create', obj=obj, description=f'Event "{obj.name}" created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Event "{obj.name}" updated')

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Event "{name}" deleted')

    @action(detail=True, methods=['get'], url_path='task-progress')
    def task_progress(self, request, pk=None):
        event = self.get_object()
        tasks = event.tasks.all()
        counts = {key: 0 for key, _ in FreelanceTask.STATUS_CHOICES}
        for t in tasks:
            counts[t.status] = counts.get(t.status, 0) + 1
        total = tasks.count()
        return Response({
            'total': total,
            **counts,
            'percentage': round(counts['SELESAI'] / total * 100) if total else 0,
        })


class EventAssignmentViewSet(viewsets.ModelViewSet):
    queryset = EventAssignment.objects.select_related('freelancer', 'event').all()
    serializer_class = EventAssignmentSerializer
    permission_classes = [IsFreelanceManager]
    filterset_fields = ['event', 'freelancer']
    ordering_fields = ['assigned_at', 'created_at']

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get('freelancer'):
            qs = qs.filter(freelancer_id=params['freelancer'])
        if params.get('event'):
            qs = qs.filter(event_id=params['event'])
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Assignment {obj} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Assignment {obj} updated')

    def perform_destroy(self, instance):
        name = str(instance)
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Assignment {name} deleted')

    @action(detail=True, methods=['post', 'put', 'patch'], url_path='performance')
    def performance(self, request, pk=None):
        assignment = self.get_object()
        perf = getattr(assignment, 'performance', None)
        if perf is None:
            serializer = FreelancerPerformanceSerializer(data={**request.data, 'assignment': assignment.id})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            log_event(request, 'create', obj=assignment, description='Performance created')
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        serializer = FreelancerPerformanceSerializer(assignment.performance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_event(request, 'update', obj=assignment, description='Performance updated')
        return Response(serializer.data)

class TaskEscalationPolicyViewSet(viewsets.ModelViewSet):
    """Singleton GET/PATCH config for automatic task reminders + escalation.

    The DefaultRouter exposes GET at the collection route and PATCH at the
    detail route; both resolve to the same singleton row (get_or_create pk=1).
    """

    queryset = TaskEscalationPolicy.objects.all()
    serializer_class = TaskEscalationPolicySerializer
    permission_classes = [IsFreelanceManager]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_object(self):
        return TaskEscalationPolicy.get_solo()

    def perform_update(self, serializer):
        obj = serializer.save(
            updated_by=self.request.user if self.request.user.is_authenticated else None
        )
        log_event(
            self.request,
            'update',
            obj=obj,
            description='Task escalation policy updated',
        )


    @action(detail=False, methods=['post'], url_path='send-now')
    def send_now(self, request):
        """Trigger the reminder run immediately (same engine as the cron job)."""
        result = send_due_reminders(request=request)
        return Response(result)

    def list(self, request, *args, **kwargs):
        """GET /task-scheduler/ -> the singleton policy (never a paginated list)."""
        return self.retrieve(request, pk=1)


class FreelanceTaskViewSet(viewsets.ModelViewSet):
    queryset = FreelanceTask.objects.select_related('event', 'freelancer').all()
    serializer_class = FreelanceTaskSerializer
    permission_classes = [IsFreelanceManager]
    filterset_fields = ['event', 'freelancer', 'status']
    search_fields = ['title', 'description', 'pic']
    ordering_fields = ['deadline', 'created_at', 'updated_at']

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get('deadline_before'):
            qs = qs.filter(deadline__lte=params['deadline_before'])
        if params.get('deadline_after'):
            qs = qs.filter(deadline__gte=params['deadline_after'])
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None
        )
        log_event(self.request, 'create', obj=obj, description=f'Task "{obj.title}" created')

    def perform_update(self, serializer):
        old_status = self.get_object().status
        obj = serializer.save()
        if obj.status != old_status:
            FreelanceTaskUpdate.objects.create(
                task=obj,
                status=obj.status,
                note=(serializer.validated_data.get('description') or ''),
                created_by=self.request.user if self.request.user.is_authenticated else None,
            )
        log_event(self.request, 'update', obj=obj, description=f'Task "{obj.title}" updated')

    def perform_destroy(self, instance):
        name = str(instance)
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Task {name} deleted')

    @action(detail=True, methods=['get'])
    def updates(self, request, pk=None):
        task = self.get_object()
        serializer = FreelanceTaskUpdateSerializer(task.updates.all(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='updates')
    def add_update(self, request, pk=None):
        task = self.get_object()
        new_status = request.data.get('status') or task.status
        if new_status not in dict(FreelanceTask.STATUS_CHOICES):
            return Response({'status': ['Status tidak valid.']}, status=status.HTTP_400_BAD_REQUEST)
        update = FreelanceTaskUpdate.objects.create(
            task=task,
            status=new_status,
            note=request.data.get('note', ''),
            created_by=request.user if request.user.is_authenticated else None,
        )
        if new_status != task.status:
            task.status = new_status
            task.save(update_fields=['status', 'updated_at'])
        log_event(request, 'create', obj=task, description=f'Task "{task.title}" update added')
        return Response(FreelanceTaskUpdateSerializer(update).data, status=status.HTTP_201_CREATED)
