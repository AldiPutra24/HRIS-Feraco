from django.contrib import admin

from .models import PayrollComponent, SalaryStructure


@admin.register(PayrollComponent)
class PayrollComponentAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'category', 'calculation_type', 'default_amount', 'is_active', 'sort_order')
    list_filter = ('category', 'calculation_type', 'is_active', 'is_reimbursement')


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ('employee', 'effective_from', 'effective_to', 'basic_salary', 'is_active')
    list_filter = ('is_active', 'effective_from')
    search_fields = ('employee__full_name',)
