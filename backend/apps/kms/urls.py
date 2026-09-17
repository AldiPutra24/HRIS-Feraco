from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import KnowledgeArticleViewSet, KnowledgeCategoryViewSet

router = DefaultRouter()
router.register('categories', KnowledgeCategoryViewSet, basename='kms-category')
router.register('articles', KnowledgeArticleViewSet, basename='kms-article')

urlpatterns = [
    path('', include(router.urls)),
]
