from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    EmployeeTaxProfileViewSet,
    PayrollComponentViewSet,
    PayrollPeriodViewSet,
    PayrollViewSet,
    SalaryStructureViewSet,
    TaxConfigViewSet,
)

router = DefaultRouter()
router.register('tax-config', TaxConfigViewSet, basename='payroll-tax-config')
router.register('tax-profiles', EmployeeTaxProfileViewSet, basename='payroll-tax-profile')
router.register('components', PayrollComponentViewSet, basename='payroll-component')
router.register('salary-structures', SalaryStructureViewSet, basename='salary-structure')
router.register('periods', PayrollPeriodViewSet, basename='payroll-period')
router.register('payrolls', PayrollViewSet, basename='payroll')

urlpatterns = [path('', include(router.urls))]
