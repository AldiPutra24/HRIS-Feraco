from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ReimbursementCategoryViewSet, ReimbursementViewSet

router = DefaultRouter()
router.register('categories', ReimbursementCategoryViewSet, basename='reimbursement-category')
router.register('', ReimbursementViewSet, basename='reimbursement')

urlpatterns = [
    path('', include(router.urls)),
]
