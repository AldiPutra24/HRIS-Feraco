from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    NotificationEventConfigViewSet,
    NotificationSettingViewSet,
    NotificationViewSet,
)

router = DefaultRouter()
router.register('notifications', NotificationViewSet, basename='notification')
router.register('notification-settings', NotificationSettingViewSet, basename='notification-setting')
router.register('notification-events', NotificationEventConfigViewSet, basename='notification-event')

urlpatterns = [
    path('', include(router.urls)),
]
