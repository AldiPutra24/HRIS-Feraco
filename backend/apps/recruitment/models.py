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
    # FREELANCE jobs: positions picked from the existing freelance Skill master
    # (category via Skill.category). INHOUSE jobs never use this.
    skills = models.ManyToManyField('freelance.Skill', related_name='jobs', blank=True)
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

    # FREELANCE skips department/position FK/employment_type; the position is
    # the Skill selection (or legacy free-text position_text).
    FREELANCE_REQUIRED_FIELDS = [
        'title', 'description', 'requirements', 'location', 'open_date',
    ]

    def is_complete(self):
        """True when all fields required to publish are filled."""
        if self.recruitment_type == 'FREELANCE':
            has_position = bool(self.position_text) or (self.pk and self.skills.exists())
            return bool(has_position) and all(getattr(self, f) for f in self.FREELANCE_REQUIRED_FIELDS)
        return all(getattr(self, f) for f in self.REQUIRED_FIELDS)


def normalize_phone(value) -> str:
    """Digits only, Indonesian numbers folded to the 62 prefix
    ('0812..', '+62 812..', '62812..' -> '62812..') for duplicate checks."""
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if digits.startswith('0'):
        digits = '62' + digits[1:]
    elif digits.startswith('8'):
        digits = '62' + digits
    return digits


class CandidateProfile(models.Model):
    """Talent Pool: one person, many applications (``Candidate`` rows).

    Holds the person-level data (contact, preferences, latest CV, consent)
    shared by every application; recruitment status lives on the application.
    """

    EMPLOYMENT_TYPES = [
        ('FULL_TIME', 'Full-time'),
        ('CONTRACT', 'Contract-based'),
        ('FREELANCE', 'Freelance / Project-based'),
        ('INTERNSHIP', 'Internship'),
        ('OPEN', 'Open to Opportunities (Talent Pool)'),
    ]
    LOCATION_CHOICES = [
        ('YOGYAKARTA', 'Yogyakarta'),
        ('JAKARTA', 'Jakarta'),
        ('OTHER', 'Other'),
        ('FLEXIBLE', 'Flexible'),
    ]
    EMPLOYMENT_STATUS_CHOICES = [
        ('EMPLOYED', 'Employed'),
        ('FREELANCE', 'Freelance'),
        ('OPEN_TO_WORK', 'Open to Work'),
        ('STUDENT', 'Student'),
        ('FRESH_GRADUATE', 'Fresh Graduate'),
        ('OTHER', 'Other'),
    ]
    AVAILABILITY_CHOICES = [
        ('IMMEDIATELY', 'Immediately'),
        ('1_2_WEEKS', 'Within 1-2 Weeks'),
        ('2_4_WEEKS', 'Within 2-4 Weeks'),
        ('OVER_1_MONTH', 'More Than 1 Month'),
        ('DEPENDS', 'Depends on the Project / Schedule'),
    ]
    SOURCE_CHOICES = [
        ('LINKEDIN', 'LinkedIn'),
        ('JOBSTREET', 'JobStreet'),
        ('THREADS', 'Threads'),
        ('SOCIAL_MEDIA', 'Instagram / Social Media'),
        ('REFERRAL', 'Employee / Professional Referral'),
        ('WEBSITE', 'Feraco Website'),
        ('OTHER', 'Other'),
    ]

    code = models.CharField(max_length=16, unique=True, null=True, blank=True)
    full_name = models.CharField(max_length=255)
    email = models.EmailField(db_index=True)
    phone = models.CharField(max_length=32, blank=True)
    phone_normalized = models.CharField(max_length=32, blank=True, db_index=True)
    city = models.CharField(max_length=128, blank=True)
    linkedin_url = models.URLField(max_length=500, blank=True)
    portfolio_url = models.URLField(max_length=500, blank=True)
    employment_types = models.JSONField(default=list, blank=True)
    preferred_location = models.CharField(max_length=16, choices=LOCATION_CHOICES, blank=True)
    preferred_location_other = models.CharField(max_length=128, blank=True)
    employment_status = models.CharField(max_length=16, choices=EMPLOYMENT_STATUS_CHOICES, blank=True)
    employment_status_other = models.CharField(max_length=128, blank=True)
    availability = models.CharField(max_length=16, choices=AVAILABILITY_CHOICES, blank=True)
    # Optional (Decision #2); HR-only in serializers.
    expected_monthly_salary = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    expected_project_fee = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    # Latest CV across applications (each application keeps its own copy).
    cv_name = models.CharField(max_length=255, blank=True)
    cv_path = models.CharField(max_length=512, blank=True)
    cv_content_type = models.CharField(max_length=128, blank=True)
    # Source as reported by the candidate (internal channel stays on Candidate.source).
    source_reported = models.CharField(max_length=16, choices=SOURCE_CHOICES, blank=True)
    source_other = models.CharField(max_length=255, blank=True)
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_version = models.CharField(max_length=32, blank=True)
    consent_withdrawn_at = models.DateTimeField(null=True, blank=True)
    # Phone-only match on registration: HR decides merge vs. not a duplicate.
    possible_duplicate_of = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='possible_duplicates',
    )
    freelancer = models.ForeignKey(
        'personnel.Freelancer', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='candidate_profiles',
    )
    employee = models.ForeignKey(
        'personnel.Employee', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='candidate_profiles',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.code or "TP-?"} {self.full_name}'

    def save(self, *args, **kwargs):
        self.phone_normalized = normalize_phone(self.phone)
        super().save(*args, **kwargs)
        if not self.code:
            self.code = f'TP-{self.pk:06d}'
            CandidateProfile.objects.filter(pk=self.pk).update(code=self.code)

    @classmethod
    def match_or_create(cls, full_name, email, phone=''):
        """Duplicate rule (PRD 5.2, decided 2026-10-30): same email (any
        case) reuses that profile; a phone-only match creates a new profile
        flagged ``possible_duplicate_of`` for HR review."""
        email = (email or '').strip()
        if email:
            existing = cls.objects.filter(email__iexact=email).order_by('pk').first()
            if existing:
                return existing
        phone_key = normalize_phone(phone)
        suspect = cls.objects.filter(phone_normalized=phone_key).order_by('pk').first() if phone_key else None
        return cls.objects.create(
            full_name=full_name, email=email, phone=phone or '', possible_duplicate_of=suspect,
        )


