from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import LeaveQuotaAdjustmentViewSet, LeaveBalanceViewSet, LeaveRequestViewSet, LeaveTypeViewSet

router = DefaultRouter()
router.register('types', LeaveTypeViewSet, basename='leave-type')
router.register('balances', LeaveBalanceViewSet, basename='leave-balance')
router.register('requests', LeaveRequestViewSet, basename='leave-request')
router.register('adjustments', LeaveQuotaAdjustmentViewSet, basename='leave-adjustment')

urlpatterns = [
    path('', include(router.urls)),
]
