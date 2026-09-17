from django.conf import settings
from django.db import models
from django.utils import timezone

STATUS_DRAFT = 'DRAFT'
STATUS_PUBLISHED = 'PUBLISHED'
STATUS_ARCHIVED = 'ARCHIVED'
STATUS_CHOICES = [
    (STATUS_DRAFT, 'Draft'),
    (STATUS_PUBLISHED, 'Published'),
    (STATUS_ARCHIVED, 'Archived'),
]


class KnowledgeCategory(models.Model):
    """KMS category tree: root categories + one level of subcategories.

    A single self-referencing model (`parent`) covers both levels — per the
    KMS spec there is no separate SubCategory model. Depth is hard-capped at
    2 (a child may never have a parent that itself has a parent); the rule
    is enforced in `clean()`, the serializer and re-checked in tests.
    """

    name = models.CharField(max_length=120)
    description = models.CharField(max_length=500, blank=True)
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children',
    )
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kms_categories_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['parent_id', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['parent', 'name'],
                name='kms_category_unique_name_per_parent',
            ),
        ]

    def __str__(self):
        return f'{self.parent.name} / {self.name}' if self.parent_id else self.name

    # -- depth / integrity rules (spec: max 2 levels) ------------------------
    @property
    def is_root(self) -> bool:
        return self.parent_id is None

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.parent_id == self.pk and self.pk is not None:
            raise ValidationError({'parent': 'Kategori tidak boleh menjadi parent dirinya sendiri.'})
        if self.parent_id is not None:
            parent = self.parent
            if parent.parent_id is not None:
                raise ValidationError({
                    'parent': 'Subkategori hanya boleh satu level di bawah kategori utama.'
                })

    def save(self, *args, **kwargs):
        # Model-level guarantee (full_clean is bypassed by plain .save()).
        if self.parent_id is not None and self.parent.parent_id is not None:
            from django.core.exceptions import ValidationError

            raise ValidationError({'parent': 'Subkategori hanya boleh satu level di bawah kategori utama.'})
        super().save(*args, **kwargs)

    def article_count(self) -> int:
        return self.articles.count() + KnowledgeArticle.objects.filter(subcategory=self).count()


class KnowledgeArticle(models.Model):
    """Knowledge base entry (panduan, SOP, FAQ, pengumuman teknis, dsb)."""

    title = models.CharField(max_length=200)
    summary = models.CharField(max_length=400, blank=True)
    content = models.TextField()
    category = models.ForeignKey(
        KnowledgeCategory,
        on_delete=models.PROTECT,
        related_name='articles',
        limit_choices_to={'parent__isnull': True},
    )
    subcategory = models.ForeignKey(
        KnowledgeCategory,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sub_articles',
        limit_choices_to={'parent__isnull': False},
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    # Optional attachment (private Supabase bucket, signed download URL).
    attachment_path = models.CharField(max_length=512, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    attachment_content_type = models.CharField(max_length=120, blank=True)
    attachment_size = models.PositiveIntegerField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kms_articles_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='kms_articles_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-updated_at']
        permissions = [('manage_kms', 'Can manage KMS categories and articles')]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        # Stamp published_at the first time an article reaches PUBLISHED.
        if self.status == STATUS_PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)
