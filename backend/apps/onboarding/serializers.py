from rest_framework import serializers

from .models import Onboarding, OnboardingStatusHistory


class OnboardingStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingStatusHistory
        fields = ('id', 'from_status', 'to_status', 'changed_by_name', 'changed_at', 'note')

    def get_changed_by_name(self, obj):
        return obj.changed_by.get_username() if obj.changed_by_id else None


class OnboardingSerializer(serializers.ModelSerializer):
    candidate_name = serializers.CharField(source='candidate.full_name', read_only=True)
    candidate_email = serializers.CharField(source='candidate.email', read_only=True)
    candidate_status = serializers.CharField(source='candidate.status', read_only=True)
    job_title = serializers.CharField(source='candidate.job.title', read_only=True)
    department_name = serializers.CharField(source='candidate.job.department.name', read_only=True, default=None)
    position_name = serializers.CharField(source='candidate.job.position.name', read_only=True, default=None)
    next_statuses = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    status_history = OnboardingStatusHistorySerializer(many=True, read_only=True)

    class Meta:
        model = Onboarding
        fields = (
            'id', 'candidate', 'candidate_name', 'candidate_email',
            'candidate_status', 'job_title', 'department_name', 'position_name',
            'status', 'next_statuses', 'target_join_date', 'notes',
            'created_by', 'created_by_name', 'completed_at', 'created_at', 'updated_at',
            'status_history',
        )
        read_only_fields = (
            'id', 'candidate_name', 'candidate_email', 'candidate_status',
            'job_title', 'department_name', 'position_name', 'status',
            'next_statuses', 'created_by', 'created_by_name', 'completed_at',
            'created_at', 'updated_at', 'status_history',
        )

    def get_next_statuses(self, obj):
        return sorted(Onboarding.TRANSITIONS.get(obj.status, set()))

    def get_created_by_name(self, obj):
        return obj.created_by.get_username() if obj.created_by_id else None
