from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

STATUS_DRAFT = 'DRAFT'
STATUS_PUBLISHED = 'PUBLISHED'
STATUS_ARCHIVED = 'ARCHIVED'
STATUS_CHOICES = [
    (STATUS_DRAFT, 'Draft'),
    (STATUS_PUBLISHED, 'Published'),
    (STATUS_ARCHIVED, 'Archived'),
]

VISIBILITY_ALL = 'ALL'
VISIBILITY_ROLE = 'ROLE'
VISIBILITY_DEPARTMENT = 'DEPARTMENT'
VISIBILITY_USER = 'USER'
VISIBILITY_PRIVATE = 'PRIVATE'
VISIBILITY_CHOICES = [
    (VISIBILITY_ALL, 'Semua Karyawan'),
    (VISIBILITY_ROLE, 'Role Tertentu'),
    (VISIBILITY_DEPARTMENT, 'Departemen Tertentu'),
    (VISIBILITY_USER, 'User Tertentu'),
    (VISIBILITY_PRIVATE, 'Private'),
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

    # -- Privacy / target audience -------------------------------------------
    visibility = models.CharField(
        max_length=12,
        choices=VISIBILITY_CHOICES,
        default=VISIBILITY_ALL,
    )
    role_targets = models.ManyToManyField(
        'accounts.Role',
        through='KnowledgeArticleRole',
        blank=True,
        related_name='kms_articles_targeted',
    )
    department_targets = models.ManyToManyField(
        'personnel.Department',
        through='KnowledgeArticleDepartment',
        blank=True,
        related_name='kms_articles_targeted',
    )
    user_targets = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through='KnowledgeArticleUser',
        blank=True,
        related_name='kms_articles_targeted',
    )

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

    def is_readable_by(self, user) -> bool:
        """True if `user` may read this article per its visibility settings.

        PRIVATE: only the creator and KMS managers. Managers do NOT get a
        blanket read pass on other visibilities beyond who they are as a user
        (their role/department/user targets still apply).
        """
        from apps.personnel.permissions import WRITE_ROLES, _role, employee_for

        if _role(user) in WRITE_ROLES:
            return True
        if self.visibility == VISIBILITY_ALL:
            return True
        if self.visibility == VISIBILITY_PRIVATE:
            return self.created_by_id == user.id
        if self.visibility == VISIBILITY_ROLE:
            return self.role_targets.filter(pk=user.pk).exists()
        if self.visibility == VISIBILITY_DEPARTMENT:
            employee = employee_for(user)
            if employee is None or employee.department_id is None:
                return False
            return self.department_targets.filter(pk=employee.department_id).exists()
        if self.visibility == VISIBILITY_USER:
            return self.user_targets.filter(pk=user.pk).exists()
        return False

    @staticmethod
    def accessible_to(user):
        """QuerySet filter: only articles `user` may read (list/search).

        KMS managers (WRITE_ROLES) see everything (existing behavior)."""
        from apps.personnel.permissions import WRITE_ROLES, _role, employee_for

        qs = KnowledgeArticle.objects.all()
        if _role(user) in WRITE_ROLES:
            return qs
        if user.is_anonymous or not user.is_authenticated:
            return qs.none()
        employee = employee_for(user)
        dept_ids = [employee.department_id] if employee and employee.department_id else []
        return qs.filter(
            Q(visibility=VISIBILITY_ALL)
            | Q(visibility=VISIBILITY_PRIVATE, created_by=user)
            | Q(visibility=VISIBILITY_ROLE, role_targets__key=_role(user))
            | Q(visibility=VISIBILITY_USER, user_targets=user)
            | (Q(visibility=VISIBILITY_DEPARTMENT, department_targets__in=dept_ids) if dept_ids else Q(pk__in=[]))
        )


class KnowledgeArticleRole(models.Model):
    """ROLE-visibility target row: article readable by users with this role."""

    article = models.ForeignKey(
        KnowledgeArticle, on_delete=models.CASCADE, related_name='role_links',
    )
    role = models.ForeignKey(
        'accounts.Role', on_delete=models.CASCADE, related_name='kms_article_links',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['article', 'role'], name='kms_article_role_unique'),
        ]

    def __str__(self):
        return f'{self.article_id}:{self.role.key}'


class KnowledgeArticleDepartment(models.Model):
    """DEPARTMENT-visibility target row: readable by employees in this dept."""

    article = models.ForeignKey(
        KnowledgeArticle, on_delete=models.CASCADE, related_name='department_links',
    )
    department = models.ForeignKey(
        'personnel.Department', on_delete=models.CASCADE, related_name='kms_article_links',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['article', 'department'], name='kms_article_department_unique'),
        ]

    def __str__(self):
        return f'{self.article_id}:{self.department.name}'


class KnowledgeArticleUser(models.Model):
    """USER-visibility target row: readable by this specific user."""

    article = models.ForeignKey(
        KnowledgeArticle, on_delete=models.CASCADE, related_name='user_links',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='kms_article_links',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['article', 'user'], name='kms_article_user_unique'),
        ]

    def __str__(self):
        return f'{self.article_id}:{self.user_id}'
