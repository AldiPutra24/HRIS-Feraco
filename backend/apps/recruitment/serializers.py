from rest_framework import serializers

from .models import Candidate, Job


class JobSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    position_name = serializers.CharField(source='position.name', read_only=True)
    applications_count = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = (
            'id', 'title', 'slug', 'department', 'department_name',
            'position', 'position_name', 'description', 'requirements',
            'employment_type', 'location', 'open_date', 'close_date',
            'status', 'created_by', 'created_at', 'updated_at',
            'applications_count',
        )
        read_only_fields = ('id', 'slug', 'created_by', 'created_at', 'updated_at', 'applications_count', 'status')

    def get_applications_count(self, obj):
        return obj.applications.count()

    def _merged(self, data, instance=None):
        if instance is None:
            return {f: data.get(f) for f in Job.REQUIRED_FIELDS}
        return {f: data.get(f, getattr(instance, f, None)) for f in Job.REQUIRED_FIELDS}

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
            'id', 'title', 'slug', 'department_name', 'position_name',
            'description', 'requirements', 'employment_type', 'location',
            'open_date', 'close_date',
        )


class CandidateSerializer(serializers.ModelSerializer):
    cv_url = serializers.SerializerMethodField()
    job_title = serializers.CharField(source='job.title', read_only=True)
    applied_at = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = Candidate
        fields = (
            'id', 'job', 'job_title', 'full_name', 'email', 'phone',
            'cv_name', 'cv_url', 'source', 'status',
            'applied_at', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'job_title', 'cv_name', 'cv_url', 'source', 'status', 'applied_at', 'created_at', 'updated_at')

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