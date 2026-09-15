from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.personnel.models import Freelancer


class SkillCategory(models.Model):
    """Grouping for skills (e.g. Talent, Crew, Production)."""

    name = models.CharField(max_length=128, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'skill categories'

    def __str__(self):
        return self.name


class Skill(models.Model):
    """Taggable skill/category for freelancers (MC, Talent, Usher, ...)."""

    name = models.CharField(max_length=128, unique=True)
    category = models.ForeignKey(
        SkillCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='skills',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class FreelancerSkill(models.Model):
    """M2M through: freelancer <-> skill with optional note."""

    freelancer = models.ForeignKey(
        Freelancer, on_delete=models.CASCADE, related_name='freelancer_skills'
    )
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE, related_name='freelancer_skills')
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['skill__name']
        unique_together = ('freelancer', 'skill')

    def __str__(self):
        return f'{self.freelancer.full_name} - {self.skill.name}'


class FreelancerDocument(models.Model):
    """CV / portfolio metadata. Binary lives in Supabase Storage bucket."""

    DOC_TYPE_CHOICES = [
        ('CV', 'CV'),
        ('PORTFOLIO', 'Portfolio'),
        ('OTHER', 'Other'),
    ]

    freelancer = models.ForeignKey(
        Freelancer, on_delete=models.CASCADE, related_name='documents'
    )
    doc_type = models.CharField(max_length=16, choices=DOC_TYPE_CHOICES, default='CV')
    name = models.CharField(max_length=255)
    url = models.URLField(blank=True, max_length=1024)
    storage_path = models.CharField(max_length=512, blank=True)
    content_type = models.CharField(max_length=128, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploaded_freelance_documents',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class Event(models.Model):
    """Event/staffing engagement. Reused as the assignment context."""

    name = models.CharField(max_length=255)
    event_date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    client = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_freelance_events',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-event_date', '-created_at']

    def __str__(self):
        return self.name


class EventAssignment(models.Model):
    """Freelancer involvement in an event (riwayat keterlibatan)."""

    freelancer = models.ForeignKey(
        Freelancer, on_delete=models.CASCADE, related_name='assignments'
    )
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='assignments'
    )
    role = models.CharField(max_length=255, blank=True)
    pic = models.CharField(max_length=255, blank=True)
    assigned_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-assigned_at', '-created_at']
        unique_together = ('freelancer', 'event')

    def __str__(self):
        return f'{self.freelancer.full_name} @ {self.event.name}'


class FreelancerPerformance(models.Model):
    """Per-event performance evaluation for a freelancer."""

    RECOMMENDATION_CHOICES = [
        ('RECOMMENDED', 'Recommended'),
        ('RECOMMENDED_NOTES', 'Recommended with Notes'),
        ('NOT_RECOMMENDED', 'Not Recommended'),
    ]

    assignment = models.OneToOneField(
        EventAssignment, on_delete=models.CASCADE, related_name='performance'
    )
    rating = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-5
    recommendation = models.CharField(
        max_length=20, choices=RECOMMENDATION_CHOICES, blank=True
    )
    notes = models.TextField(blank=True)
    evaluator = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'Perf {self.assignment_id}: {self.recommendation}'

class FreelanceTask(models.Model):
    """Deliverable assigned to a freelancer within an event."""

    STATUS_CHOICES = [
        ('BELUM_MULAI', 'Belum Mulai'),
        ('SEDANG_DIKERJAKAN', 'Sedang Dikerjakan'),
        ('SELESAI', 'Selesai'),
        ('TERKENDALA', 'Terkendala'),
    ]

    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name='tasks'
    )
    freelancer = models.ForeignKey(
        Freelancer, on_delete=models.CASCADE, related_name='tasks'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    deadline = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='BELUM_MULAI')
    pic = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_freelance_tasks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['deadline', '-created_at']

    def __str__(self):
        return f'{self.title} ({self.freelancer.full_name} @ {self.event.name})'

class FreelanceTaskUpdate(models.Model):
    """Progress update history for a task."""

    task = models.ForeignKey(
        FreelanceTask, on_delete=models.CASCADE, related_name='updates'
    )
    status = models.CharField(max_length=20, choices=FreelanceTask.STATUS_CHOICES)
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='freelance_task_updates',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.task_id}: {self.status}'
