from django.conf import settings
from django.db import models
from django.utils import timezone

STATUS_ACTIVE = 'ACTIVE'
STATUS_INACTIVE = 'INACTIVE'
STATUS_CHOICES = [(STATUS_ACTIVE, 'Active'), (STATUS_INACTIVE, 'Inactive')]


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

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    @property
    def is_visible(self) -> bool:
        """Visible to employees: ACTIVE and (no end date or not yet expired)."""
        if self.status != STATUS_ACTIVE:
            return False
        if self.use_end_date and self.end_date:
            return self.end_date >= timezone.localdate()
        return True
