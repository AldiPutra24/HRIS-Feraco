import csv
import io

from django.db.models import Q
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from apps.audit.services import log_event

from .models import Department, Employee, EmployeeContract, EmployeeDocument, EmploymentHistory, Position
from .permissions import IsHRStaff
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
    'personal_email', 'emergency_contact_name', 'emergency_contact_phone',
    'bank_account_number', 'bank_account_name', 'npwp', 'bpjs_kesehatan',
    'bpjs_ketenagakerjaan', 'department', 'position', 'join_date', 'employment_status',
]


def _cell(row, key):
    return (row.get(key) or '').strip()


def _resolve_department(name):
    if not name:
        return None
    return Department.objects.filter(name__iexact=name).first()


def _resolve_position(name):
    if not name:
        return None
    return Position.objects.filter(name__iexact=name).first()


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.select_related('department', 'position', 'manager').all()
    serializer_class = EmployeeSerializer
    permission_classes = [IsHRStaff]
    search_fields = ['full_name', 'employee_id', 'nik', 'personal_email']
    ordering_fields = ['full_name', 'employee_id', 'join_date', 'created_at']
    filterset_fields = ['department', 'position', 'employment_status', 'status']

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
            )
        return qs

    def perform_create(self, serializer):
        employee = serializer.save(employee_id=next_employee_id())
        log_event(self.request, 'create', obj=employee, description=f'Employee {employee.employee_id} created')

    def perform_update(self, serializer):
        employee = serializer.save()
        log_event(self.request, 'update', obj=employee, description=f'Employee {employee.employee_id} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Employee {instance.employee_id} deleted')
        instance.delete()

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def import_csv(self, request):
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)

        raw = upload.read()
        text = raw.decode('utf-8-sig', errors='replace')
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return Response({'file': 'CSV kosong.'}, status=status.HTTP_400_BAD_REQUEST)

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
                    emergency_contact_name=_cell(row, 'emergency_contact_name'),
                    emergency_contact_phone=_cell(row, 'emergency_contact_phone'),
                    bank_account_number=_cell(row, 'bank_account_number'),
                    bank_account_name=_cell(row, 'bank_account_name'),
                    npwp=_cell(row, 'npwp'),
                    bpjs_kesehatan=_cell(row, 'bpjs_kesehatan'),
                    bpjs_ketenagakerjaan=_cell(row, 'bpjs_ketenagakerjaan'),
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
                employee.contracts.all(), many=True, context={'request': request}
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
        if contract.end_date is None:
            return Response({'detail': 'Kontrak aktif wajib memiliki tanggal selesai.'}, status=status.HTTP_400_BAD_REQUEST)
        set_current_contract(contract)
        log_event(request, 'update', obj=contract, description=f'Contract {contract.contract_number or contract.contract_type} activated')
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
        log_event(request, 'update', obj=contract, description=f'Contract {contract.contract_number or contract.contract_type} terminated')
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
            'create',
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
        contract.delete()
        log_event(request, 'delete', obj=None, description=f'Contract {contract.contract_type} deleted')
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
                employee.documents.all(), many=True, context={'request': request}
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
        log_event(request, 'create', obj=doc, description=f'Document {doc.name} v{version} uploaded')
        return Response(EmployeeDocumentSerializer(doc, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'documents/(?P<doc_pk>\d+)')
    def delete_document(self, request, pk=None, doc_pk=None):
        from apps.personnel.permissions import _role

        if _role(request.user) != 'ADMIN':
            return Response({'detail': 'Only admin can delete documents.'}, status=status.HTTP_403_FORBIDDEN)
        doc = EmployeeDocument.objects.filter(pk=doc_pk, employee_id=pk).first()
        if doc is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if is_configured():
            delete_object('employee-documents', doc.storage_path)
        doc.delete()
        log_event(request, 'delete', obj=None, description=f'Document {doc.name} deleted')
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

        return redirect(url)


class DepartmentViewSet(viewsets.ModelViewSet):
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

    def perform_destroy(self, instance):
        count = instance.employees.count()
        if count:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': f'Department masih digunakan oleh {count} karyawan.'})
        name = instance.name
        log_event(self.request, 'delete', obj=instance, description=f'Department {name} deleted')
        instance.delete()


class PositionViewSet(viewsets.ModelViewSet):
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

    def perform_destroy(self, instance):
        count = instance.employees.count()
        if count:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({'detail': f'Position masih digunakan oleh {count} karyawan.'})
        name = instance.name
        log_event(self.request, 'delete', obj=instance, description=f'Position {name} deleted')
        instance.delete()
