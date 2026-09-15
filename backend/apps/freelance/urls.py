from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    EventAssignmentViewSet,
    EventViewSet,
    FreelancerViewSet,
    SkillCategoryViewSet,
    SkillViewSet,
)

router = DefaultRouter()
router.register('freelancers', FreelancerViewSet, basename='freelancer')
router.register('skills', SkillViewSet, basename='skill')
router.register('skill-categories', SkillCategoryViewSet, basename='skill-category')
router.register('events', EventViewSet, basename='event')
router.register('assignments', EventAssignmentViewSet, basename='assignment')

urlpatterns = [
    path('', include(router.urls)),
]
