from datetime import date
from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.services import log_event
from apps.personnel.permissions import _role

from .models import Payroll, PayrollComponent, PayrollItem, PayrollPeriod, SalaryStructure
from .permissions import IsPayrollAdmin, PayrollPeriodPermission, SalaryStructurePermission, PAYROLL_ADMIN_ROLES
from .serializers import (
    PayrollComponentSerializer,
    PayrollPeriodSerializer,
    PayrollSerializer,
    SalaryStructureSerializer,
)
from .services import calculate_period, refresh_payroll_totals


class PayrollComponentViewSet(viewsets.ModelViewSet):
    queryset = PayrollComponent.objects.all()
    serializer_class = PayrollComponentSerializer
    permission_classes = [IsPayrollAdmin]
    search_fields = ['name', 'code', 'description']
    filterset_fields = ['category', 'is_active', 'calculation_type']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if _role(self.request.user) not in PAYROLL_ADMIN_ROLES:
            return qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Payroll component {obj.code} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Payroll component {obj.code} updated')


class SalaryStructureViewSet(viewsets.ModelViewSet):
    queryset = SalaryStructure.objects.select_related('employee').all()
    serializer_class = SalaryStructureSerializer
    permission_classes = [SalaryStructurePermission]
    filterset_fields = ['employee', 'is_active', 'effective_from']
    search_fields = ['employee__full_name']

    def get_queryset(self):
        qs = super().get_queryset()
        role = _role(self.request.user)
        if role in PAYROLL_ADMIN_ROLES:
            return qs
        personnel = getattr(self.request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return qs.none()
        return qs.filter(employee_id=employee.id)

    def perform_create(self, serializer):
        # Only HR can create salary structures.
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Salary structure for employee {obj.employee_id} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Salary structure for employee {obj.employee_id} updated')

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """Full history for an employee (HR only)."""
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        qs = SalaryStructure.objects.filter(employee_id=pk).select_related('employee').order_by('-effective_from')
        return Response(SalaryStructureSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def active(self, request):
        """Active salary structure of the current employee (self-service)."""
        personnel = getattr(request.user, 'personnel', None)
        employee = getattr(personnel, 'employee', None)
        if employee is None:
            return Response({'detail': 'Akun tidak terhubung ke data karyawan.'}, status=404)
        today = date.today()
        qs = SalaryStructure.objects.filter(
            employee_id=employee.id,
            is_active=True,
            effective_from__lte=today,
        ).order_by('-effective_from')
        # Pick the structure whose effective window covers today.
        current = qs.first()
        return Response(SalaryStructureSerializer(current, context={'request': request}).data if current else None)


class PayrollPeriodViewSet(viewsets.ModelViewSet):
    """Payroll periods with one-way status workflow:
    DRAFT → CALCULATED → REVIEW → APPROVED → PAID → LOCKED."""

    queryset = PayrollPeriod.objects.all()
    serializer_class = PayrollPeriodSerializer
    permission_classes = [PayrollPeriodPermission]
    filterset_fields = ['period_month', 'period_year', 'status']
    search_fields = ['notes']
    pagination_class = None

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        log_event(self.request, 'create', obj=obj, description=f'Payroll period {obj.period_month}/{obj.period_year} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Payroll period {obj.period_month}/{obj.period_year} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Payroll period {instance.period_month}/{instance.period_year} deleted')
        instance.delete()

    def get_queryset(self):
        # MANAGEMENT sees periods read-only (permission class already gates writes).
        return super().get_queryset()

    def _transition(self, request, pk, target, label):
        period = self.get_object()
        if not period.can_transition_to(target):
            return Response(
                {'detail': f'Tidak dapat berpindah dari {period.get_status_display()} ke {label}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        period.status = target
        period.save()
        log_event(
            request, f'payroll_period_{label.lower().replace(" ", "_")}',
            obj=period,
            description=f'Payroll period {period.period_month}/{period.period_year} → {label}',
            metadata={'from': 'transition'},
        )
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['post'])
    def calculate(self, request, pk=None):
        """Run the calculation engine (DRAFT only)."""
        period = self.get_object()
        if period.status != PayrollPeriod.Status.DRAFT:
            return Response(
                {'detail': 'Hanya periode DRAFT yang bisa dihitung.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            payrolls = calculate_period(period)
        except Exception as exc:  # noqa: BLE001
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        period.status = PayrollPeriod.Status.CALCULATED
        period.save()
        log_event(
            request, 'payroll_calculate', obj=period,
            description=f'Payroll period {period.period_month}/{period.period_year} calculated ({payrolls.count()} records)',
        )
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.REVIEW, 'Review')

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.APPROVED, 'Approved')

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.PAID, 'Paid')

    @action(detail=True, methods=['post'])
    def lock(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.LOCKED, 'Locked')


class PayrollViewSet(viewsets.ReadOnlyModelViewSet):
    """Payroll records (and items) for a period. HR + MANAGEMENT read-only via API;
    manual item editing is handled by HR through dedicated endpoints (see below)."""

    queryset = Payroll.objects.select_related('employee', 'period').prefetch_related('items')
    serializer_class = PayrollSerializer
    permission_classes = [IsPayrollAdmin]
    filterset_fields = ['period', 'employee']
    search_fields = ['employee__full_name']
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset()

    @action(detail=True, methods=['post'])
    def manual_item(self, request, pk=None):
        """Add/update a manual variable component for a payroll (HR only).

        Allowed while the period is not LOCKED. Recalcs the payroll totals.
        """
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        payroll = self.get_object()
        period = payroll.period
        if period.status == PayrollPeriod.Status.LOCKED:
            return Response(
                {'detail': 'Periode sudah LOCKED, tidak dapat diubah.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        code = request.data.get('component_code') or request.data.get('code')
        amount = request.data.get('amount')
        description = request.data.get('description', 'Input manual HR')
        component = PayrollComponent.objects.filter(code=code).first()
        if not component:
            return Response({'detail': f'Komponen {code} tidak ditemukan.'}, status=400)
        try:
            amount = Decimal(str(amount))
        except Exception:
            return Response({'detail': 'Amount tidak valid.'}, status=400)

        item, created = PayrollItem.objects.update_or_create(
            payroll=payroll,
            payroll_component=component,
            source=PayrollItem.Source.MANUAL,
            defaults={
                'component_name': component.name,
                'component_code': component.code,
                'category': component.category,
                'amount': amount,
                'description': description,
            },
        )
        payroll = refresh_payroll_totals(payroll)
        log_event(
            request,
            'payroll_manual_item',
            obj=payroll,
            description=f'Manual {component.code} {amount} untuk {payroll.employee.full_name}',
        )
        return Response(PayrollSerializer(payroll).data)

    @action(detail=True, methods=['post'])
    def remove_manual_item(self, request, pk=None):
        """Delete a manual variable component (HR only, not LOCKED)."""
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        payroll = self.get_object()
        if payroll.period.status == PayrollPeriod.Status.LOCKED:
            return Response(
                {'detail': 'Periode sudah LOCKED, tidak dapat diubah.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        code = request.data.get('component_code') or request.data.get('code')
        PayrollItem.objects.filter(
            payroll=payroll,
            component_code=code,
            source=PayrollItem.Source.MANUAL,
        ).delete()
        refresh_payroll_totals(payroll)
        return Response(PayrollSerializer(payroll).data)

