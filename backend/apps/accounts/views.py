from django.contrib.auth import login as auth_login, logout as auth_logout
from rest_framework import status, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..audit.services import log_event
from .models import Role, User
from .permissions import IsAdminRole
from .serializers import LoginSerializer, RoleSerializer, UserAdminSerializer, UserSerializer


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        auth_login(request, user)
        log_event(request, 'login', user=user)
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    def post(self, request):
        log_event(request, 'logout', user=request.user)
        auth_logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAdminRole]
    pagination_class = None

class UserAdminViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related('role').all()
    serializer_class = UserAdminSerializer
    permission_classes = [IsAdminRole]
    pagination_class = None
    search_fields = ['username', 'email', 'first_name', 'last_name']
    filterset_fields = ['role', 'is_active']
    ordering = ['id']

    def perform_create(self, serializer):
        user = serializer.save()
        log_event(self.request, 'create', obj=user, description=f'User {user.username} created')

    def perform_update(self, serializer):
        user = serializer.save()
        log_event(self.request, 'update', obj=user, description=f'User {user.username} updated')

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'Tidak dapat menghapus akun sendiri.'})
        log_event(self.request, 'delete', obj=instance, description=f'User {instance.username} deleted')
        instance.delete()
