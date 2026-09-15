from rest_framework import serializers

from apps.personnel.models import Freelancer

from .models import (
    Event,
    EventAssignment,
    FreelancerDocument,
    FreelancerPerformance,
    FreelancerSkill,
    Skill,
    SkillCategory,
)


class SkillCategorySerializer(serializers.ModelSerializer):
    skill_count = serializers.SerializerMethodField()

    class Meta:
        model = SkillCategory
        fields = ('id', 'name', 'is_active', 'skill_count', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at', 'skill_count')

    def get_skill_count(self, obj):
        return obj.skills.count()


class SkillSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = Skill
        fields = ('id', 'name', 'category', 'category_name', 'is_active', 'created_at', 'updated_at')
        read_only_fields = ('id', 'category_name', 'created_at', 'updated_at')

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError('Nama skill wajib diisi.')
        return name


class FreelancerSkillSerializer(serializers.ModelSerializer):
    skill_name = serializers.CharField(source='skill.name', read_only=True)
    category_name = serializers.CharField(source='skill.category.name', read_only=True)

    class Meta:
        model = FreelancerSkill
        fields = ('id', 'skill', 'skill_name', 'category_name', 'note', 'created_at')
        read_only_fields = ('id', 'skill_name', 'category_name', 'created_at')


class FreelancerDocumentSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = FreelancerDocument
        fields = (
            'id', 'freelancer', 'doc_type', 'name', 'url', 'storage_path',
            'content_type', 'size', 'download_url', 'created_at',
        )
        read_only_fields = ('id', 'freelancer', 'storage_path', 'content_type', 'size', 'download_url', 'created_at')

    def get_download_url(self, obj):
        if not obj.storage_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(
            f'/api/freelance/freelancers/{obj.freelancer_id}/documents/{obj.id}/download/'
        )


class EventSerializer(serializers.ModelSerializer):
    assignment_count = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = (
            'id', 'name', 'event_date', 'location', 'client', 'description',
            'assignment_count', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'assignment_count', 'created_at', 'updated_at')

    def get_assignment_count(self, obj):
        return obj.assignments.count()


class FreelancerPerformanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = FreelancerPerformance
        fields = ('id', 'assignment', 'rating', 'recommendation', 'notes', 'evaluator', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')

    def validate_rating(self, value):
        if value is not None and not (1 <= value <= 5):
            raise serializers.ValidationError('Rating harus antara 1 dan 5.')
        return value


class EventAssignmentSerializer(serializers.ModelSerializer):
    freelancer_name = serializers.CharField(source='freelancer.full_name', read_only=True)
    event_name = serializers.CharField(source='event.name', read_only=True)
    performance = FreelancerPerformanceSerializer(read_only=True)

    class Meta:
        model = EventAssignment
        fields = (
            'id', 'freelancer', 'freelancer_name', 'event', 'event_name',
            'role', 'pic', 'assigned_at', 'performance', 'created_at',
        )
        read_only_fields = ('id', 'freelancer_name', 'event_name', 'performance', 'created_at')


class FreelancerListSerializer(serializers.ModelSerializer):
    """Lightweight list row with derived aggregates."""

    skills = serializers.SerializerMethodField()
    avg_rating = serializers.SerializerMethodField()
    recommendation = serializers.SerializerMethodField()
    last_event = serializers.SerializerMethodField()

    class Meta:
        model = Freelancer
        fields = (
            'id', 'full_name', 'whatsapp', 'personal_email', 'domicile', 'status',
            'rate', 'rate_type', 'rate_min', 'rate_max',
            'is_blacklisted', 'blacklist_reason',
            'skills', 'avg_rating', 'recommendation', 'last_event',
            'created_at', 'updated_at',
        )

    def get_skills(self, obj):
        return [
            {
                'id': fs.skill_id,
                'name': fs.skill.name,
                'category': fs.skill.category.name if fs.skill.category else None,
            }
            for fs in obj.freelancer_skills.select_related('skill', 'skill__category').all()
        ]

    def get_avg_rating(self, obj):
        perfs = FreelancerPerformance.objects.filter(
            assignment__freelancer=obj, rating__isnull=False
        )
        if not perfs.exists():
            return None
        return round(sum(p.rating for p in perfs) / perfs.count(), 2)

    def get_recommendation(self, obj):
        # Most recent performance recommendation wins for list filtering.
        perf = (
            FreelancerPerformance.objects
            .filter(assignment__freelancer=obj)
            .exclude(recommendation='')
            .order_by('-updated_at')
            .first()
        )
        return perf.recommendation if perf else ''

    def get_last_event(self, obj):
        a = obj.assignments.order_by('-assigned_at', '-event__event_date').first()
        return a.event.name if a else None


class FreelancerDetailSerializer(serializers.ModelSerializer):
    """Full detail: skills, documents, assignments/performance."""

    skills = FreelancerSkillSerializer(source='freelancer_skills', many=True, read_only=True)
    documents = FreelancerDocumentSerializer(many=True, read_only=True)
    assignments = EventAssignmentSerializer(many=True, read_only=True)
    avg_rating = serializers.SerializerMethodField()

    class Meta:
        model = Freelancer
        fields = (
            'id', 'full_name', 'whatsapp', 'personal_email', 'phone', 'address',
            'domicile', 'status', 'contact_person',
            'rate', 'rate_type', 'rate_min', 'rate_max',
            'is_blacklisted', 'blacklist_reason',
            'skills', 'documents', 'assignments', 'avg_rating',
            'created_at', 'updated_at',
        )

    def get_avg_rating(self, obj):
        perfs = FreelancerPerformance.objects.filter(
            assignment__freelancer=obj, rating__isnull=False
        )
        if not perfs.exists():
            return None
        return round(sum(p.rating for p in perfs) / perfs.count(), 2)


class FreelancerWriteSerializer(serializers.ModelSerializer):
    """Quick Add / edit: minimal fields, no recruitment pipeline."""

    class Meta:
        model = Freelancer
        fields = (
            'id', 'full_name', 'whatsapp', 'personal_email', 'phone', 'address',
            'domicile', 'status', 'contact_person',
            'rate', 'rate_type', 'rate_min', 'rate_max',
            'is_blacklisted', 'blacklist_reason',
        )
        read_only_fields = ('id',)

    def validate_full_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError('Nama wajib diisi.')
        return value.strip()

    def validate_rate_type(self, value):
        if value and value not in dict(Freelancer._meta.get_field('rate_type').choices):
            raise serializers.ValidationError('rate_type tidak valid.')
        return value
