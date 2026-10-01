from apps.freelance.models import Skill

from rest_framework import serializers

from .models import Candidate, CandidateSkill, CandidateStatusHistory, Job


class FreelancePositionSerializer(serializers.ModelSerializer):
    """Public payload for the /apply/freelance position picker."""

    class Meta:
        model = Job
        fields = ('id', 'title', 'position_text', 'location')


class JobSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    applications_count = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = (
            'id', 'title', 'slug', 'department', 'department_name',
            'position', 'position_name', 'position_text', 'description', 'requirements',
            'employment_type', 'recruitment_type', 'location', 'open_date', 'close_date',
            'status', 'created_by', 'created_at', 'updated_at',
            'applications_count',
        )
        read_only_fields = ('id', 'slug', 'created_by', 'created_at', 'updated_at', 'applications_count', 'status')

    def validate_recruitment_type(self, value):
        if value not in dict(Job.RECRUITMENT_TYPES):
            raise serializers.ValidationError('Recruitment type tidak valid.')
        return value

    def get_applications_count(self, obj):
        return obj.applications.count()

    # Fields required for a job to be considered complete. INHOUSE needs the
    # master-data fields; FREELANCE skips department/position FK/employment_type
    # and requires the free-text position instead.
    REQUIRED_FIELDS_BY_TYPE = {
        'INHOUSE': Job.REQUIRED_FIELDS,
        'FREELANCE': [
            'title', 'position_text', 'description', 'requirements', 'location', 'open_date',
        ],
    }

    def _merged(self, data, instance=None):
        rtype = data.get('recruitment_type', getattr(instance, 'recruitment_type', None)) or 'INHOUSE'
        required = self.REQUIRED_FIELDS_BY_TYPE.get(rtype, Job.REQUIRED_FIELDS)
        if instance is None:
            return {f: data.get(f) for f in required}
        return {f: data.get(f, getattr(instance, f, None)) for f in required}

    def create(self, validated_data):
        # status is backend-managed: complete -> OPEN, else DRAFT
        validated_data.pop('status', None)
        validated_data['status'] = 'OPEN' if all(self._merged(validated_data).values()) else 'DRAFT'
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('status', None)
        complete = all(self._merged(validated_data, instance).values())
        if instance.status == 'CLOSED':
            validated_data['status'] = 'CLOSED'  # closed jobs never auto-reopen
        else:
            validated_data['status'] = 'OPEN' if complete else 'DRAFT'
        return super().update(instance, validated_data)


class JobPublicSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)

    class Meta:
        model = Job
        fields = (
            'id', 'title', 'slug', 'department_name', 'position_name', 'position_text',
            'description', 'requirements', 'employment_type', 'recruitment_type', 'location',
            'open_date', 'close_date',
        )


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

    class Meta:
        model = Candidate
        fields = (
            'id', 'job', 'job_title', 'recruitment_type', 'full_name', 'email', 'phone',
            'cv_name', 'cv_url', 'source', 'status',
            'next_statuses', 'status_history', 'talent_pool_freelancer_id', 'notes',
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


class PublicFreelanceApplySerializer(serializers.Serializer):
    """Public /freelance/apply/<slug> submission. Creates exactly ONE Candidate
    filed under the form's internal freelance Job, linked to the chosen Skill.
    Never creates Employee/User/Freelancer.
    """

    full_name = serializers.CharField(max_length=255)
    phone = serializers.CharField(max_length=32)
    email = serializers.EmailField()
    domicile = serializers.CharField(max_length=255, required=False, allow_blank=True, default='')
    skill_id = serializers.IntegerField()
    portfolio_url = serializers.URLField(required=False, allow_blank=True, default='')
    expected_rate = serializers.CharField(max_length=128, required=False, allow_blank=True, default='')
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, default='')

    def validate_phone(self, value):
        import re

        v = (value or '').strip()
        if not re.fullmatch(r'[0-9+\-()\s]{8,32}', v):
            raise serializers.ValidationError('Nomor WhatsApp/HP tidak valid.')
        return v

    def create(self, validated):
        from .models import CandidateNote, CandidateSkill

        form: FreelanceApplyForm = self.context['form']
        skill = Skill.objects.filter(pk=validated['skill_id']).first()
        if skill is None or not form.skills.filter(pk=skill.pk).exists():
            raise serializers.ValidationError({'skill_id': 'Posisi tidak tersedia pada form ini.'})
        cand = Candidate.objects.create(
            job=form.get_or_create_job(),
            full_name=validated['full_name'].strip(),
            email=validated['email'].strip().lower(),
            phone=validated['phone'].strip(),
            source='PORTAL',
        )
        CandidateSkill.objects.create(candidate=cand, skill=skill, form=form)
        extra = []
        if validated.get('domicile'):
            extra.append(f'Domisili: {validated["domicile"]}')
        if validated.get('portfolio_url'):
            extra.append(f'Portfolio: {validated["portfolio_url"]}')
        if validated.get('expected_rate'):
            extra.append(f'Rate diharapkan: {validated["expected_rate"]}')
        if validated.get('notes'):
            extra.append(f'Catatan: {validated["notes"]}')
        if extra:
            CandidateNote.objects.get_or_create(
                candidate=cand,
                note='\n'.join(extra),
                defaults={'created_by': None},
            )
        return cand
