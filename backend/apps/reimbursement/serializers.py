import re

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
    amount_set_by_name = serializers.CharField(source='amount_set_by.username', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    attachment_url = serializers.SerializerMethodField()
    payment_proof_url = serializers.SerializerMethodField()

    class Meta:
        model = Reimbursement
        fields = (
            'id', 'employee', 'employee_name', 'category', 'category_name',
            'transaction_date', 'amount', 'approved_amount',
            'project_category', 'project_category_other',
            'description', 'bank_name', 'bank_account_name', 'bank_account_number', 'contact_email',
            'attachment_name',
            'attachment_url', 'status', 'status_display', 'submitted_at', 'approved_at',
            'rejected_at', 'paid_at', 'amount_set_by', 'amount_set_by_name', 'amount_set_at',
            'reviewer', 'reviewer_name',
            'rejection_reason', 'payment_reference', 'created_at', 'updated_at',
            'payment_proof_name', 'payment_proof_url',
        )
        read_only_fields = (
            'id', 'employee', 'status', 'status_display', 'submitted_at', 'approved_at',
            'rejected_at', 'paid_at', 'reviewer', 'created_at', 'updated_at',
            'approved_amount', 'amount_set_by', 'amount_set_by_name', 'amount_set_at', 'attachment_name',
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

    def validate_approved_amount(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Nominal disetujui tidak boleh negatif.')
        return value

    def _is_admin(self, request):
        if request is None:
            return False
        from apps.personnel.permissions import _role
        from .permissions import REIMBURSEMENT_ADMIN_ROLES
        return _role(request.user) in REIMBURSEMENT_ADMIN_ROLES

    REQUIRED_PAYMENT_FIELDS = (
        ('bank_name', 'Nama Bank'),
        ('bank_account_name', 'Nama Pemilik Rekening'),
        ('bank_account_number', 'Nomor Rekening'),
        ('contact_email', 'Email'),
        ('description', 'Deskripsi'),
    )

    def validate_bank_account_number(self, value):
        digits = re.sub(r'[\s-]', '', value or '')
        if digits and not re.fullmatch(r'\d{5,30}', digits):
            raise serializers.ValidationError('Nomor rekening hanya angka (5-30 digit).')
        return digits

    def validate_project_category(self, value):
        if not value:
            return value
        choices = dict(Reimbursement.PROJECT_CATEGORY_CHOICES)
        if value not in choices:
            raise serializers.ValidationError('Kategori project tidak valid.')
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

        # Nominal Disetujui is set ONLY by HR Staff through the review action
        # (never by PATCH/create — also not by HR Lead).
        if 'approved_amount' in getattr(self, 'initial_data', {}):
            raise serializers.ValidationError(
                {'approved_amount': 'Nominal disetujui hanya ditetapkan HR Staff melalui proses review.'}
            )

        # Bank account + contact email: required for new requests; on edit,
        # provided values may not be blanked.
        for field, label in self.REQUIRED_PAYMENT_FIELDS:
            if self.instance is None:
                value = (attrs.get(field) or '').strip()
                if not value:
                    raise serializers.ValidationError({field: f'{label} wajib diisi.'})
                attrs[field] = value
            elif field in attrs:
                value = (attrs.get(field) or '').strip()
                if not value:
                    raise serializers.ValidationError({field: f'{label} wajib diisi.'})
                attrs[field] = value

        approved = attrs.get('approved_amount', getattr(self.instance, 'approved_amount', None) if self.instance else None)
        amount = attrs.get('amount', getattr(self.instance, 'amount', None) if self.instance else None)
        if approved is not None and amount is not None and approved > amount:
            raise serializers.ValidationError({'approved_amount': 'Nominal disetujui tidak boleh melebihi nominal diajukan.'})

        # Project category rules: OTHER requires project_category_other; non-OTHER must clear it.
        project_category = attrs.get('project_category', getattr(self.instance, 'project_category', '') if self.instance else '')
        other_text = attrs.get('project_category_other', getattr(self.instance, 'project_category_other', '') if self.instance else '')
        if project_category == 'OTHER':
            if not (other_text or '').strip():
                raise serializers.ValidationError({'project_category_other': 'Wajib diisi jika kategori project adalah OTHER.'})
        else:
            attrs['project_category_other'] = ''
        return attrs

    def create(self, validated_data):
        validated_data.setdefault('status', 'DRAFT')
        return super().create(validated_data)