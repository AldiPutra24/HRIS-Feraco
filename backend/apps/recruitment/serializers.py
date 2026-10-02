from apps.freelance.models import Skill

from rest_framework import serializers

from .models import Candidate, CandidateNote, CandidateSkill, CandidateStatusHistory, Job


class FreelancePositionSerializer(serializers.ModelSerializer):
    """Public payload for the /apply/freelance position picker."""

    class Meta:
        model = Job
        fields = ('id', 'title', 'position_text', 'location')


class JobSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    # FREELANCE positions: existing freelance.Skill master (never created here).
    skills = serializers.PrimaryKeyRelatedField(many=True, queryset=Skill.objects.all(), required=False)
    skill_details = serializers.SerializerMethodField()
    applications_count = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = (
            'id', 'title', 'slug', 'department', 'department_name',
            'position', 'position_name', 'position_text', 'skills', 'skill_details',
            'description', 'requirements',
            'employment_type', 'recruitment_type', 'location', 'open_date', 'close_date',
            'status', 'created_by', 'created_at', 'updated_at',
            'applications_count',
        )
        read_only_fields = ('id', 'slug', 'created_by', 'created_at', 'updated_at', 'applications_count', 'status')

    def validate_recruitment_type(self, value):
        if value not in dict(Job.RECRUITMENT_TYPES):
            raise serializers.ValidationError('Recruitment type tidak valid.')
        return value

    def validate(self, attrs):
        instance = self.instance
        rtype = attrs.get('recruitment_type', getattr(instance, 'recruitment_type', None)) or 'INHOUSE'
        if rtype != 'FREELANCE':
            # Skills are a freelance-only (hidden) field for INHOUSE: never
            # validated, always cleared so inhouse jobs keep master-data only.
            attrs['skills'] = []
            return attrs
        if 'skills' in attrs:
            current = set(instance.skills.values_list('pk', flat=True)) if instance else set()
            inactive = [s.name for s in attrs['skills'] if not s.is_active and s.pk not in current]
            if inactive:
                raise serializers.ValidationError({'skills': f'Skill tidak aktif: {", ".join(inactive)}'})
            if attrs['skills']:
                # Readable label for list/public pages + legacy consumers.
                attrs['position_text'] = ', '.join(s.name for s in attrs['skills'])[:255]
        return attrs

    def get_skill_details(self, obj):
        return [
            {'id': s.id, 'name': s.name, 'category': s.category.name if s.category_id else None}
            for s in obj.skills.all()
        ]

    def get_applications_count(self, obj):
        return obj.applications.count()

    # Fields required for a job to be considered complete. INHOUSE needs the
    # master-data fields; FREELANCE skips department/position FK/employment_type
    # and requires a position via skills (or legacy free-text position_text).
    REQUIRED_FIELDS_BY_TYPE = {
        'INHOUSE': Job.REQUIRED_FIELDS,
        'FREELANCE': Job.FREELANCE_REQUIRED_FIELDS,
    }

    def _is_complete(self, data, skills, instance=None):
        rtype = data.get('recruitment_type', getattr(instance, 'recruitment_type', None)) or 'INHOUSE'
        required = self.REQUIRED_FIELDS_BY_TYPE.get(rtype, Job.REQUIRED_FIELDS)
        if instance is None:
            values = [data.get(f) for f in required]
        else:
            values = [data.get(f, getattr(instance, f, None)) for f in required]
        if rtype == 'FREELANCE':
            if skills is None:
                skills = list(instance.skills.all()) if instance else []
            position_text = data.get('position_text', getattr(instance, 'position_text', ''))
            values.append(bool(skills) or bool(position_text))
        return all(values)

    def create(self, validated_data):
        # status is backend-managed: complete -> OPEN, else DRAFT
        validated_data.pop('status', None)
        skills = validated_data.pop('skills', None)
        validated_data['status'] = 'OPEN' if self._is_complete(validated_data, skills) else 'DRAFT'
        job = super().create(validated_data)
        if skills is not None:
            job.skills.set(skills)
        return job

    def update(self, instance, validated_data):
        validated_data.pop('status', None)
        skills = validated_data.pop('skills', None)
        complete = self._is_complete(validated_data, skills, instance)
        if instance.status == 'CLOSED':
            validated_data['status'] = 'CLOSED'  # closed jobs never auto-reopen
        else:
            validated_data['status'] = 'OPEN' if complete else 'DRAFT'
        job = super().update(instance, validated_data)
        if skills is not None:
            job.skills.set(skills)
        return job


class JobPublicSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    # FREELANCE: positions the applicant can choose from (active job skills).
    skill_details = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = (
            'id', 'title', 'slug', 'department_name', 'position_name', 'position_text',
            'skill_details',
            'description', 'requirements', 'employment_type', 'recruitment_type', 'location',
            'open_date', 'close_date',
        )

    def get_skill_details(self, obj):
        if obj.recruitment_type != 'FREELANCE':
            return []
        return [
            {'id': s.id, 'name': s.name, 'category': s.category.name if s.category_id else None}
            for s in obj.skills.all() if s.is_active
        ]


class CandidateStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CandidateStatusHistory
        fields = ('id', 'from_status', 'to_status', 'changed_by_name', 'changed_at', 'note')

    def get_changed_by_name(self, obj):
        return obj.changed_by.get_username() if obj.changed_by_id else None

