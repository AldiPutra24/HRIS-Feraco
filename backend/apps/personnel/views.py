import datetime
import io

from django.db.models import Max, Q
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.audit.services import log_event
from apps.softdelete import SoftHardDeleteMixin

from .models import (
    Department,
    Employee,
    EmployeeChangeRequest,
    EmployeeContract,
    EmployeeDocument,
    EmploymentHistory,
    Position,
)
from .permissions import IsHRStaff, IsManagementViewer, _role, team_scope_ids
from .services import set_current_contract, sync_contract_status
from .serializers import (
    DepartmentSerializer,
    EmployeeContractSerializer,
    EmployeeDocumentSerializer,
    EmployeeReadSerializer,
    EmployeeSerializer,
    EmploymentHistorySerializer,
    PositionSerializer,
)
from .storage import delete_object, is_configured, upload_bytes


def next_employee_id():
    """Generate the next sequential employee id: EMP0001, EMP0002, ..."""
    nums = [
        int(eid[3:])
        for eid in Employee.objects.filter(employee_id__startswith='EMP')
        .values_list('employee_id', flat=True)
        if eid[3:].isdigit()
    ]
    return f'EMP{max(nums, default=0) + 1:04d}'


IMPORT_FIELDS = [
    'full_name', 'nik', 'birth_place', 'birth_date', 'address', 'phone',
    'personal_email', 'company_email', 'emergency_contact_name', 'emergency_contact_phone',
    'bank_account_number', 'bank_account_name', 'npwp', 'bpjs_kesehatan',
    'bpjs_ketenagakerjaan', 'department', 'position', 'join_date', 'employment_status',
]


def _cell(row, key):
    value = row.get(key)
    if value is None:
        return ''
    if isinstance(value, datetime.date):
        return value.isoformat()[:10]
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _resolve_department(name):
    if not name:
        return None
    return Department.objects.filter(name__iexact=name).first()


def _resolve_position(name):
    if not name:
        return None
    return Position.objects.filter(name__iexact=name).first()


class EmployeeViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    # contracts prefetched once: list rows show contract summary + accumulation.
    queryset = Employee.objects.select_related('department', 'position', 'manager').prefetch_related('contracts').all()
    serializer_class = EmployeeSerializer
    permission_classes = [IsHRStaff]
    search_fields = ['full_name', 'employee_id', 'nik', 'personal_email', 'company_email']
    ordering_fields = ['full_name', 'employee_id', 'join_date', 'created_at']
    filterset_fields = ['department', 'position', 'employment_status', 'status', 'manager']
    # Honor ?page_size= (frontend dropdowns request page_size=1000).
    pagination_class = type('LargePagePagination', (PageNumberPagination,), {'page_size_query_param': 'page_size'})

    def _is_management(self):
        return _role(self.request.user) in ('MANAGEMENT', 'GENERAL_MANAGER')

    def get_serializer_class(self):
        if self.action in ('list', 'retrieve'):
            return EmployeeReadSerializer
        return EmployeeSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        # MANAGEMENT: read-only scope to their team (Employee.manager hierarchy).
        # GENERAL_MANAGER: sees ALL employees — GM oversees the whole company,
        # not just their reporting subtree (still read-only via permission).
        if self._is_management():
            if _role(self.request.user) == 'GENERAL_MANAGER':
                return qs
            report_ids = team_scope_ids(self.request.user)
            return qs.filter(id__in=report_ids)
        q = self.request.query_params.get('search')
        if q:
            qs = qs.filter(
                Q(full_name__icontains=q)
                | Q(employee_id__icontains=q)
                | Q(nik__icontains=q)
                | Q(personal_email__icontains=q)
                | Q(company_email__icontains=q)
            )
        position_role = self.request.query_params.get('position_role')
        if position_role in (Position.ROLE_EMPLOYEE, Position.ROLE_MANAGEMENT):
            qs = qs.filter(position__isnull=False, position__role=position_role)
        return qs

    @staticmethod
    def _photo_filename(emp):
        ext = emp.photo.rsplit('.', 1)[-1].lower() if '.' in emp.photo else 'jpg'
        slug = ''.join(c.lower() if c.isalnum() else '-' for c in emp.full_name).strip('-')
        slug = '-'.join(s for s in slug.split('-') if s) or 'karyawan'
        return f'foto-{slug}.{ext}'

    @action(detail=True, methods=['get'], url_path='photo', permission_classes=[IsAuthenticated])
    def photo(self, request, pk=None):
        """Profile photo streamed by the backend (the browser never talks to
        the storage provider: R2/Supabase hosts may be blocked on some
        networks). Visible to the employee themself and to every role that
        may read this employee (same scope as retrieve). `?download=1` =
        original file as attachment (HR only). URLs carry `?v=<photo>` so
        the private browser cache is safe.
        """
        from .permissions import READ_ROLES, employee_for
        from .storage import stream_file_response

        emp = Employee.objects.filter(pk=pk).first()
        own = employee_for(request.user)
        is_self = emp is not None and own is not None and own.pk == emp.pk
        visible = is_self or (
            emp is not None and _role(request.user) in READ_ROLES and self.get_queryset().filter(pk=emp.pk).exists()
        )
        if not visible or not emp.photo:
            return Response({'detail': 'Foto tidak ditemukan.'}, status=status.HTTP_404_NOT_FOUND)
        download = request.query_params.get('download') == '1'
        if download and _role(request.user) not in {'ADMIN', 'HR_STAFF', 'HR_LEAD'}:
            return Response({'detail': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            response = stream_file_response('employee-photos', emp.photo, self._photo_filename(emp),
                                            attachment=download, cache_seconds=0 if download else 86400)
        except Exception as exc:
            return Response({'detail': f'Gagal mengambil foto dari storage: {str(exc)[:150]}'},
                            status=status.HTTP_502_BAD_GATEWAY)
        if download:
            log_event(request, 'download', obj=emp, description=f'Profile photo {emp.employee_id} downloaded')
        return response

    @action(detail=True, methods=['get'], url_path='photo/download')
    def photo_download(self, request, pk=None):
        """Link to download the employee's ORIGINAL profile photo file.

        HR-only (Admin / HR Lead / HR Staff). Returns `{url, filename}`; the
        url streams the file from the backend with a tidy download filename
        like 'foto-nama-karyawan.jpg' (no storage signed URL).
        """
        if _role(request.user) not in {'ADMIN', 'HR_STAFF', 'HR_LEAD'}:
            return Response({'detail': 'Not allowed.'}, status=status.HTTP_403_FORBIDDEN)
        emp = self.get_object()
        if not emp.photo:
            return Response({'detail': 'Karyawan belum memiliki foto profil.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        url = request.build_absolute_uri(f'/api/employees/{emp.pk}/photo/?download=1')
        return Response({'url': url, 'filename': self._photo_filename(emp)})

    def _block_management_detail_tabs(self):
        """MANAGEMENT sees team Overview + Employment only: contracts, history
        and documents of their team are HR data (GM keeps read access)."""
        if _role(self.request.user) == 'MANAGEMENT':
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Management tidak dapat melihat data kontrak, riwayat, atau dokumen karyawan.')

    def _block_management_write(self):
        """Management Karyawan access is view-only for every write action."""
        if self._is_management():
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Management hanya dapat melihat data bawahan langsung.')

    @action(detail=False, methods=['get'])
    def reporting_candidates(self, request):
        """Valid Reporting To candidates for an employee with the given position.

        Rule: an employee may report only to an ACTIVE employee whose
        Position.role == MANAGEMENT and who is in the same department as the
        employee's position. Self is excluded. No position -> empty list.
        """
        position_id = request.query_params.get('position')
        exclude_id = request.query_params.get('exclude')
        if not position_id:
            return Response([])
        position = Position.objects.filter(pk=position_id).select_related('department').first()
        if not position or not position.department_id:
            return Response([])
        qs = Employee.objects.filter(
            department_id=position.department_id,
            position__role=Position.ROLE_MANAGEMENT,
            employment_status='ACTIVE',
        ).select_related('position')
        # General Managers are also valid Reporting To candidates, regardless of
        # department (GM may oversee multiple departments).
        gm_ids = list(
            Employee.objects.filter(
                user__role__key='GENERAL_MANAGER', employment_status='ACTIVE'
            ).values_list('id', flat=True)
        )
        qs = (qs | Employee.objects.filter(id__in=gm_ids)).distinct()
        if exclude_id:
            qs = qs.exclude(pk=exclude_id)
        data = [
            {'id': e.id, 'full_name': e.full_name, 'position_name': e.position.name if e.position else ''}
            for e in qs
        ]
        return Response(data)

    def perform_create(self, serializer):
        self._block_management_write()
        employee = serializer.save(employee_id=next_employee_id())
        log_event(self.request, 'create', obj=employee, description=f'Employee {employee.employee_id} created')

    def perform_update(self, serializer):
        self._block_management_write()
        old = self.get_object()
        before = EmployeeSerializer(old).data
        employee = serializer.save()
        after = EmployeeSerializer(employee).data
        log_event(self.request, 'update', obj=employee, description=f'Employee {employee.employee_id} updated', changes_before=before, changes_after=after)

    def soft_delete(self, instance):
        # Soft-delete: keep history/contracts/documents intact.
        instance.status = 'INACTIVE'
        instance.employment_status = 'INACTIVE'
        instance.save(update_fields=['status', 'employment_status', 'updated_at'])
        log_event(self.request, 'delete', obj=instance, description=f'Employee {instance.employee_id} deactivated')

    def hard_delete(self, instance):
        employee_id = instance.employee_id
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Employee {employee_id} hard-deleted')

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def import_csv(self, request):
        self._block_management_write()
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)

        raw = upload.read()
        name = (upload.name or '').lower()
        if not name.endswith('.xlsx'):
            return Response({'file': 'Hanya file XLSX yang didukung.'}, status=status.HTTP_400_BAD_REQUEST)
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None)
        if not header:
            return Response({'file': 'XLSX kosong.'}, status=status.HTTP_400_BAD_REQUEST)
        keys = [str(h).strip() if h is not None else '' for h in header]
        reader = ({keys[i]: (cell if cell is not None else '') for i, cell in enumerate(row)} for row in rows)

        created, errors = 0, []
        for i, row in enumerate(reader, start=2):
            if not any((row.get(k) or '').strip() for k in row):
                continue
            try:
                employee = Employee(
                    employee_id=next_employee_id(),
                    full_name=_cell(row, 'full_name'),
                    nik=_cell(row, 'nik') or None,
                    birth_place=_cell(row, 'birth_place'),
                    birth_date=_cell(row, 'birth_date') or None,
                    address=_cell(row, 'address'),
                    phone=_cell(row, 'phone'),
                    personal_email=_cell(row, 'personal_email'),
                    company_email=_cell(row, 'company_email'),
                    emergency_contact_name=_cell(row, 'emergency_contact_name'),
                    emergency_contact_phone=_cell(row, 'emergency_contact_phone'),
                    bank_account_number=_cell(row, 'bank_account_number'),
                    bank_account_name=_cell(row, 'bank_account_name'),
                    npwp=_cell(row, 'npwp'),
                    bpjs_kesehatan=_cell(row, 'bpjs_kesehatan'),
                    bpjs_ketenagakerjaan=_cell(row, 'bpjs_ketenagakerjaan'),
                    placement=_cell(row, 'placement') or None,
                    religion=_cell(row, 'religion') or None,
                    gender=_cell(row, 'gender') or None,
                    marital_status=_cell(row, 'marital_status') or None,
                    department=_resolve_department(_cell(row, 'department')),
                    position=_resolve_position(_cell(row, 'position')),
                    join_date=_cell(row, 'join_date') or None,
                    employment_status=_cell(row, 'employment_status') or 'ACTIVE',
                )
                employee.full_clean()
                employee.save()
                created += 1
            except Exception as exc:  # noqa: BLE001 - per-row error capture
                errors.append({'row': i, 'error': str(exc)})

        log_event(request, 'create', obj=None, description=f'Imported {created} employees via CSV')
        return Response({'created': created, 'errors': errors}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def contracts(self, request, pk=None):
        self._block_management_detail_tabs()
        employee = self.get_object()
        if request.method == 'POST':
            self._block_management_write()
        if request.method == 'GET':
            sync_contract_status()
            data = EmployeeContractSerializer(
                employee.contracts.filter(deleted_at__isnull=True), many=True, context={'request': request}
            ).data
            return Response(data)
        serializer = EmployeeContractSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        seq = serializer.validated_data.get('pkwt_sequence')
        if seq is not None:
            prior = employee.contracts.filter(pkwt_sequence__isnull=False, deleted_at__isnull=True)
            contract_pk = serializer.instance.pk if serializer.instance else None
            if contract_pk:
                prior = prior.exclude(pk=contract_pk)
            max_seq = prior.aggregate(m=Max('pkwt_sequence'))['m']
            if max_seq is not None and seq <= max_seq:
                from rest_framework.exceptions import ValidationError

                raise ValidationError(
                    {'pkwt_sequence': f'Urutan PKWT tidak boleh lebih kecil atau sama dengan kontrak sebelumnya (terakhir: PKWT ke-{max_seq}).'}
                )
        start_date = serializer.validated_data.get('start_date')
        if start_date:
            current = employee.contracts.filter(status='ACTIVE').order_by('-start_date').first()
            if current and current.end_date and start_date <= current.end_date:
                from rest_framework.exceptions import ValidationError

                raise ValidationError(
                    {'start_date': f'Tanggal mulai harus setelah {current.end_date} (akhir kontrak aktif).'}
                )
        contract = serializer.save(employee=employee)
        log_event(
            request,
            'create',
            obj=contract,
            description=f'Contract {contract.contract_number or contract.contract_type} added ({contract.status})',
        )
        return Response(EmployeeContractSerializer(contract, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], url_path=r'contracts/(?P<contract_pk>\d+)/edit')
    def edit_contract(self, request, pk=None, contract_pk=None):
        self._block_management_write()
        employee = self.get_object()
        contract = EmployeeContract.objects.filter(pk=contract_pk, employee=employee).first()
        if contract is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if contract.status not in ('DRAFT', 'ACTIVE'):
            return Response({'detail': 'Only draft or active contracts can be edited.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmployeeContractSerializer(contract, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        contract = serializer.save()
        log_event(request, 'update', obj=contract, description=f'Contract {contract.contract_number or contract.contract_type} edited')
        return Response(EmployeeContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path=r'contracts/(?P<contract_pk>\d+)/activate')
    def activate_contract(self, request, pk=None, contract_pk=None):
        self._block_management_write()
        employee = self.get_object()
        contract = EmployeeContract.objects.filter(pk=contract_pk, employee=employee).first()
        if contract is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if contract.end_date is None and contract.contract_type != 'PKWTT':
            return Response({'detail': 'Kontrak aktif wajib memiliki tanggal selesai.'}, status=status.HTTP_400_BAD_REQUEST)
        set_current_contract(contract)
        log_event(request, 'activate', obj=contract, description=f'Contract {contract.contract_number or contract.contract_type} activated')
        return Response(EmployeeContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path=r'contracts/(?P<contract_pk>\d+)/terminate')
    def terminate_contract(self, request, pk=None, contract_pk=None):
        self._block_management_write()
        employee = self.get_object()
        contract = EmployeeContract.objects.filter(pk=contract_pk, employee=employee).first()
        if contract is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if contract.status != 'ACTIVE':
            return Response({'detail': 'Only an active contract can be terminated.'}, status=status.HTTP_400_BAD_REQUEST)
        contract.status = 'TERMINATED'
        contract.termination_date = request.data.get('termination_date') or None
        contract.termination_reason = request.data.get('termination_reason', '')
        contract.save(update_fields=['status', 'termination_date', 'termination_reason', 'updated_at'])
        log_event(request, 'terminate', obj=contract, description=f'Contract {contract.contract_number or contract.contract_type} terminated')
        return Response(EmployeeContractSerializer(contract, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path=r'contracts/(?P<contract_pk>\d+)/renew')
    def renew_contract(self, request, pk=None, contract_pk=None):
        self._block_management_write()
        employee = self.get_object()
        current = EmployeeContract.objects.filter(pk=contract_pk, employee=employee).first()
        if current is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if current.status != 'ACTIVE':
            return Response({'detail': 'Only an active contract can be renewed.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = EmployeeContractSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        old_number = current.contract_number or current.contract_type
        current.status = 'RENEWED'
        current.save(update_fields=['status', 'updated_at'])

        renewed = serializer.save(employee=employee)
        log_event(
            request,
            'renew',
            obj=renewed,
            description=f'Contract {old_number} renewed → {renewed.contract_number or renewed.contract_type}',
        )
        return Response(EmployeeContractSerializer(renewed, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'contracts/(?P<contract_pk>\d+)')
    def delete_contract(self, request, pk=None, contract_pk=None):
        from apps.personnel.permissions import _role

        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Only admin can delete contracts.'}, status=status.HTTP_403_FORBIDDEN)
        contract = EmployeeContract.objects.filter(pk=contract_pk, employee_id=pk).first()
        if contract is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        # Soft-delete: mark deleted_at, keep record for history/audit.
        contract.deleted_at = timezone.now()
        contract.save(update_fields=['deleted_at', 'updated_at'])
        log_event(request, 'delete', obj=None, description=f'Contract {contract.contract_type} deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['delete'], url_path=r'contracts/(?P<contract_pk>\d+)/hard-delete')
    def hard_delete_contract(self, request, pk=None, contract_pk=None):
        from apps.personnel.permissions import _role

        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Only admin can delete contracts.'}, status=status.HTTP_403_FORBIDDEN)
        contract = EmployeeContract.objects.filter(pk=contract_pk, employee_id=pk).first()
        if contract is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        contract.delete()
        log_event(request, 'delete', obj=None, description=f'Contract {contract.contract_type} hard-deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'])
    def history(self, request, pk=None):
        self._block_management_detail_tabs()
        employee = self.get_object()
        if request.method == 'POST':
            self._block_management_write()
        if request.method == 'GET':
            data = EmploymentHistorySerializer(employee.history.all(), many=True).data
            return Response(data)
        serializer = EmploymentHistorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = serializer.save(employee=employee)
        log_event(request, 'create', obj=record, description=f'History {record.history_type} added')
        return Response(EmploymentHistorySerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], parser_classes=[MultiPartParser, FormParser])
    def documents(self, request, pk=None):
        self._block_management_detail_tabs()
        employee = self.get_object()
        if request.method == 'POST':
            self._block_management_write()
        if request.method == 'GET':
            data = EmployeeDocumentSerializer(
                employee.documents.filter(deleted_at__isnull=True), many=True, context={'request': request}
            ).data
            return Response(data)

        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not is_configured():
            return Response({'file': 'Storage is not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        contract_id = request.data.get('contract')
        contract = None
        if contract_id:
            contract = EmployeeContract.objects.filter(id=contract_id, employee=employee).first()

        version = 1
        existing = employee.documents.filter(name=upload.name).order_by('-version').first()
        if existing:
            version = existing.version + 1

        path = f'employees/{employee.pk}/{version}-{upload.name}'
        raw = upload.read()
        try:
            upload_bytes('employee-documents', path, raw, content_type=upload.content_type or 'application/octet-stream')
        except Exception as exc:
            # Storage/network failure must not surface as a bare 500.
            return Response(
                {'detail': f'Gagal mengunggah dokumen ke storage: {str(exc)[:150]}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        doc = EmployeeDocument.objects.create(
            employee=employee,
            contract=contract,
            name=upload.name,
            storage_path=path,
            content_type=upload.content_type or '',
            size=upload.size,
            version=version,
            uploaded_by=request.user,
        )
        log_event(request, 'upload', obj=doc, description=f'Document {doc.name} v{version} uploaded')
        return Response(EmployeeDocumentSerializer(doc, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'documents/(?P<doc_pk>\d+)')
    def delete_document(self, request, pk=None, doc_pk=None):
        from apps.personnel.permissions import _role

        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Only admin can delete documents.'}, status=status.HTTP_403_FORBIDDEN)
        doc = EmployeeDocument.objects.filter(pk=doc_pk, employee_id=pk).first()
        if doc is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        # Soft-delete: mark deleted_at, keep blob + metadata for audit.
        doc.deleted_at = timezone.now()
        doc.save(update_fields=['deleted_at'])
        log_event(request, 'delete', obj=None, description=f'Document {doc.name} deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['delete'], url_path=r'documents/(?P<doc_pk>\d+)/hard-delete')
    def hard_delete_document(self, request, pk=None, doc_pk=None):
        from apps.personnel.permissions import _role

        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Only admin can delete documents.'}, status=status.HTTP_403_FORBIDDEN)
        doc = EmployeeDocument.objects.filter(pk=doc_pk, employee_id=pk).first()
        if doc is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if is_configured():
            delete_object('employee-documents', doc.storage_path)
        doc.delete()
        log_event(request, 'delete', obj=None, description=f'Document {doc.name} hard-deleted')
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentDownloadView(generics.GenericAPIView):
    permission_classes = [IsHRStaff]

    def get(self, request, pk):
        # MANAGEMENT has no access to employee documents (Overview/Employment
        # only); GM and HR read all.
        if _role(request.user) == 'MANAGEMENT':
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        docs = EmployeeDocument.objects.filter(deleted_at__isnull=True)
        doc = docs.filter(pk=pk).first()
        if doc is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        # Served through the backend instead of redirecting to a Supabase
        # signed URL: signed URLs fail (InvalidSignature) for filenames with
        # ',' or '&', e.g. "Admin Finance, Accounting, and Tax".
        from .storage import stream_file_response

        try:
            response = stream_file_response('employee-documents', doc.storage_path, doc.name)
        except Exception as exc:
            return Response(
                {'detail': f'Gagal mengambil dokumen dari storage: {str(exc)[:150]}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        log_event(request, 'download', obj=doc, description=f'Document {doc.name} downloaded')
        return response


class DepartmentViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsHRStaff]
    pagination_class = None
    search_fields = ['name', 'code']
    filterset_fields = ['is_active']

    def perform_create(self, serializer):
        dept = serializer.save()
        log_event(self.request, 'create', obj=dept, description=f'Department {dept.name} created')

    def perform_update(self, serializer):
        dept = serializer.save()
        log_event(self.request, 'update', obj=dept, description=f'Department {dept.name} updated')

    def _check_in_use(self, instance):
        count = instance.employees.count()
        if count:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': f'Department masih digunakan oleh {count} karyawan.'})

    def soft_delete(self, instance):
        self._check_in_use(instance)
        name = instance.name
        # Soft-delete: preserve audit history referencing this department.
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        log_event(self.request, 'delete', obj=instance, description=f'Department {name} deactivated')

    def hard_delete(self, instance):
        name = instance.name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Department {name} hard-deleted')


class PositionViewSet(SoftHardDeleteMixin, viewsets.ModelViewSet):
    queryset = Position.objects.select_related('department').all()
    serializer_class = PositionSerializer
    permission_classes = [IsHRStaff]
    pagination_class = None
    search_fields = ['name', 'code']
    filterset_fields = ['department', 'is_active']

    def perform_create(self, serializer):
        pos = serializer.save()
        log_event(self.request, 'create', obj=pos, description=f'Position {pos.name} created')

    def perform_update(self, serializer):
        pos = serializer.save()
        log_event(self.request, 'update', obj=pos, description=f'Position {pos.name} updated')

    def _check_in_use(self, instance):
        count = instance.employees.count()
        if count:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': f'Position masih digunakan oleh {count} karyawan.'})

    def soft_delete(self, instance):
        self._check_in_use(instance)
        name = instance.name
        # Soft-delete: preserve audit history referencing this position.
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        log_event(self.request, 'delete', obj=instance, description=f'Position {name} deactivated')

    def hard_delete(self, instance):
        name = instance.name
        instance.delete()
        log_event(self.request, 'delete', obj=None, description=f'Position {name} hard-deleted')


class DashboardHrView(APIView):
    """Aggregated HR dashboard data: leave-today, contracts ending, birthdays, announcements."""

    permission_classes = [IsHRStaff]

    def get(self, request):
        from apps.leaves.models import LeaveRequest

        from .permissions import WRITE_ROLES

        # HR/Admin only: includes audit activity and every contract. GM gets
        # its company overview from /dashboard/management/ instead.
        if _role(request.user) not in WRITE_ROLES:
            return Response({'detail': 'Hanya untuk HR/Admin.'}, status=status.HTTP_403_FORBIDDEN)

        today = timezone.localdate()
        # Optional overview filters (?department=<id>&position=<id>) applied to
        # the employee-scoped widgets: leave today, contracts, birthdays.
        emp_filter = {}
        for param in ('department', 'position'):
            value = request.query_params.get(param, '')
            if value.isdigit():
                emp_filter[f'{param}_id'] = int(value)
        emp_lookup = {f'employee__{k}': v for k, v in emp_filter.items()}
        # Izin & cuti hari ini: approved requests covering today.
        leave_today = LeaveRequest.objects.filter(
            status='APPROVED', start_date__lte=today, end_date__gte=today, **emp_lookup
        ).select_related('employee', 'leave_type').order_by('employee__full_name')
        leave_today_data = [
            {
                'id': lr.id,
                'employee_name': lr.employee.full_name,
                'leave_type_name': lr.leave_type.name,
                'kind': lr.leave_type.kind,
                'status': lr.status,
                'start_date': lr.start_date,
                'end_date': lr.end_date,
                'total_days': lr.total_days,
            }
            for lr in leave_today
        ]
        # End of contract: the 5 active contracts ending soonest (future end_date).
        contracts = (
            EmployeeContract.objects.filter(status='ACTIVE', end_date__gte=today, **emp_lookup)
            .select_related('employee')
            .order_by('end_date')[:5]
        )
        contracts_data = [
            {
                'id': c.id,
                'employee_name': c.employee.full_name,
                'employee_id': c.employee.employee_id,
                'position_name': c.employee.position.name if c.employee.position else None,
                'contract_type': c.contract_type,
                'end_date': c.end_date,
                'days_left': (c.end_date - today).days,
            }
            for c in contracts
        ]
        # Birthday in next 7 days (MM-DD window, ignores year).
        md = today.strftime('%m-%d')
        md_end = (today + datetime.timedelta(days=7)).strftime('%m-%d')
        birthdays = []
        for e in Employee.objects.filter(birth_date__isnull=False, **emp_filter).select_related('department', 'position'):
            b = e.birth_date.strftime('%m-%d')
            in_range = md <= b <= md_end if md <= md_end else (b >= md or b <= md_end)
            if in_range:
                birthdays.append(
                    {
                        'id': e.id,
                        'full_name': e.full_name,
                        'birth_date': e.birth_date,
                        'department_name': e.department.name if e.department else None,
                        'position_name': e.position.name if e.position else None,
                    }
                )
        Announcement.deactivate_expired()
        announcements = [a for a in Announcement.objects.all()[:10] if a.is_visible][:3]
        announcements_data = [
            {
                'id': a.id,
                'title': a.title,
                'body': a.body,
                'created_at': a.created_at,
                'created_by_name': a.created_by.username if a.created_by else None,
                'status': a.status,
                'use_end_date': a.use_end_date,
                'end_date': a.end_date.isoformat() if a.end_date else None,
            }
            for a in announcements
        ]
        # Recent activities: latest audit log entries across HRIS (login/logout excluded).
        from apps.audit.models import AuditLog

        recent_logs = (
            AuditLog.objects.filter(deleted_at__isnull=True)
            .exclude(action__in=['login', 'logout'])
            .select_related('user', 'content_type')[:8]
        )
        recent_activities = [
            {
                'id': log.id,
                'action': log.action,
                'actor': log.user.username if log.user else None,
                'object_repr': str(log.content_object) if log.content_object else None,
                'description': log.description,
                'timestamp': log.created_at,
            }
            for log in recent_logs
        ]
        return Response(
            {
                'leave_today': leave_today_data,
                'contracts_ending': contracts_data,
                'birthdays': birthdays,
                'announcements': announcements_data,
                'recent_activities': recent_activities,
            }
        )


class DashboardManagementView(APIView):
    """Read-only team + leave stats for MANAGEMENT (their direct reports)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.leaves.models import LeaveRequest

        role = _role(request.user)
        if role not in ('MANAGEMENT', 'GENERAL_MANAGER'):
            return Response({'detail': 'Hanya untuk peran Manajemen.'}, status=status.HTTP_403_FORBIDDEN)
        employee = getattr(getattr(request.user, 'personnel', None), 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)

        from .permissions import team_scope_ids

        team = Employee.objects.filter(id__in=team_scope_ids(request.user))
        active = team.filter(employment_status='ACTIVE').count()
        from django.db.models import Count

        by_dept = (
            team.values('department', 'department__name')
            .annotate(count=Count('id'))
            .order_by('department__name')
        )
        by_department = [
            {
                'department': d['department'],
                'department_name': d['department__name'] or 'Tanpa Departemen',
                'count': d['count'],
            }
            for d in by_dept
        ]

        team_ids = list(team.values_list('id', flat=True))
        leaves = LeaveRequest.objects.select_related('employee', 'leave_type').filter(employee_id__in=team_ids)
        leave_counts = leaves.values('status').annotate(count=Count('id'))
        counts = {c['status']: c['count'] for c in leave_counts}
        leave = {
            'pending': counts.get('PENDING', 0),
            'approved': counts.get('APPROVED', 0),
            'rejected': counts.get('REJECTED', 0),
            'cancelled': counts.get('CANCELLED', 0),
            'total': sum(counts.values()),
        }
        # "Perlu Perhatian": only requests this user can actually decide. The
        # Reporting To approves — a GM sees their whole hierarchy in the stats
        # but acts only on direct reports (same rule as leave approve/reject).
        pending_qs = leaves.filter(status='PENDING', employee__manager_id=employee.id)
        pending_items = [
            {
                'id': lr.id,
                'employee_name': lr.employee.full_name,
                'leave_type_name': lr.leave_type.name,
                'start_date': lr.start_date.isoformat(),
                'end_date': lr.end_date.isoformat(),
                'total_days': lr.total_days,
            }
            for lr in pending_qs.order_by('start_date')[:5]
        ]

        team_members = [
            {
                'id': e.id,
                'full_name': e.full_name,
                'employee_id': e.employee_id,
                'position_name': e.position.name if e.position_id else None,
                'department_name': e.department.name if e.department_id else None,
                'employment_status': e.employment_status,
            }
            for e in team.select_related('position', 'department').order_by('full_name')
        ]

        leave['awaiting_me'] = pending_qs.count()
        payload = {
            'team': {
                'total': team.count(),
                'active': active,
                'inactive': team.count() - active,
                'by_department': by_department,
            },
            'leave': leave,
            'pending_leave_items': pending_items,
            'team_members': team_members,
        }
        if role == 'GENERAL_MANAGER':
            payload['company'] = self._company_overview()
        return Response(payload)

    @staticmethod
    def _company_overview():
        """Company-wide HR overview for the General Manager (read-only)."""
        from django.db.models import Count, Q

        today = timezone.localdate()
        employees = Employee.objects.all()
        total = employees.count()
        active = employees.filter(employment_status='ACTIVE').count()

        departments = [
            {
                'id': d.id,
                'name': d.name,
                'total': d.n_total,
                'active': d.n_active,
            }
            for d in Department.objects.all()
            .annotate(
                n_total=Count('employees', distinct=True),
                n_active=Count('employees', filter=Q(employees__employment_status='ACTIVE'), distinct=True),
            )
            .order_by('-n_total', 'name')
        ]
        unassigned = employees.filter(department__isnull=True)
        if unassigned.exists():
            departments.append({
                'id': None,
                'name': 'Tanpa Departemen',
                'total': unassigned.count(),
                'active': unassigned.filter(employment_status='ACTIVE').count(),
            })

        ending_qs = (
            EmployeeContract.objects.filter(status='ACTIVE', end_date__gte=today, deleted_at__isnull=True)
            .select_related('employee', 'employee__position', 'employee__department')
            .order_by('end_date')
        )
        contracts_ending = [
            {
                'id': c.id,
                'employee': c.employee_id,
                'employee_name': c.employee.full_name,
                'employee_id': c.employee.employee_id,
                'position_name': c.employee.position.name if c.employee.position_id else None,
                'department_name': c.employee.department.name if c.employee.department_id else None,
                'contract_type': c.contract_type,
                'pkwt_sequence': c.pkwt_sequence,
                'end_date': c.end_date.isoformat(),
                'days_left': (c.end_date - today).days,
            }
            for c in ending_qs[:8]
        ]

        latest = [
            {
                'id': e.id,
                'full_name': e.full_name,
                'employee_id': e.employee_id,
                'department_name': e.department.name if e.department_id else None,
                'position_name': e.position.name if e.position_id else None,
                'manager_name': e.manager.full_name if e.manager_id else None,
                'join_date': e.join_date.isoformat() if e.join_date else None,
                'employment_status': e.employment_status,
            }
            for e in employees.select_related('department', 'position', 'manager').order_by('-created_at', '-id')[:8]
        ]

        return {
            'summary': {
                'total_employees': total,
                'active_employees': active,
                'inactive_employees': total - active,
                # Same basis as the HRIS dashboard (all records).
                'total_departments': Department.objects.count(),
                'total_positions': Position.objects.count(),
            },
            'departments': departments,
            'contracts_ending': contracts_ending,
            'contracts_ending_30d': ending_qs.filter(end_date__lte=today + datetime.timedelta(days=30)).count(),
            'latest_employees': latest,
        }


class IsChangeRequestApprover(IsAuthenticated):
    """HR Staff / HR Lead / Admin review employee data change requests."""

    def has_permission(self, request, view):
        from .profile_changes import APPROVER_ROLES

        return super().has_permission(request, view) and _role(request.user) in APPROVER_ROLES


class EmployeeChangeRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """HR review of employee data change requests: list/detail, approve
    (applies the values), reject (reason required), attachment (stream)."""

    queryset = EmployeeChangeRequest.objects.select_related('employee', 'requested_by', 'reviewed_by').all()
    permission_classes = [IsChangeRequestApprover]
    filterset_fields = ['status', 'employee']
    search_fields = ['employee__full_name', 'employee__employee_id']

    def get_serializer_class(self):
        from .serializers import EmployeeChangeRequestSerializer

        return EmployeeChangeRequestSerializer

    def _pending_for_review(self, request, pk):
        from rest_framework.exceptions import ValidationError

        from .permissions import employee_for

        cr = self.get_queryset().select_for_update(of=('self',)).get(pk=self.get_object().pk)
        if cr.status != 'PENDING':
            raise ValidationError({'detail': 'Pengajuan ini sudah diproses.'})
        own = employee_for(request.user)
        if own is not None and own.pk == cr.employee_id:
            raise ValidationError({'detail': 'Tidak dapat memproses pengajuan perubahan data sendiri.'})
        return cr

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        from django.db import transaction

        from apps.notifications.services import notify_profile_change_decided, notify_profile_security

        from .profile_changes import BANK_FIELDS, REQUEST_FIELDS, approve_change_request

        with transaction.atomic():
            cr = self._pending_for_review(request, pk)
            before, after = approve_change_request(cr, request.user)
        employee = cr.employee
        log_event(request, 'approve', obj=employee,
                  description=f'Data change request {cr.pk} approved for {employee.employee_id}: '
                              f'{", ".join(REQUEST_FIELDS[f] for f in after)}',
                  changes_before=before, changes_after=after)
        notify_profile_change_decided(cr)
        if BANK_FIELDS & set(after):
            notify_profile_security(
                f'profile-bank-change:{cr.pk}',
                [employee.personal_email, employee.company_email],
                'Rekening bank HRIS Anda diperbarui',
                f'Halo {employee.full_name},\n\nData rekening bank Anda di HRIS telah diperbarui '
                f'(pengajuan #{cr.pk}, disetujui {request.user.get_full_name() or request.user.username}). '
                'Rekening ini dipakai untuk pembayaran gaji dan reimbursement.\n\n'
                'Jika Anda tidak mengajukan perubahan ini, segera hubungi HR.\n\nHRIS Feraco',
            )
        return Response(self.get_serializer(cr).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        from django.db import transaction

        from apps.notifications.services import notify_profile_change_decided

        reason = (request.data.get('rejection_reason') or '').strip()
        if not reason:
            return Response({'rejection_reason': 'Alasan penolakan wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            cr = self._pending_for_review(request, pk)
            cr.status = 'REJECTED'
            cr.rejection_reason = reason
            cr.reviewed_by = request.user
            cr.reviewed_at = timezone.now()
            cr.save(update_fields=['status', 'rejection_reason', 'reviewed_by', 'reviewed_at', 'updated_at'])
        log_event(request, 'reject', obj=cr, description=f'Data change request {cr.pk} rejected: {reason[:200]}')
        notify_profile_change_decided(cr)
        return Response(self.get_serializer(cr).data)

    @action(detail=True, methods=['get'])
    def attachment(self, request, pk=None):
        from .profile_changes import ATTACHMENT_BUCKET
        from .storage import stream_file_response

        cr = self.get_object()
        if not cr.attachment_path:
            return Response({'detail': 'Tidak ada lampiran.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            response = stream_file_response(ATTACHMENT_BUCKET, cr.attachment_path, cr.attachment_name)
        except Exception as exc:
            return Response({'detail': f'Gagal mengambil file dari storage: {str(exc)[:150]}'},
                            status=status.HTTP_502_BAD_GATEWAY)
        log_event(request, 'download', obj=cr, description=f'Data change request {cr.pk} attachment viewed')
        return response
class UpcomingBirthdaysView(APIView):
    """Active employees with a birthday in the next 7 days, for every role's
    dashboard. Exposes day/month only (``next_birthday``), never the birth year.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .storage import employee_photo_url

        today = timezone.localdate()
        rows = []
        qs = Employee.objects.filter(birth_date__isnull=False, employment_status='ACTIVE').select_related('department')
        for e in qs:
            try:
                upcoming = e.birth_date.replace(year=today.year)
            except ValueError:  # 29 Feb in a non-leap year
                upcoming = datetime.date(today.year, 3, 1)
            if upcoming < today:
                try:
                    upcoming = e.birth_date.replace(year=today.year + 1)
                except ValueError:
                    upcoming = datetime.date(today.year + 1, 3, 1)
            days = (upcoming - today).days
            if days <= 7:
                rows.append(
                    {
                        'id': e.id,
                        'full_name': e.full_name,
                        'department_name': e.department.name if e.department else None,
                        'photo_url': employee_photo_url(e, request),
                        'next_birthday': upcoming,
                        'days_until': days,
                    }
                )
        rows.sort(key=lambda r: (r['days_until'], r['full_name']))
        return Response({'results': rows})
