from rest_framework import serializers

from apps.accounts.models import User
from apps.notifications.sanitize import sanitize_html

from .models import KnowledgeArticle, KnowledgeCategory, STATUS_CHOICES


class KnowledgeCategorySerializer(serializers.ModelSerializer):
    article_count = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = KnowledgeCategory
        fields = (
            'id', 'name', 'description', 'parent', 'parent_name', 'is_active',
            'article_count', 'created_by_name', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'parent_name', 'article_count', 'created_by_name', 'created_at', 'updated_at')

    def get_article_count(self, obj):
        return obj.article_count()

    def validate_parent(self, value):
        if value is not None and value.parent_id is not None:
            raise serializers.ValidationError(
                'Subkategori hanya boleh satu level di bawah kategori utama.'
            )
        return value

    def validate_name(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Nama kategori wajib diisi.')
        return value

    def validate(self, attrs):
        # Unique (parent, name) with friendly message (DB constraint is the
        # backstop). Self-parent is structurally impossible via the API.
        parent = attrs.get('parent', getattr(self.instance, 'parent', None))
        name = attrs.get('name', getattr(self.instance, 'name', ''))
        qs = KnowledgeCategory.objects.filter(parent=parent, name__iexact=name)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({'name': 'Nama kategori sudah dipakai di level ini.'})
        if self.instance is not None and attrs.get('parent') is not None \
                and self.instance.parent_id is None and self.instance.children.exists():
            raise serializers.ValidationError(
                {'parent': 'Kategori utama yang masih punya subkategori tidak bisa diubah jadi subkategori.'}
            )
        return attrs


class KnowledgeArticleSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    subcategory_name = serializers.CharField(source='subcategory.name', read_only=True, default=None)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default=None)
    updated_by_name = serializers.CharField(source='updated_by.username', read_only=True, default=None)
    has_attachment = serializers.SerializerMethodField()

    class Meta:
        model = KnowledgeArticle
        fields = (
            'id', 'title', 'summary', 'content',
            'category', 'category_name', 'subcategory', 'subcategory_name',
            'status', 'has_attachment',
            'attachment_name', 'attachment_content_type', 'attachment_size',
            'view_count', 'created_by_name', 'updated_by_name',
            'created_at', 'updated_at', 'published_at',
        )
        read_only_fields = (
            'id', 'category_name', 'subcategory_name', 'has_attachment',
            'attachment_name', 'attachment_content_type', 'attachment_size',
            'view_count', 'created_by_name', 'updated_by_name',
            'created_at', 'updated_at', 'published_at',
        )

    def get_has_attachment(self, obj):
        return bool(obj.attachment_path)

    def validate_content(self, value):
        # XSS: the same whitelist sanitizer used for email templates. The
        # editor produces the same tag vocabulary (execCommand-based).
        return sanitize_html(value or '')

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Judul wajib diisi.')
        return value

    def validate(self, attrs):
        category = attrs.get('category', getattr(self.instance, 'category', None))
        subcategory = attrs.get('subcategory', getattr(self.instance, 'subcategory', None))
        if category is not None and category.parent_id is not None:
            raise serializers.ValidationError({'category': 'Kategori utama tidak boleh berupa subkategori.'})
        if subcategory is not None:
            if subcategory.parent_id is None:
                raise serializers.ValidationError({'subcategory': 'Subkategori harus berupa subkategori (bukan kategori utama).'})
            if category is not None and subcategory.parent_id != category.id:
                raise serializers.ValidationError({'subcategory': 'Subkategori harus berada di bawah kategori yang dipilih.'})
        return attrs


class KnowledgeArticleWriteSerializer(KnowledgeArticleSerializer):
    """Create/update serializer: content required + sanitized, status managed."""

    class Meta(KnowledgeArticleSerializer.Meta):
        read_only_fields = tuple(
            f for f in KnowledgeArticleSerializer.Meta.read_only_fields if f != 'status'
        )

    def validate_status(self, value):
        if value not in dict(STATUS_CHOICES):
            raise serializers.ValidationError('Status tidak valid.')
        return value

    def validate_content(self, value):
        value = super().validate_content(value)
        if not (value or '').strip():
            raise serializers.ValidationError('Konten wajib diisi.')
        return value

    def validate_summary(self, value):
        return (value or '').strip()
