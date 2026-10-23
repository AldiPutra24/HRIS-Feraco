from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DashboardHrView,
    DashboardManagementView,
    DepartmentViewSet,
    DocumentDownloadView,
    EmployeeChangeRequestViewSet,
    EmployeeViewSet,
    PositionViewSet,
)

router = DefaultRouter()
router.register('employees', EmployeeViewSet, basename='employee')
router.register('departments', DepartmentViewSet, basename='department')
router.register('positions', PositionViewSet, basename='position')
router.register('employee-change-requests', EmployeeChangeRequestViewSet, basename='employee-change-request')

urlpatterns = [
    path('', include(router.urls)),
    path('dashboard/hr/', DashboardHrView.as_view(), name='dashboard-hr'),
    path('dashboard/management/', DashboardManagementView.as_view(), name='dashboard-management'),
    path('documents/<int:pk>/download/', DocumentDownloadView.as_view(), name='document-download'),
]