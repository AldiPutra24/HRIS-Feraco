from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CandidateViewSet, JobViewSet, PublicJobViewSet

router = DefaultRouter()
router.register('jobs', JobViewSet, basename='job')
router.register('candidates', CandidateViewSet, basename='candidate')

urlpatterns = [
    path('', include(router.urls)),
    path('public/jobs/', PublicJobViewSet.as_view({'get': 'list'}), name='public-job-list'),
    path('public/jobs/<slug:slug>/', PublicJobViewSet.as_view({'get': 'retrieve'}), name='public-job-detail'),
]