from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import OnboardingViewSet

router = DefaultRouter()
router.register('onboarding', OnboardingViewSet, basename='onboarding')

urlpatterns = [
    path('', include(router.urls)),
]
