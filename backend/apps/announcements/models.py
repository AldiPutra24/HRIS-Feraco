from django.conf import settings
from django.db import models
from django.utils import timezone

STATUS_ACTIVE = 'ACTIVE'
STATUS_INACTIVE = 'INACTIVE'
STATUS_CHOICES = [(STATUS_ACTIVE, 'Active'), (STATUS_INACTIVE, 'Inactive')]

CATEGORY_GENERAL = 'GENERAL'
CATEGORY_POLICY = 'POLICY'
CATEGORY_EVENT = 'EVENT'
CATEGORY_CHOICES = [(CATEGORY_GENERAL, 'Umum'), (CATEGORY_POLICY, 'Kebijakan'), (CATEGORY_EVENT, 'Acara')]


class Announcement(models.Model):
    """Global HR announcement shown on employee + HR dashboards."""

    title = models.CharField(max_length=200)
    body = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='announcements',
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    use_end_date = models.BooleanField(default=False)
    end_date = models.DateField(null=True, blank=True)
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES, default=CATEGORY_GENERAL)
    # Pinned announcements are listed first on every dashboard.
    is_pinned = models.BooleanField(default=False)

    class Meta:
        ordering = ['-is_pinned', '-created_at']

    def __str__(self):
        return self.title

    @classmethod
    def deactivate_expired(cls):
        """Auto-inactivate ACTIVE announcements past their end date (idempotent)."""
        cls.objects.filter(
            status=STATUS_ACTIVE, use_end_date=True, end_date__lt=timezone.localdate(),
        ).update(status=STATUS_INACTIVE)

    @property
    def is_visible(self) -> bool:
        """Visible to employees: ACTIVE and (no end date or not yet expired)."""
        if self.status != STATUS_ACTIVE:
            return False
        if self.use_end_date and self.end_date:
            return self.end_date >= timezone.localdate()
        return True


class AnnouncementRead(models.Model):
    """Per-user read receipt ("belum dibaca" / "Tandai semua dibaca")."""

    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name='reads')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='announcement_reads')
    read_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['announcement', 'user'], name='uniq_announcement_read_per_user'),
        ]
