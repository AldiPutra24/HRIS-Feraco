from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PayrollComponentViewSet,
    PayrollPeriodViewSet,
    PayrollViewSet,
    SalaryStructureViewSet,
)

router = DefaultRouter()
router.register('components', PayrollComponentViewSet, basename='payroll-component')
router.register('salary-structures', SalaryStructureViewSet, basename='salary-structure')
router.register('periods', PayrollPeriodViewSet, basename='payroll-period')
router.register('payrolls', PayrollViewSet, basename='payroll')

urlpatterns = [path('', include(router.urls))]
