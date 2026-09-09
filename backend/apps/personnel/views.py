import datetime
import io

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.audit.services import log_event
from apps.softdelete import SoftHardDeleteMixin

from .models import Department, Employee, EmployeeContract, EmployeeDocument, EmploymentHistory, Position
from .permissions import IsHRStaff, _role
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
from .storage import delete_object, is_configured, signed_url, upload_bytes


def next_employee_id():
    """Generate the next sequential employee id: EMP0001, EMP0002, ..."""
    last = Employee.objects.order_by('-id').values_list('employee_id', flat=True).first()
    num = 1
    if last and last.startswith('EMP'):
        try:
            num = int(last[3:]) + 1
        except ValueError:
            pass
    return f'EMP{num:04d}'


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
    queryset = Employee.objects.select_related('department', 'position', 'manager').all()
    serializer_class = EmployeeSerializer
    permission_classes = [IsHRStaff]
    search_fields = ['full_name', 'employee_id', 'nik', 'personal_email', 'company_email']
    ordering_fields = ['full_name', 'employee_id', 'join_date', 'created_at']
    filterset_fields = ['department', 'position', 'employment_status', 'status', 'manager']

    def get_serializer_class(self):
        if self.action in ('list', 'retrieve'):
            return EmployeeReadSerializer
        return EmployeeSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        q = self.request.query_params.get('search')
        if q:
            qs = qs.filter(
                Q(full_name__icontains=q)
                | Q(employee_id__icontains=q)
                | Q(nik__icontains=q)
                | Q(personal_email__icontains=q)
                | Q(company_email__icontains=q)
            )
        return qs

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
        if exclude_id:
            qs = qs.exclude(pk=exclude_id)
        data = [
            {'id': e.id, 'full_name': e.full_name, 'position_name': e.position.name if e.position else ''}
            for e in qs
        ]
        return Response(data)

    def perform_create(self, serializer):
        employee = serializer.save(employee_id=next_employee_id())
        log_event(self.request, 'create', obj=employee, description=f'Employee {employee.employee_id} created')

    def perform_update(self, serializer):
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
        employee = self.get_object()
        if request.method == 'GET':
            sync_contract_status()
            data = EmployeeContractSerializer(
                employee.contracts.filter(deleted_at__isnull=True), many=True, context={'request': request}
            ).data
            return Response(data)
        serializer = EmployeeContractSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
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
        employee = self.get_object()
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
        employee = self.get_object()
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
        upload_bytes('employee-documents', path, raw, content_type=upload.content_type or 'application/octet-stream')

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
        doc = EmployeeDocument.objects.filter(pk=pk).first()
        if doc is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not is_configured():
            return Response({'detail': 'Storage not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        url = signed_url('employee-documents', doc.storage_path)
        from django.shortcuts import redirect

        log_event(request, 'download', obj=doc, description=f'Document {doc.name} downloaded')
        return redirect(url)


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

        today = timezone.localdate()
        # Izin & cuti hari ini: approved requests covering today.
        leave_today = LeaveRequest.objects.filter(
            status='APPROVED', start_date__lte=today, end_date__gte=today
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
        # End of contract: active contracts with a future end_date, soonest first.
        contracts = (
            EmployeeContract.objects.filter(status='ACTIVE', end_date__gte=today)
            .select_related('employee')
            .order_by('end_date')[:10]
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
        for e in Employee.objects.filter(birth_date__isnull=False).select_related('department', 'position'):
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
        announcements = [a for a in Announcement.objects.all()[:10] if a.is_visible]
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
        return Response(
            {
                'leave_today': leave_today_data,
                'contracts_ending': contracts_data,
                'birthdays': birthdays,
                'announcements': announcements_data,
            }
        )


class DashboardManagementView(APIView):
    """Read-only team + leave stats for MANAGEMENT (their direct reports)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.leaves.models import LeaveRequest

        role = _role(request.user)
        if role != 'MANAGEMENT':
            return Response({'detail': 'Hanya untuk peran Manajemen.'}, status=status.HTTP_403_FORBIDDEN)
        employee = getattr(getattr(request.user, 'personnel', None), 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=status.HTTP_404_NOT_FOUND)

        team = Employee.objects.filter(manager=employee)
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
        leaves = LeaveRequest.objects.filter(employee_id__in=team_ids)
        leave_counts = leaves.values('status').annotate(count=Count('id'))
        counts = {c['status']: c['count'] for c in leave_counts}
        leave = {
            'pending': counts.get('PENDING', 0),
            'approved': counts.get('APPROVED', 0),
            'rejected': counts.get('REJECTED', 0),
            'cancelled': counts.get('CANCELLED', 0),
            'total': sum(counts.values()),
        }

        return Response(
            {
                'team': {
                    'total': team.count(),
                    'active': active,
                    'inactive': team.count() - active,
                    'by_department': by_department,
                },
                'leave': leave,
            }
        )
