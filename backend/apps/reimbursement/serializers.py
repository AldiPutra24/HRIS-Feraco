from rest_framework import serializers

from .models import Reimbursement, ReimbursementCategory
from .permissions import _employee_for

class ReimbursementCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ReimbursementCategory
        fields = ('id', 'name', 'code', 'is_active', 'requires_attachment', 'description')
        read_only_fields = ('id',)

class ReimbursementSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    reviewer_name = serializers.CharField(source='reviewer.username', read_only=True)
    attachment_url = serializers.SerializerMethodField()
    payment_proof_url = serializers.SerializerMethodField()

    class Meta:
        model = Reimbursement
        fields = (
            'id', 'employee', 'employee_name', 'category', 'category_name',
            'transaction_date', 'amount', 'description', 'attachment_name',
            'attachment_url', 'status', 'submitted_at', 'approved_at',
            'rejected_at', 'paid_at', 'reviewer', 'reviewer_name',
            'rejection_reason', 'payment_reference', 'created_at', 'updated_at',
            'payment_proof_name', 'payment_proof_url',
        )
        read_only_fields = (
            'id', 'employee', 'status', 'submitted_at', 'approved_at',
            'rejected_at', 'paid_at', 'reviewer', 'created_at', 'updated_at',
            'employee_name', 'category_name', 'reviewer_name', 'attachment_url',
            'payment_proof_name', 'payment_proof_url',
        )

    def get_attachment_url(self, obj):
        if not obj.attachment_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/reimbursements/{obj.id}/attachment/')

    def get_payment_proof_url(self, obj):
        if not obj.payment_proof_path:
            return None
        request = self.context.get('request')
        if request is None:
            return None
        return request.build_absolute_uri(f'/api/reimbursements/{obj.id}/payment_proof/')

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Jumlah harus lebih dari 0.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        employee = attrs.get('employee')
        if employee is None:
            employee = getattr(self.instance, 'employee', None)
        if employee is None and request is not None:
            employee = _employee_for(request.user)
        if self.instance is None:
            if employee is None:
                raise serializers.ValidationError({'employee': 'Karyawan wajib diisi.'})
            if employee.employment_status != 'ACTIVE':
                raise serializers.ValidationError({'employee': 'Karyawan tidak aktif tidak dapat mengajukan.'})
        return attrs

    def create(self, validated_data):
        validated_data.setdefault('status', 'DRAFT')
        return super().create(validated_data)