from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    LeaveBalanceViewSet,
    LeaveQuotaAdjustmentViewSet,
    LeaveRequestViewSet,
    LeaveTypeViewSet,
    WhosOffTodayView,
)

router = DefaultRouter()
router.register('types', LeaveTypeViewSet, basename='leave-type')
router.register('balances', LeaveBalanceViewSet, basename='leave-balance')
router.register('requests', LeaveRequestViewSet, basename='leave-request')
router.register('adjustments', LeaveQuotaAdjustmentViewSet, basename='leave-adjustment')

urlpatterns = [
    path('', include(router.urls)),
    path('whos-off-today/', WhosOffTodayView.as_view(), name='whos-off-today'),
]