class CandidateSerializer(serializers.ModelSerializer):
    cv_url = serializers.SerializerMethodField()
    job_title = serializers.CharField(source='job.title', read_only=True)
    recruitment_type = serializers.CharField(source='job.recruitment_type', read_only=True)
    applied_at = serializers.DateTimeField(source='created_at', read_only=True)
    next_statuses = serializers.SerializerMethodField()
    status_history = CandidateStatusHistorySerializer(many=True, read_only=True)
    talent_pool_freelancer_id = serializers.SerializerMethodField()
    notes = serializers.SerializerMethodField()
    # FREELANCE apply: the ONE position (job Skill) chosen by the applicant.
    skill_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    applied_skill = serializers.SerializerMethodField()
    # FREELANCE apply extras (stored as a CandidateNote; ignored for INHOUSE).
    domicile = serializers.CharField(max_length=255, write_only=True, required=False, allow_blank=True)
    portfolio_url = serializers.URLField(write_only=True, required=False, allow_blank=True)
    expected_rate = serializers.CharField(max_length=128, write_only=True, required=False, allow_blank=True)
    applicant_notes = serializers.CharField(max_length=2000, write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Candidate
        fields = (
            'id', 'job', 'job_title', 'recruitment_type', 'full_name', 'email', 'phone',
            'cv_name', 'cv_url', 'source', 'status',
            'next_statuses', 'status_history', 'talent_pool_freelancer_id', 'notes',
            'skill_id', 'applied_skill',
            'domicile', 'portfolio_url', 'expected_rate', 'applicant_notes',
            'applied_at', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'job_title', 'cv_name', 'cv_url', 'source', 'status', 'next_statuses', 'status_history', 'applied_at', 'created_at', 'updated_at')

    def get_talent_pool_freelancer_id(self, obj):
        """Freelancer id if this candidate is already in the Talent Pool (matched by the
        same email/phone rules as accept_candidate_to_talent_pool), else None."""
        if obj.job.recruitment_type != 'FREELANCE':
            return None
        from .talent_pool import _find_existing_freelancer

        fl = _find_existing_freelancer(obj)
        return fl.id if fl else None

    def get_applied_skill(self, obj):
        applied = getattr(obj, 'applied_skill', None)
        if applied is None:
            return None
        s = applied.skill
        return {'id': s.id, 'name': s.name, 'category': s.category.name if s.category_id else None}

    def get_next_statuses(self, obj):
        return sorted(Candidate.TRANSITIONS.get(obj.status, set()))

    def get_notes(self, obj):
        return [n.note for n in obj.notes.all()]

    def get_cv_url(self, obj):
        if not obj.cv_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/recruitment/candidates/{obj.id}/cv/')

    def validate_job(self, value):
        if not value.is_open():
            raise serializers.ValidationError('Lowongan ini sudah tidak menerima lamaran.')
        return value

    EXTRA_LABELS = (
        ('domicile', 'Domisili'),
        ('portfolio_url', 'Portfolio'),
        ('expected_rate', 'Rate diharapkan'),
        ('applicant_notes', 'Catatan'),
    )

    def validate(self, attrs):
        skill_id = attrs.pop('skill_id', None)
        extras = [(label, (attrs.pop(key, '') or '').strip()) for key, label in self.EXTRA_LABELS]
        job = attrs.get('job')
        if self.instance is None and job is not None and job.recruitment_type == 'FREELANCE':
            attrs['_note'] = '\n'.join(f'{label}: {value}' for label, value in extras if value)
        # Position choice applies only when applying to a FREELANCE job that
        # has Skill positions; ignored for INHOUSE/legacy (hidden field).
        if self.instance is None and job is not None and job.recruitment_type == 'FREELANCE':
            options = job.skills.filter(is_active=True)
            if options.exists():
                skill = options.filter(pk=skill_id).first() if skill_id else None
                if skill is None:
                    raise serializers.ValidationError({'skill_id': 'Pilih posisi yang tersedia pada lowongan ini.'})
                attrs['_skill'] = skill
        return attrs

    def create(self, validated_data):
        skill = validated_data.pop('_skill', None)
        note = validated_data.pop('_note', '')
        candidate = super().create(validated_data)
        if skill is not None:
            CandidateSkill.objects.create(candidate=candidate, skill=skill)
        if note:
            CandidateNote.objects.create(candidate=candidate, note=note)
        return candidate


class FreelanceApplyFormSerializer(serializers.ModelSerializer):
    """HR management serializer for public freelance apply forms."""

    # FreelanceApplyForm is imported inside Meta to avoid circulars.

    skills = serializers.PrimaryKeyRelatedField(many=True, queryset=Skill.objects.all(), required=True)
    skill_details = serializers.SerializerMethodField()
    applications_count = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()

    class Meta:
        from .models import FreelanceApplyForm

        model = FreelanceApplyForm
        fields = (
            'id', 'title', 'slug', 'description', 'skills', 'skill_details',
            'is_active', 'applications_count', 'public_url',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'slug', 'applications_count', 'public_url', 'created_at', 'updated_at')

    def get_skill_details(self, obj):
        return [{'id': s.id, 'name': s.name, 'category': s.category.name if s.category_id else None} for s in obj.skills.all()]

    def get_applications_count(self, obj):
        return CandidateSkill.objects.filter(form=obj).count()

    def get_public_url(self, obj):
        request = self.context.get('request')
        path = f'/freelance/apply/{obj.slug}'
        return request.build_absolute_uri(path) if request else path

    def validate_skills(self, value):
        if not value:
            raise serializers.ValidationError('Pilih minimal satu skill/posisi.')
        inactive = [s.name for s in value if not s.is_active]
        if inactive:
            raise serializers.ValidationError(f'Skill tidak aktif: {", ".join(inactive)}')
        return value
