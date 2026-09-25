from django.db.models import Q
from django.db.models.query import QuerySet
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.notifications.sanitize import is_rich_html
from apps.personnel.permissions import WRITE_ROLES, _role

from .models import KnowledgeArticle, KnowledgeCategory, STATUS_ARCHIVED, STATUS_PUBLISHED
from .permissions import IsKmsAdmin
from .serializers import (
    KnowledgeArticleSerializer,
    KnowledgeArticleWriteSerializer,
    KnowledgeCategorySerializer,
)
from .storage import attachment_url, delete_attachment, storage_ready, upload_attachment


class KnowledgeCategoryViewSet(viewsets.ModelViewSet):
    """Category + subcategory management (one tree, max depth 2)."""

    queryset = KnowledgeCategory.objects.all()
    serializer_class = KnowledgeCategorySerializer
    permission_classes = [IsKmsAdmin]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    search_fields = ['name', 'description']
    pagination_class = None

    def get_queryset(self):
        qs = KnowledgeCategory.objects.select_related('parent')
        # Subcategory scoping: ?parent=<id> returns direct children only.
        parent = self.request.query_params.get('parent')
        if parent:
            qs = qs.filter(parent_id=parent)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'KMS kategori dibuat: {obj}')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'KMS kategori diubah: {obj}')

    def perform_destroy(self, instance):
        # "Delete if unused": roots with children or articles are rejected;
        # subcategories carrying articles are archived instead of dropped.
        if instance.parent_id is None and instance.children.exists():
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': 'Kategori masih memiliki subkategori. Nonaktifkan atau hapus subkategori dulu.'})
        if instance.article_count() > 0:
            if instance.parent_id is None:
                from rest_framework.exceptions import ValidationError

                raise ValidationError({'detail': 'Kategori masih dipakai oleh knowledge. Nonaktifkan saja.'})
            instance.is_active = False
            instance.save(update_fields=['is_active'])
            log_event(self.request, 'update', obj=instance,
                      description=f'KMS subkategori dinonaktifkan (masih dipakai): {instance}')
            return
        log_event(self.request, 'delete', obj=instance, description=f'KMS kategori dihapus: {instance}')
        instance.delete()

    @action(detail=False, methods=['get'], url_path='tree')
    def tree(self, request):
        """Two-level tree for the KMS sidebar/filter."""
        roots = KnowledgeCategory.objects.filter(parent__isnull=True).order_by('name')
        children = KnowledgeCategory.objects.filter(parent__isnull=False).order_by('name')
        is_manager = _role(request.user) in WRITE_ROLES
        if not is_manager:
            roots = roots.filter(is_active=True)
            children = children.filter(is_active=True)
        data = []
        for root in roots:
            data.append({
                'id': root.id,
                'name': root.name,
                'description': root.description,
                'is_active': root.is_active,
                'children': [
                    {
                        'id': c.id,
                        'name': c.name,
                        'is_active': c.is_active,
                        'article_count': c.article_count(),
                    }
                    for c in children if c.parent_id == root.id
                ],
            })
        return Response(data)


