from django.contrib.auth import login as auth_login, logout as auth_logout, update_session_auth_hash
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import log_event
from apps.softdelete import SoftHardDeleteMixin

from .models import Role, User
from .permissions import IsAdminRole
from .presence import touch_last_seen
from .serializers import LoginSerializer, RoleSerializer, SelfAccountSerializer, UserAdminSerializer, UserSerializer


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from . import throttle

        email = str(request.data.get('email') or '').strip().lower()
        ip = throttle.client_ip(request)
        # Brute-force lockout: 5 failures per 15 min per email OR per IP
        # (checked before the password, so a locked account reveals nothing).
        wait = throttle.lock_seconds(email, ip)
        if wait:
            return self._locked(wait)
        serializer = LoginSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            if 'non_field_errors' not in serializer.errors:
                # Missing/malformed fields: not a password guess, not counted.
                return Response({'detail': 'Email dan password wajib diisi dengan benar.', **serializer.errors},
                                status=status.HTTP_400_BAD_REQUEST)
            throttle.record_failure(email, ip)
            wait = throttle.lock_seconds(email, ip)
            if wait:
                log_event(request, 'login', description=f'Login dikunci sementara: {email} (IP {ip})')
                return self._locked(wait)
            remaining = throttle.remaining_attempts(email, ip)
            return Response(
                {'detail': f'Email atau password salah. Sisa {remaining} percobaan lagi sebelum login dikunci sementara.',
                 'remaining_attempts': remaining},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = serializer.validated_data['user']
        throttle.clear_failures(email)
        auth_login(request, user)
        touch_last_seen(user, force=True)
        log_event(request, 'login', user=user)
        return Response(UserSerializer(user, context={'request': request}).data, status=status.HTTP_200_OK)

    @staticmethod
    def _locked(seconds):
        from .throttle import lock_message

        response = Response({'detail': lock_message(seconds), 'retry_after': seconds},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        response['Retry-After'] = str(seconds)
        return response


class LogoutView(APIView):
    def post(self, request):
        log_event(request, 'logout', user=request.user)
        auth_logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class HeartbeatView(APIView):
    """Session presence ping from an open HRIS tab (~every 45s).

    Session-authenticated + CSRF-checked: only the logged-in user can touch
    their OWN last_seen_at; no user id is accepted.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        last_seen_at = touch_last_seen(request.user)
        return Response({'last_seen_at': last_seen_at, 'is_online': True})


class CurrentUserView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user, context={'request': request}).data)

class SelfAccountView(APIView):
    """Self-service account edit (username/email/name/password) for any authenticated user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(SelfAccountSerializer(request.user).data)

    def patch(self, request):
        serializer = SelfAccountSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # Password change rotates the session auth hash; keep this session
        # logged in (other sessions of the user are invalidated as usual).
        update_session_auth_hash(request, user)
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

    def patch(self, request):
        """Direct self-edit of low-risk contact data (profile_changes.
        SELF_EDIT_FIELDS). Protected fields must go through a change request."""
        from apps.notifications.services import notify_profile_security
        from apps.personnel.profile_changes import SELF_EDIT_FIELDS, apply_self_edit
        from apps.personnel.serializers import EmployeeReadSerializer

        employee = getattr(getattr(request.user, 'personnel', None), 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        old_personal_email = employee.personal_email
        data = request.data.dict() if hasattr(request.data, 'dict') else dict(request.data)
        changed = apply_self_edit(employee, data)
        if changed:
            log_event(
                request, 'update', obj=employee,
                description=f'{employee.employee_id} updated own contact data: '
                            f'{", ".join(SELF_EDIT_FIELDS[f] for f in changed)}',
                changes_before={f: old for f, (old, _) in changed.items()},
                changes_after={f: new for f, (_, new) in changed.items()},
            )
            if 'personal_email' in changed:
                # Notify both addresses so an unauthorized change is noticed.
                notify_profile_security(
                    f'profile-email-change:{employee.pk}:{employee.updated_at:%Y%m%d%H%M%S%f}',
                    [old_personal_email, employee.personal_email],
                    'Email pribadi HRIS Anda diubah',
                    f'Halo {employee.full_name},\n\nEmail pribadi pada data HRIS Anda telah diubah dari '
                    f'"{old_personal_email or "-"}" menjadi "{employee.personal_email or "-"}".\n\n'
                    'Jika Anda tidak melakukan perubahan ini, segera hubungi HR.\n\nHRIS Feraco',
                )
        return Response(EmployeeReadSerializer(employee, context={'request': request}).data)


class MyChangeRequestListView(APIView):
    """Own data change requests: list (GET) and submit (POST multipart:
    `changes` JSON {field: new value}, optional `note`, `attachment`)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @staticmethod
    def _employee(request):
        return getattr(getattr(request.user, 'personnel', None), 'employee', None)

    def get(self, request):
        from apps.personnel.serializers import EmployeeChangeRequestSerializer

        employee = self._employee(request)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        qs = employee.change_requests.select_related('requested_by', 'reviewed_by')[:50]
        return Response(EmployeeChangeRequestSerializer(
            qs, many=True, context={'request': request, 'self_service': True}).data)

    def post(self, request):
        import json

        from rest_framework.exceptions import ValidationError

        from apps.notifications.services import notify_profile_change_submitted
        from apps.personnel.profile_changes import REQUEST_FIELDS, create_change_request
        from apps.personnel.serializers import EmployeeChangeRequestSerializer

        employee = self._employee(request)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        changes = request.data.get('changes')
        if isinstance(changes, str):
            try:
                changes = json.loads(changes)
            except ValueError:
                raise ValidationError({'changes': 'Format data perubahan tidak valid.'})
        cr = create_change_request(employee, request.user, changes, request.data.get('note', ''),
                                   request.FILES.get('attachment'))
        notify_profile_change_submitted(cr)
        log_event(request, 'create', obj=cr,
                  description=f'{employee.employee_id} requested data change: '
                              f'{", ".join(REQUEST_FIELDS[f] for f in cr.changes)}')
        return Response(EmployeeChangeRequestSerializer(cr, context={'request': request, 'self_service': True}).data,
                        status=status.HTTP_201_CREATED)


class MyChangeRequestDetailView(APIView):
    """Own request: POST .../cancel/ (PENDING only), GET .../attachment/."""

    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        from django.http import Http404

        employee = getattr(getattr(request.user, 'personnel', None), 'employee', None)
        cr = employee.change_requests.filter(pk=pk).first() if employee is not None else None
        if cr is None:
            raise Http404
        return cr

    def post(self, request, pk, action):
        from apps.personnel.serializers import EmployeeChangeRequestSerializer

        if action != 'cancel':
            return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
        cr = self._get(request, pk)
        if cr.status != 'PENDING':
            return Response({'detail': 'Hanya pengajuan yang menunggu persetujuan yang dapat dibatalkan.'},
                            status=status.HTTP_400_BAD_REQUEST)
        cr.status = 'CANCELLED'
        cr.save(update_fields=['status', 'updated_at'])
        log_event(request, 'update', obj=cr, description=f'Data change request {cr.pk} cancelled by employee')
        return Response(EmployeeChangeRequestSerializer(cr, context={'request': request, 'self_service': True}).data)

    def get(self, request, pk, action):
        from apps.personnel.profile_changes import ATTACHMENT_BUCKET
        from apps.personnel.storage import stream_file_response

        if action != 'attachment':
            return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
        cr = self._get(request, pk)
        if not cr.attachment_path:
            return Response({'detail': 'Tidak ada lampiran.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            return stream_file_response(ATTACHMENT_BUCKET, cr.attachment_path, cr.attachment_name)
        except Exception as exc:
            return Response({'detail': f'Gagal mengambil file dari storage: {str(exc)[:150]}'},
                            status=status.HTTP_502_BAD_GATEWAY)

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
    """Upload/replace/delete the logged-in employee's profile photo (self-service)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
    MAX_SIZE = 5 * 1024 * 1024

    def _employee(self, request):
        personnel = getattr(request.user, 'personnel', None)
        return getattr(personnel, 'employee', None)

    def post(self, request):
        from apps.personnel.storage import delete_object, is_configured, upload_bytes

        employee = self._employee(request)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        f = request.FILES.get('photo')
        if f is None:
            return Response({'detail': 'File foto wajib diunggah.'}, status=status.HTTP_400_BAD_REQUEST)
        if f.content_type not in self.ALLOWED_TYPES:
            return Response({'detail': 'Format harus JPG, PNG, atau WebP.'}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > self.MAX_SIZE:
            return Response({'detail': 'Ukuran maksimal 5MB.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'detail': 'Storage tidak dikonfigurasi.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if employee.photo:
            delete_object('employee-photos', employee.photo)
        ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[f.content_type]
        path = f'emp_{employee.id}_{int(timezone.now().timestamp())}.{ext}'
        try:
            upload_bytes('employee-photos', path, f.read(), content_type=f.content_type)
        except RuntimeError as exc:
            return Response({'detail': f'Gagal mengunggah ke storage: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)
        employee.photo = path
        employee.save(update_fields=['photo', 'updated_at'])
        log_event(request, 'update', obj=employee, description=f'{employee.employee_id} updated own profile photo')
        return Response({'photo': path})

    def delete(self, request):
        from apps.personnel.storage import delete_object, is_configured

        employee = self._employee(request)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)
        if employee.photo:
            if is_configured():
                delete_object('employee-photos', employee.photo)
            employee.photo = ''
            employee.save(update_fields=['photo', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

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
