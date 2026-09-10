from django.contrib import admin

from .models import (
    AnnualTaxBracket,
    EmployeeTaxProfile,
    Payroll,
    PayrollComponent,
    PayrollPeriod,
    SalaryStructure,
    TaxConfig,
    TerBracket,
)


@admin.register(PayrollComponent)
class PayrollComponentAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'category', 'calculation_type', 'default_amount', 'is_active', 'is_taxable', 'sort_order')
    list_filter = ('category', 'calculation_type', 'is_active', 'is_reimbursement', 'is_taxable')


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ('employee', 'effective_from', 'effective_to', 'basic_salary', 'is_active')
    list_filter = ('is_active', 'effective_from')
    search_fields = ('employee__full_name',)


class TerBracketInline(admin.TabularInline):
    model = TerBracket
    extra = 0


class AnnualTaxBracketInline(admin.TabularInline):
    model = AnnualTaxBracket
    extra = 0


@admin.register(TaxConfig)
class TaxConfigAdmin(admin.ModelAdmin):
    list_display = ('year', 'is_active', 'dtp_threshold', 'updated_at')
    list_filter = ('is_active',)
    inlines = [TerBracketInline, AnnualTaxBracketInline]


@admin.register(EmployeeTaxProfile)
class EmployeeTaxProfileAdmin(admin.ModelAdmin):
    list_display = ('employee', 'ptkp_status', 'tax_scheme', 'updated_at')
    list_filter = ('ptkp_status', 'tax_scheme')
    search_fields = ('employee__full_name',)


@admin.register(PayrollPeriod)
class PayrollPeriodAdmin(admin.ModelAdmin):
    list_display = ('period_month', 'period_year', 'status', 'period_start', 'period_end')
    list_filter = ('status', 'period_year')


@admin.register(Payroll)
class PayrollAdmin(admin.ModelAdmin):
    list_display = (
        'employee', 'period', 'gross_salary', 'total_deduction',
        'net_salary', 'is_dtp', 'transfer_amount',
    )
    list_filter = ('period__period_year', 'is_dtp')
    search_fields = ('employee__full_name',)