class KnowledgeArticleViewSet(viewsets.ModelViewSet):
    """Knowledge articles: authenticated read, HR/admin write.

    - Published visible to everyone; DRAFT/ARCHIVED only for KMS managers.
    - ?category= (implies its subcategories), ?subcategory=, ?status=,
      ?search= (title/summary/content/category/subcategory names).
    """

    permission_classes = [IsKmsAdmin]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    filterset_fields = ['category', 'subcategory', 'status']
    search_fields = ['title', 'summary', 'content', 'category__name', 'subcategory__name']
    ordering_fields = ['updated_at', 'created_at', 'published_at', 'title', 'view_count']

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return KnowledgeArticleWriteSerializer
        return KnowledgeArticleSerializer

    def get_queryset(self):
        user = self.request.user
        is_manager = _role(user) in WRITE_ROLES
        qs = KnowledgeArticle.objects.select_related(
            'category', 'subcategory', 'created_by', 'updated_by',
        )
        if not is_manager:
            qs = qs.filter(status=STATUS_PUBLISHED)
            # Privacy: only articles this user may read.
            qs = KnowledgeArticle.accessible_to(user).filter(pk__in=qs.values('pk'))
        elif self.request.query_params.get('status') is None and self.kwargs.get('pk') is None:
            # Default listing for managers excludes ARCHIVED unless asked.
            qs = qs.exclude(status=STATUS_ARCHIVED)
        params = self.request.query_params
        category = params.get('category')
        if category:
            qs = qs.filter(Q(category_id=category) | Q(subcategory__parent_id=category))
        subcategory = params.get('subcategory')
        if subcategory:
            qs = qs.filter(subcategory_id=subcategory)
        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(summary__icontains=search)
                | Q(content__icontains=search)
                | Q(category__name__icontains=search)
                | Q(subcategory__name__icontains=search)
            )
        return qs

    def get_object(self):
        # Detail must bypass the default list filters (archived articles stay
        # reachable by URL for managers; queryset-level rules still apply).
        queryset = self.filter_queryset(self.get_queryset_detail())
        obj = get_object_or_404(queryset, pk=self.kwargs['pk'])
        self.check_object_permissions(self.request, obj)
        return obj

    def get_queryset_detail(self):
        user = self.request.user
        if _role(user) in WRITE_ROLES:
            return KnowledgeArticle.objects.select_related(
                'category', 'subcategory', 'created_by', 'updated_by',
            )
        # Privacy: published AND readable by this user (404 otherwise,
        # matching the existing "outside manager queryset -> 404" convention).
        visible = KnowledgeArticle.accessible_to(user)
        return KnowledgeArticle.objects.select_related(
            'category', 'subcategory', 'created_by', 'updated_by',
        ).filter(status=STATUS_PUBLISHED, pk__in=visible.values('pk'))

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'KMS article dibuat: {obj.title}')

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        log_event(self.request, 'update', obj=obj, description=f'KMS article diubah: {obj.title}')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'KMS article dihapus: {instance.title}')
        if instance.attachment_path:
            delete_attachment(instance.attachment_path)
        instance.delete()

    @action(detail=True, methods=['post'], url_path='archive')
    def archive(self, request, pk=None):
        """Soft-state alternative to DELETE: ARCHIVED hides from listings but
        keeps the record (spec #4)."""
        article = self.get_object()
        article.status = STATUS_ARCHIVED
        article.save(update_fields=['status', 'updated_at'])
        log_event(self.request, 'update', obj=article, description=f'KMS article diarsipkan: {article.title}')
        return Response(self.get_serializer(article).data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        """ARCHIVED -> DRAFT (manager-only; permission class already gates)."""
        article = self.get_object()
        article.status = 'DRAFT'
        article.save(update_fields=['status', 'updated_at'])
        log_event(self.request, 'update', obj=article, description=f'KMS article dipulihkan ke draft: {article.title}')
        return Response(self.get_serializer(article).data)

    @action(detail=True, methods=['post'], url_path='attachment')
    def attachment(self, request, pk=None):
        """Upload/replace one optional attachment (private bucket)."""
        article = self.get_object()
        file = request.FILES.get('file')
        if file is None:
            return Response({'detail': 'File wajib diunggah (field `file`.'},
                            status=400)
        if not storage_ready():
            return Response({'detail': 'Storage belum dikonfigurasi.'}, status=503)
        path = f'kms/{article.pk}/{file.name}'
        upload_attachment(path, file.read(), file.content_type or 'application/octet-stream')
        if article.attachment_path and article.attachment_path != path:
            delete_attachment(article.attachment_path)
        article.attachment_path = path
        article.attachment_name = file.name
        article.attachment_content_type = file.content_type or ''
        article.attachment_size = file.size
        article.save(update_fields=[
            'attachment_path', 'attachment_name', 'attachment_content_type',
            'attachment_size', 'updated_at',
        ])
        log_event(self.request, 'update', obj=article,
                  description=f'KMS attachment diunggah: {file.name} ({article.title})')
        return Response(self.get_serializer(article).data)

    @action(detail=True, methods=['get'], url_path='attachment-url')
    def attachment_url_action(self, request, pk=None):
        article = self.get_object()
        if not article.attachment_path:
            return Response({'detail': 'Tidak ada attachment.'}, status=404)
        return Response({'url': attachment_url(article.attachment_path)})

    @action(detail=True, methods=['get'], url_path='related')
    def related(self, request, pk=None):
        """Same-subcategory first, then same-category, published only."""
        article = self.get_object()
        qs = KnowledgeArticle.objects.filter(
            status=STATUS_PUBLISHED, pk__in=KnowledgeArticle.accessible_to(request.user).values('pk'),
        ).exclude(pk=article.pk)
        if article.subcategory_id:
            base = qs.filter(subcategory_id=article.subcategory_id)
        else:
            base = qs.filter(category_id=article.category_id, subcategory__isnull=True)
        related = list(base.select_related('category', 'subcategory')[:6])
        if len(related) < 6:
            extra = (
                qs.filter(category_id=article.category_id)
                .exclude(pk__in=[r.pk for r in related])[:6 - len(related)]
            )
            related += list(extra)
        return Response(KnowledgeArticleSerializer(related, many=True).data)