class Candidate(models.Model):
    """Application record (shown as "Lamaran"): one job application of a
    ``CandidateProfile``. CV binary lives in Supabase Storage."""

    SOURCE_CHOICES = [
        ('PORTAL', 'Public Portal'),
        ('REFERRAL', 'Referral'),
        ('WEBSITE', 'Company Website'),
        ('OTHER', 'Other'),
    ]
    # PRD 5.5 statuses (Decision #4); legacy values are kept in legacy_status.
    STATUS_CHOICES = [
        ('NEW', 'New'),
        ('SCREENED', 'Screened'),
        ('CONTACTED', 'Contacted'),
        ('HR_INTERVIEW', 'HR Interview'),
        ('USER_INTERVIEW', 'User Interview'),
        ('HIRED', 'Hired / Assigned'),
        ('INACTIVE', 'Inactive'),
    ]
    # Pipeline order. Stages may be skipped (PRD 6.2): any later stage is a
    # valid next step; INACTIVE is reachable from everywhere with a reason.
    PIPELINE = ['NEW', 'SCREENED', 'CONTACTED', 'HR_INTERVIEW', 'USER_INTERVIEW', 'HIRED']
    INACTIVE_REASONS = [
        ('NOT_QUALIFIED', 'Not Qualified'),
        ('CANDIDATE_WITHDREW', 'Candidate Withdrew'),
        ('UNRESPONSIVE', 'Unresponsive'),
        ('NO_LONGER_AVAILABLE', 'No Longer Available'),
        ('POSITION_CLOSED', 'Position Closed'),
        ('OTHER', 'Other'),
    ]
    SCREENING_RESULTS = [
        ('QUALIFIED', 'Qualified'),
        ('NOT_QUALIFIED', 'Not Qualified'),
    ]

    TRACK_CHOICES = [
        ('INHOUSE', 'Inhouse'),
        ('FREELANCE', 'Freelance'),
        ('UNDECIDED', 'Undecided'),
    ]

    profile = models.ForeignKey(
        CandidateProfile, on_delete=models.PROTECT, related_name='applications',
    )
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name='applications')
    # Direction decided by HR (Decision #0); defaults to the job's type.
    track = models.CharField(max_length=16, choices=TRACK_CHOICES, default='UNDECIDED')
    full_name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=32, blank=True)
    cv_name = models.CharField(max_length=255, blank=True)
    cv_path = models.CharField(max_length=512, blank=True)
    cv_content_type = models.CharField(max_length=128, blank=True)
    source = models.CharField(max_length=32, choices=SOURCE_CHOICES, default='PORTAL')
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='NEW')
    inactive_reason = models.CharField(max_length=32, choices=INACTIVE_REASONS, blank=True)
    inactive_note = models.TextField(blank=True)
    # Pre-PRD status of migrated applications (e.g. INTERVIEW_GM), for history.
    legacy_status = models.CharField(max_length=32, blank=True)
    screening_result = models.CharField(max_length=16, choices=SCREENING_RESULTS, blank=True)
    screening_notes = models.TextField(blank=True)
    screened_at = models.DateTimeField(null=True, blank=True)
    screened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='screened_candidates',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.full_name} -> {self.job.title}'

    def next_statuses(self):
        """Allowed targets: any later pipeline stage + INACTIVE; an INACTIVE
        application can only be reactivated to the stage it left. HIRED is
        excluded unless the track is INHOUSE (freelance hires go through
        accept-freelance; undecided applications need a track first)."""
        if self.status == 'INACTIVE':
            last = self.status_history.filter(to_status='INACTIVE').order_by('-changed_at', '-pk').first()
            back = last.from_status if last and last.from_status in self.PIPELINE else 'NEW'
            return [back]
        idx = self.PIPELINE.index(self.status) if self.status in self.PIPELINE else 0
        targets = [s for s in self.PIPELINE[idx + 1:] if s != 'HIRED' or self.track == 'INHOUSE']
        return targets + ['INACTIVE']

    def save(self, *args, **kwargs):
        if self.profile_id is None:
            self.profile = CandidateProfile.match_or_create(self.full_name, self.email, self.phone)
        if self._state.adding and self.track == 'UNDECIDED' and self.job_id:
            self.track = self.job.recruitment_type
        super().save(*args, **kwargs)
        # Latest uploaded CV becomes the profile CV.
        if self.cv_path and self.profile.cv_path != self.cv_path:
            CandidateProfile.objects.filter(pk=self.profile_id).update(
                cv_name=self.cv_name, cv_path=self.cv_path, cv_content_type=self.cv_content_type,
            )


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


class Interview(models.Model):
    """Interview / skill test of one application (PRD 5.5). Skill Test is an
    interview stage, not a pipeline status."""

    STAGE_CHOICES = [
        ('HR', 'HR Interview'),
        ('USER', 'User Interview'),
        ('SKILL_TEST', 'Skill Test'),
    ]
    RESULT_CHOICES = [
        ('PENDING', 'Pending'),
        ('PASSED', 'Passed'),
        ('NOT_PASSED', 'Not Passed'),
    ]

    application = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name='interviews')
    stage = models.CharField(max_length=16, choices=STAGE_CHOICES)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    interviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='candidate_interviews',
    )
    # Free text for interviewers without an HRIS account (e.g. client user).
    interviewer_name = models.CharField(max_length=255, blank=True)
    result = models.CharField(max_length=16, choices=RESULT_CHOICES, default='PENDING')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_candidate_interviews',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_at', 'pk']

    def __str__(self):
        return f'{self.application.full_name}: {self.get_stage_display()} ({self.result})'
