from django.contrib.auth import login as auth_login, logout as auth_logout
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import log_event
from apps.softdelete import SoftHardDeleteMixin

from .models import Role, User
from .permissions import IsAdminRole
from .serializers import LoginSerializer, RoleSerializer, SelfAccountSerializer, UserAdminSerializer, UserSerializer


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

class SelfAccountView(APIView):
    """Self-service account edit (username/email/name/password) for any authenticated user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(SelfAccountSerializer(request.user).data)

    def patch(self, request):
        serializer = SelfAccountSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_event(request, 'update', obj=user, description=f'User {user.username} updated own account')
        return Response(SelfAccountSerializer(user).data)

class CurrentEmployeeView(APIView):
    """Profile of the Employee linked to the logged-in user (self-service)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.personnel.serializers import EmployeeReadSerializer

        personnel = getattr(request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(EmployeeReadSerializer(employee, context={'request': request}).data)

class CurrentEmployeeContractsView(APIView):
    """Contracts of the Employee linked to the logged-in user (self-service)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.personnel.models import EmployeeContract
        from apps.personnel.serializers import EmployeeContractSerializer

        personnel = getattr(request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        contracts = EmployeeContract.objects.filter(employee=employee)
        return Response(EmployeeContractSerializer(contracts, many=True, context={'request': request}).data)


class CurrentEmployeePhotoView(APIView):
    """Upload/replace the logged-in employee's profile photo (self-service)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from apps.personnel.models import Employee
        from apps.personnel.storage import delete_object, is_configured, upload_bytes

        personnel = getattr(request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        f = request.FILES.get('photo')
        if f is None:
            return Response({'detail': 'File foto wajib diunggah.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if employee.photo:
            delete_object('employee-photos', employee.photo)
        ext = (f.name.split('.')[-1] if '.' in f.name else 'jpg')[:8]
        path = f'emp_{employee.id}_{int(timezone.now().timestamp())}.{ext}'
        upload_bytes('employee-photos', path, f.read(), content_type=f.content_type or 'image/jpeg')
        employee.photo = path
        employee.save(update_fields=['photo', 'updated_at'])
        return Response({'photo': path})

class RoleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAdminRole]
    pagination_class = None

class UserAdminViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    queryset = User.objects.select_related('role', 'personnel__employee').all()
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

    def _assert_not_self(self, instance):
        if instance.pk == self.request.user.pk:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'Tidak dapat menghapus akun sendiri.'})

    def soft_delete(self, instance):
        self._assert_not_self(instance)
        log_event(self.request, 'delete', obj=instance, description=f'User {instance.username} deactivated')
        instance.is_active = False
        instance.save(update_fields=['is_active'])

    def hard_delete(self, instance):
        self._assert_not_self(instance)
        log_event(self.request, 'delete', obj=instance, description=f'User {instance.username} hard-deleted')
        instance.delete()
