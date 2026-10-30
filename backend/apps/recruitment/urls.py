from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .dashboards import PipelineDashboardView, TalentPoolDashboardView
from .profiles import CandidateProfileViewSet
from .views import (
    CandidateViewSet, FreelanceApplyFormViewSet, InterviewViewSet, JobViewSet, PublicFreelancePortalView,
    PublicApplyOptionsView, PublicApplyView, PublicJobViewSet,
)

router = DefaultRouter()
router.register('jobs', JobViewSet, basename='job')
router.register('candidates', CandidateViewSet, basename='candidate')
router.register('interviews', InterviewViewSet, basename='interview')
router.register('talent-pool', CandidateProfileViewSet, basename='talent-pool')
router.register('freelance-apply-forms', FreelanceApplyFormViewSet, basename='freelance-apply-form')

urlpatterns = [
    path('', include(router.urls)),
    path('dashboard/talent-pool/', TalentPoolDashboardView.as_view(), name='recruitment-dashboard-talent-pool'),
    path('dashboard/pipeline/', PipelineDashboardView.as_view(), name='recruitment-dashboard-pipeline'),
    path('public/apply-options/', PublicApplyOptionsView.as_view(), name='public-apply-options'),
    path('public/apply/', PublicApplyView.as_view(), name='public-apply'),
    path('public/jobs/', PublicJobViewSet.as_view({'get': 'list'}), name='public-job-list'),
    path('public/jobs/<slug:slug>/', PublicJobViewSet.as_view({'get': 'retrieve'}), name='public-job-detail'),
    path('public/freelance/apply/<slug:slug>/', PublicFreelancePortalView.as_view(), name='public-freelance-apply'),
]