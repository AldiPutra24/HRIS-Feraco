from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class Job(models.Model):
    """Recruitment job posting (public portal + internal management)."""

    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('OPEN', 'Open'),
        ('CLOSED', 'Closed'),
    ]
    EMPLOYMENT_TYPES = [
        ('FULL_TIME', 'Full Time'),
        ('PART_TIME', 'Part Time'),
        ('CONTRACT', 'Contract'),
        ('INTERNSHIP', 'Internship'),
        ('FREELANCE', 'Freelance'),
    ]
    # Recruitment category: inhouse hires become Employees (via Onboarding);
    # freelance hires enter the Freelance/Talent Pool. Default INHOUSE keeps
    # all pre-existing jobs classified as inhouse (backward compatible).
    RECRUITMENT_TYPES = [
        ('INHOUSE', 'Inhouse'),
        ('FREELANCE', 'Freelance'),
    ]

    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True)
    department = models.ForeignKey(
        'personnel.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='jobs',
    )
    position = models.ForeignKey(
        'personnel.Position',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='jobs',
    )
    # Free-text position for FREELANCE jobs (no department/position master data
    # needed, e.g. 'MC', 'Photographer'). INHOUSE jobs use the FKs above.
    position_text = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    requirements = models.TextField(blank=True)
    employment_type = models.CharField(max_length=16, choices=EMPLOYMENT_TYPES, default='FULL_TIME')
    recruitment_type = models.CharField(max_length=16, choices=RECRUITMENT_TYPES, default='INHOUSE')
    location = models.CharField(max_length=255, blank=True)
    open_date = models.DateField()
    close_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='DRAFT')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def is_open(self):
        """OPEN status and close_date not in the past."""
        if self.status != 'OPEN':
            return False
        if self.close_date and self.close_date < timezone.localdate():
            return False
        return True

    REQUIRED_FIELDS = [
        'title', 'department', 'position', 'description',
        'requirements', 'employment_type', 'location', 'open_date',
    ]

    def is_complete(self):
        """True when all fields required to publish are filled."""
        return all(getattr(self, f) for f in self.REQUIRED_FIELDS)


class Candidate(models.Model):
    """Public job applicant. CV binary lives in Supabase Storage."""

    SOURCE_CHOICES = [
        ('PORTAL', 'Public Portal'),
        ('REFERRAL', 'Referral'),
        ('WEBSITE', 'Company Website'),
        ('OTHER', 'Other'),
    ]
    STATUS_CHOICES = [
        ('APPLIED', 'Applied'),
        ('SCREENING', 'Screening'),
        ('INTERVIEW_HR', 'Interview HR'),
        ('INTERVIEW_USER', 'Interview User'),
        ('INTERVIEW_GM', 'Interview GM'),
        ('OFFERING', 'Offering'),
        ('OFFER_ACCEPTED', 'Offer Accepted'),
        ('REJECTED', 'Rejected'),
        ('WITHDRAWN', 'Withdrawn'),
    ]
    # Normal pipeline order. Terminal statuses (REJECTED/WITHDRAWN) excluded.
    PIPELINE = ['APPLIED', 'SCREENING', 'INTERVIEW_HR', 'INTERVIEW_USER', 'INTERVIEW_GM', 'OFFERING', 'OFFER_ACCEPTED']
    TERMINAL = {'REJECTED', 'WITHDRAWN'}
    # Allowed next status per current status. APPLIED may jump straight to
    # INTERVIEW_HR when screening is skipped; REJECTED/WITHDRAWN are terminal.
    TRANSITIONS = {
        'APPLIED': {'SCREENING', 'INTERVIEW_HR', 'REJECTED', 'WITHDRAWN'},
        'SCREENING': {'INTERVIEW_HR', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_HR': {'INTERVIEW_USER', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_USER': {'INTERVIEW_GM', 'REJECTED', 'WITHDRAWN'},
        'INTERVIEW_GM': {'OFFERING', 'REJECTED', 'WITHDRAWN'},
        'OFFERING': {'OFFER_ACCEPTED', 'REJECTED', 'WITHDRAWN'},
        'OFFER_ACCEPTED': {'REJECTED', 'WITHDRAWN'},
    }

    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name='applications')
    full_name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=32, blank=True)
    cv_name = models.CharField(max_length=255, blank=True)
    cv_path = models.CharField(max_length=512, blank=True)
    cv_content_type = models.CharField(max_length=128, blank=True)
    source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default='PORTAL')
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='APPLIED')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.full_name} -> {self.job.title}'


class FreelanceApplyForm(models.Model):
    """HR-configured public application form for freelance recruitment.

    One public link per form (slug). HR multi-selects which existing
    freelance.Skill master data is open; candidates pick ONE of those skills
    on the public page. Accepting the candidate maps their chosen Skill onto
    the Freelancer in the Talent Pool (no duplicate Skill creation).
    """

    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True, blank=True)
    description = models.TextField(blank=True)
    skills = models.ManyToManyField(
        'freelance.Skill', related_name='apply_forms', blank=True
    )
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='freelance_apply_forms',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title) or 'form'
            slug = base
            i = 2
            while FreelanceApplyForm.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{i}'
                i += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def get_or_create_job(self):
        """The internal Job row candidates are filed under (keeps the existing
        Candidate pipeline + freelance/inhouse isolation working unchanged)."""
        slug = f'portal-{self.slug}'
        job, _ = Job.objects.get_or_create(
            slug=slug,
            defaults={
                'title': self.title,
                'position_text': self.title,
                'employment_type': 'FREELANCE',
                'recruitment_type': 'FREELANCE',
                'open_date': timezone.localdate(),
                'status': 'OPEN',
                'description': self.description,
            },
        )
        return job


class CandidateSkill(models.Model):
    """The ONE skill (position) a candidate chose on a public apply form.

    Kept as its own through row so HR can browse applicants per skill and the
    Talent Pool acceptance maps it onto FreelancerSkill.
    """

    candidate = models.OneToOneField(
        Candidate, on_delete=models.CASCADE, related_name='applied_skill'
    )
    skill = models.ForeignKey(
        'freelance.Skill', on_delete=models.PROTECT, related_name='candidates'
    )
    form = models.ForeignKey(
        FreelanceApplyForm, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='candidate_skills',
    )
    submitted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.candidate.full_name} -> {self.skill.name}'


class CandidateNote(models.Model):
    """Free-form note on a candidate (extra public-application details, HR notes)."""

    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='notes')
    note = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='candidate_notes',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Note on {self.candidate.full_name}'


class CandidateStatusHistory(models.Model):
    """Audit trail of candidate status transitions."""

    candidate = models.ForeignKey(
        Candidate, on_delete=models.CASCADE, related_name='status_history'
    )
    from_status = models.CharField(max_length=32)
    to_status = models.CharField(max_length=32)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='candidate_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f'{self.candidate.full_name}: {self.from_status} -> {self.to_status}'
