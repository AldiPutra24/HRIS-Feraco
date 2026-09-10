from decimal import Decimal

from django.db.models import Q
from rest_framework import serializers

from apps.personnel.models import Employee

from .models import (
    AnnualTaxBracket,
    EmployeeTaxProfile,
    Payroll,
    PayrollComponent,
    PayrollItem,
    PayrollPeriod,
    SalaryStructure,
    TaxConfig,
    TerBracket,
)
from .tax import VALID_PTKP


class AnnualTaxBracketSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnnualTaxBracket
        fields = ('id', 'tax_config', 'layer_order', 'pkp_lower', 'pkp_upper', 'rate_pct')
        read_only_fields = ('id',)

    def validate(self, attrs):
        layer_order = attrs.get('layer_order', getattr(self.instance, 'layer_order', None))
        if layer_order is not None and not 1 <= layer_order <= 5:
            raise serializers.ValidationError(
                {'layer_order': 'Lapisan harus 1-5.'}
            )
        pkp_lower = attrs.get('pkp_lower', getattr(self.instance, 'pkp_lower', None))
        pkp_upper = attrs.get('pkp_upper', getattr(self.instance, 'pkp_upper', None))
        if pkp_lower is not None and pkp_upper is not None and pkp_upper <= pkp_lower:
            raise serializers.ValidationError(
                {'pkp_upper': 'Batas atas harus lebih besar dari batas bawah.'}
            )
        rate_pct = attrs.get('rate_pct', getattr(self.instance, 'rate_pct', None))
        if rate_pct is not None and rate_pct < 0:
            raise serializers.ValidationError({'rate_pct': 'Tarif tidak boleh negatif.'})
        return attrs


class TerBracketSerializer(serializers.ModelSerializer):
    class Meta:
        model = TerBracket
        fields = ('id', 'tax_config', 'ter_category', 'bruto_lower', 'bruto_upper', 'rate_pct')
        read_only_fields = ('id',)

    def validate(self, attrs):
        bruto_lower = attrs.get('bruto_lower', getattr(self.instance, 'bruto_lower', None))
        bruto_upper = attrs.get('bruto_upper', getattr(self.instance, 'bruto_upper', None))
        if bruto_lower is not None and bruto_upper is not None and bruto_upper <= bruto_lower:
            raise serializers.ValidationError(
                {'bruto_upper': 'Batas atas harus lebih besar dari batas bawah.'}
            )
        rate_pct = attrs.get('rate_pct', getattr(self.instance, 'rate_pct', None))
        if rate_pct is not None and rate_pct < 0:
            raise serializers.ValidationError({'rate_pct': 'Tarif tidak boleh negatif.'})
        return attrs

class TaxConfigSerializer(serializers.ModelSerializer):
    annual_brackets = AnnualTaxBracketSerializer(many=True, read_only=True)
    ter_brackets = TerBracketSerializer(many=True, read_only=True)

    class Meta:
        model = TaxConfig
        fields = (
            'id', 'year', 'is_active', 'dtp_threshold', 'annual_layer_limits',
            'ter_brackets', 'annual_brackets', 'notes', 'created_at', 'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def validate_annual_layer_limits(self, value):
        if value in (None, []):
            return []
        if not isinstance(value, list) or len(value) != 4:
            raise serializers.ValidationError('Harus berisi tepat 4 batas lapisan tahunan.')
        try:
            values = [Decimal(str(v)) for v in value]
        except Exception:
            raise serializers.ValidationError('Batas lapisan harus angka.')
        for a, b in zip(values, values[1:]):
            if b <= a:
                raise serializers.ValidationError('Batas lapisan harus naik (membesar).')
        return value

    def validate_year(self, value):
        qs = TaxConfig.objects.filter(year=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Konfigurasi pajak untuk tahun ini sudah ada.')
        return value



class EmployeeTaxProfileSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = EmployeeTaxProfile
        fields = ('id', 'employee', 'employee_name', 'ptkp_status', 'tax_scheme', 'updated_at')
        read_only_fields = ('id', 'updated_at', 'employee_name')

    def validate_ptkp_status(self, value):
        value = (value or '').strip().upper()
        if value not in VALID_PTKP:
            raise serializers.ValidationError('Status PTKP tidak valid (TK/0 s.d. K/3).')
        return value


class PayrollComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollComponent
        fields = (
            'id', 'name', 'code', 'category', 'calculation_type', 'default_amount',
            'is_active', 'description', 'sort_order', 'is_reimbursement', 'is_taxable',
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
            'reimbursement_total', 'gross_salary', 'net_salary',
            'pro_rata_factor', 'unpaid_leave_days', 'ptkp_status_snapshot',
            'ter_category_snapshot', 'pph_prior_months', 'pph_annual',
            'is_dtp', 'transfer_amount',
            'items', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'period', 'employee', 'basic_salary', 'total_fixed_earning',
            'total_variable_earning', 'total_deduction', 'reimbursement_total',
            'gross_salary', 'net_salary', 'pro_rata_factor', 'unpaid_leave_days',
            'ptkp_status_snapshot', 'ter_category_snapshot', 'pph_prior_months',
            'pph_annual', 'is_dtp', 'transfer_amount', 'created_at', 'updated_at',
        )
