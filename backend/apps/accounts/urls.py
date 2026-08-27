from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('roles', views.RoleViewSet, basename='role')
router.register('users', views.UserAdminViewSet, basename='user')

urlpatterns = [
    path('', include(router.urls)),
    path('login/', views.LoginView.as_view(), name='login'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('me/', views.CurrentUserView.as_view(), name='me'),
    path('me/account/', views.SelfAccountView.as_view(), name='me-account'),
    path('me/employee/', views.CurrentEmployeeView.as_view(), name='me-employee'),
    path('me/employee/contracts/', views.CurrentEmployeeContractsView.as_view(), name='me-employee-contracts'),
]
