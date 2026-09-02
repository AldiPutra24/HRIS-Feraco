from django.db.models import Q
from rest_framework import serializers

from apps.personnel.models import Employee

from .models import (
    Payroll,
    PayrollComponent,
    PayrollItem,
    PayrollPeriod,
    SalaryStructure,
)


class PayrollComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollComponent
        fields = (
            'id', 'name', 'code', 'category', 'calculation_type', 'default_amount',
            'is_active', 'description', 'sort_order', 'is_reimbursement',
        )
        read_only_fields = ('id',)

    def validate_code(self, value):
        value = (value or '').strip().upper()
        if not value:
            raise serializers.ValidationError('Kode wajib diisi.')
        return value


class SalaryStructureSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = SalaryStructure
        fields = (
            'id', 'employee', 'employee_name', 'effective_from', 'effective_to',
            'basic_salary', 'components', 'is_active', 'created_at',
        )
        read_only_fields = ('id', 'created_at', 'employee_name')

    def validate_components(self, value):
        """components must be a list of {code, name, amount} for fixed earnings."""
        if not isinstance(value, list):
            raise serializers.ValidationError('Komponen harus berupa daftar.')
        allowed = set()
        for comp in PayrollComponent.objects.filter(
            category=PayrollComponent.Category.EARNING_FIXED,
            is_active=True,
        ):
            allowed.add(comp.code)
        for item in value:
            if not isinstance(item, dict) or 'code' not in item:
                raise serializers.ValidationError('Setiap komponen harus memiliki code.')
            if item['code'] not in allowed:
                raise serializers.ValidationError(
                    f"Komponen '{item.get('code')}' bukan tunjangan tetap aktif."
                )
        return value

    def validate(self, attrs):
        instance = self.instance
        employee = attrs.get('employee') or getattr(instance, 'employee', None)
        if employee is None:
            raise serializers.ValidationError({'employee': 'Karyawan wajib diisi.'})
        eff_from = attrs.get('effective_from')
        eff_to = attrs.get('effective_to')
        # Newer effective date wins; keep history (no overwrite, only insert).
        qs = SalaryStructure.objects.filter(employee=employee, is_active=True)
        if instance:
            qs = qs.exclude(pk=instance.pk)
        if eff_from is None and instance is not None:
            eff_from = instance.effective_from
        if eff_to is None and instance is not None:
            eff_to = instance.effective_to
        # Prevent overlap with any other structure for the same employee.
        # Intervals [effective_from, effective_to] (None end = open/infinity).
        overlap = qs.filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=eff_from),
        )
        if eff_to:
            overlap = overlap.filter(effective_from__lte=eff_to)
        if overlap.exists():
            raise serializers.ValidationError(
                {'effective_from': 'Periode salary structure tumpang tindih dengan yang sudah ada.'}
            )
        return attrs


class PayrollPeriodSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    payroll_count = serializers.IntegerField(source='payrolls.count', read_only=True)

    class Meta:
        model = PayrollPeriod
        fields = (
            'id', 'period_month', 'period_year', 'period_start', 'period_end',
            'status', 'status_display', 'created_by', 'notes', 'payroll_count',
            'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'created_by', 'created_at', 'updated_at', 'payroll_count', 'status_display')

    def validate(self, attrs):
        period_month = attrs.get('period_month')
        period_year = attrs.get('period_year')
        if period_month is not None and (period_month < 1 or period_month > 12):
            raise serializers.ValidationError({'period_month': 'Bulan harus 1-12.'})
        if period_month is not None and period_year is not None:
            qs = PayrollPeriod.objects.filter(
                period_month=period_month, period_year=period_year
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'period_month': 'Periode bulan/tahun ini sudah ada.'}
                )
        return attrs


class PayrollItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollItem
        fields = (
            'id', 'payroll', 'payroll_component', 'component_name', 'component_code',
            'category', 'amount', 'source', 'description', 'created_at',
        )
        read_only_fields = ('id', 'payroll', 'created_at')


class PayrollSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    items = PayrollItemSerializer(many=True, read_only=True)

    class Meta:
        model = Payroll
        fields = (
            'id', 'period', 'employee', 'employee_name', 'basic_salary',
            'total_fixed_earning', 'total_variable_earning', 'total_deduction',
            'reimbursement_total', 'gross_salary', 'net_salary', 'items',
            'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'period', 'employee', 'basic_salary', 'total_fixed_earning',
            'total_variable_earning', 'total_deduction', 'reimbursement_total',
            'gross_salary', 'net_salary', 'created_at', 'updated_at',
        )
