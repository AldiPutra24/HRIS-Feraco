from datetime import date
from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction

from apps.audit.services import log_event
from apps.personnel.permissions import _role

from .models import (
    AnnualTaxBracket,
    EmployeeTaxProfile,
    Payroll,
    PayrollComponent,
    PayrollItem,
    PayrollPeriod,
    SalaryStructure,
    TaxConfig,
    TerBracket,
)
from .permissions import IsPayrollAdmin, PayrollPeriodPermission, SalaryStructurePermission, PAYROLL_ADMIN_ROLES
from .serializers import (
    AnnualTaxBracketSerializer,
    EmployeeTaxProfileSerializer,
    PayrollComponentSerializer,
    PayrollItemSerializer,
    PayrollPeriodSerializer,
    PayrollSerializer,
    SalaryStructureSerializer,
    TaxConfigSerializer,
    TerBracketSerializer,
)
from .services import ZERO, calculate_period, refresh_payroll_totals
from .exports import build_payslip_pdf, build_recap_xlsx
from .exports import build_payslip_pdf, build_recap_xlsx


class TaxConfigViewSet(viewsets.ModelViewSet):
    """Per-year PPh 21 tax configuration (ADMIN/HR only)."""

    queryset = TaxConfig.objects.prefetch_related('ter_brackets', 'annual_brackets').all()
    serializer_class = TaxConfigSerializer
    permission_classes = [IsPayrollAdmin]
    pagination_class = None

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'create', obj=obj, description=f'Tax config {obj.year} created')

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(self.request, 'update', obj=obj, description=f'Tax config {obj.year} updated')

    def perform_destroy(self, instance):
        log_event(self.request, 'delete', obj=instance, description=f'Tax config {instance.year} deleted')
        instance.delete()

    @action(detail=True, methods=['post'])
    def brackets(self, request, pk=None):
        """Bulk-upsert TER brackets for this config (replaces existing rows)."""
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        config = self.get_object()
        rows = request.data.get('brackets')
        if not isinstance(rows, list):
            return Response({'detail': 'Payload harus berisi daftar brackets.'}, status=400)
        valid_categories = {TaxConfig.TerCategory.A, TaxConfig.TerCategory.B, TaxConfig.TerCategory.C}
        cleaned = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                return Response({'detail': f'Bracket #{i + 1} tidak valid.'}, status=400)
            category = (row.get('ter_category') or '').strip().upper()
            if category not in valid_categories:
                return Response({'detail': f'Bracket #{i + 1}: kategori harus A/B/C.'}, status=400)
            try:
                bruto_lower = Decimal(str(row.get('bruto_lower')))
                rate_pct = Decimal(str(row.get('rate_pct')))
            except Exception:
                return Response({'detail': f'Bracket #{i + 1}: angka tidak valid.'}, status=400)
            bruto_upper = row.get('bruto_upper')
            bruto_upper = Decimal(str(bruto_upper)) if bruto_upper not in (None, '') else None
            if bruto_upper is not None and bruto_upper <= bruto_lower:
                return Response({'detail': f'Bracket #{i + 1}: batas atas harus > batas bawah.'}, status=400)
            if rate_pct < 0:
                return Response({'detail': f'Bracket #{i + 1}: tarif tidak boleh negatif.'}, status=400)
            cleaned.append({
                'ter_category': category,
                'bruto_lower': bruto_lower,
                'bruto_upper': bruto_upper,
                'rate_pct': rate_pct,
            })
        with transaction.atomic():
            config.ter_brackets.all().delete()
            for row in cleaned:
                TerBracket.objects.create(tax_config=config, **row)
        log_event(
            request, 'update', obj=config,
            description=f'TER brackets {config.year} replaced ({len(cleaned)} rows)',
        )
        return Response(TaxConfigSerializer(config, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def annual_brackets(self, request, pk=None):
        """Bulk-replace annual Pasal 17 layer overrides (Tahap 3b).

        Rows override the corresponding statutory layer (layer_order 1..5);
        an empty list resets to the defaults. Each row must fully define its
        layer (pkp_lower, pkp_upper, rate_pct).
        """
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        config = self.get_object()
        rows = request.data.get('brackets')
        if not isinstance(rows, list):
            return Response({'detail': 'Payload harus berisi daftar brackets.'}, status=400)
        cleaned = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                return Response({'detail': f'Bracket #{i + 1} tidak valid.'}, status=400)
            try:
                layer_order = int(row.get('layer_order'))
            except Exception:
                return Response({'detail': f'Bracket #{i + 1}: layer_order tidak valid.'}, status=400)
            if not 1 <= layer_order <= 5:
                return Response({'detail': f'Bracket #{i + 1}: layer_order harus 1-5.'}, status=400)
            try:
                pkp_lower = Decimal(str(row.get('pkp_lower')))
                rate_pct = Decimal(str(row.get('rate_pct')))
            except Exception:
                return Response({'detail': f'Bracket #{i + 1}: angka tidak valid.'}, status=400)
            pkp_upper = row.get('pkp_upper')
            pkp_upper = Decimal(str(pkp_upper)) if pkp_upper not in (None, '') else None
            if pkp_upper is not None and pkp_upper <= pkp_lower:
                return Response({'detail': f'Bracket #{i + 1}: batas atas harus > batas bawah.'}, status=400)
            if rate_pct < 0:
                return Response({'detail': f'Bracket #{i + 1}: tarif tidak boleh negatif.'}, status=400)
            cleaned.append({
                'layer_order': layer_order,
                'pkp_lower': pkp_lower,
                'pkp_upper': pkp_upper,
                'rate_pct': rate_pct,
            })
        with transaction.atomic():
            config.annual_brackets.all().delete()
            for row in cleaned:
                AnnualTaxBracket.objects.create(tax_config=config, **row)
        log_event(
            request, 'update', obj=config,
            description=f'Annual Pasal 17 brackets {config.year} replaced ({len(cleaned)} rows)',
        )
        return Response(TaxConfigSerializer(config, context={'request': request}).data)


class EmployeeTaxProfileViewSet(viewsets.ModelViewSet):
    """Per-employee PTKP status + tax scheme (ADMIN/HR only)."""

    queryset = EmployeeTaxProfile.objects.select_related('employee').all()
    serializer_class = EmployeeTaxProfileSerializer
    permission_classes = [IsPayrollAdmin]
    filterset_fields = ['employee', 'ptkp_status', 'tax_scheme']
    search_fields = ['employee__full_name']
    pagination_class = None

    def create(self, request, *args, **kwargs):
        """Upsert: POST for an employee that already has a profile updates it
        instead of failing the unique constraint (frontend always POSTs)."""
        employee_id = request.data.get('employee')
        profile = (
            EmployeeTaxProfile.objects.filter(employee_id=employee_id).first()
            if employee_id else None
        )
        if profile is None:
            return super().create(request, *args, **kwargs)
        serializer = self.get_serializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    def perform_create(self, serializer):
        obj = serializer.save()
        log_event(
            self.request, 'create', obj=obj,
            description=f'Tax profile {obj.employee.full_name}: PTKP {obj.ptkp_status}',
        )

    def perform_update(self, serializer):
        old_status = serializer.instance.ptkp_status
        obj = serializer.save()
        log_event(
            self.request, 'update', obj=obj,
            description=f'Tax profile {obj.employee.full_name}: PTKP {old_status} -> {obj.ptkp_status}',
        )

    @action(detail=True, methods=['delete'])
    def reset(self, request, pk=None):
        """Delete the profile so the employee falls back to default TK/0 + NORMAL."""
        profile = self.get_object()
        name = profile.employee.full_name
        profile.delete()
        log_event(request, 'delete', obj=None, description=f'Tax profile {name} reset to default')
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    def approve(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.APPROVED, 'Approved')

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.PAID, 'Paid')

    @action(detail=True, methods=['post'])
    def lock(self, request, pk=None):
        return self._transition(request, pk, PayrollPeriod.Status.LOCKED, 'Locked')

    @action(detail=True, methods=['get'])
    def recap(self, request, pk=None):
        """Rekap transfer per rekening (XLSX) — PRD langkah 5, HR only."""
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        return build_recap_xlsx(self.get_object())

    @action(detail=True, methods=['get', 'post'])
    def review(self, request, pk=None):
        """GET: review data (read-only summary + per-employee detail).
        POST: transition CALCULATED → REVIEW.

        HR sees everything; MANAGEMENT only their own payroll.
        """
        if request.method == 'POST':
            return self._transition(request, pk, PayrollPeriod.Status.REVIEW, 'Review')
        period = self.get_object()
        payrolls = (
            Payroll.objects.filter(period=period)
            .select_related('employee')
            .prefetch_related('items')
        )
        role = _role(request.user)
        if role == 'MANAGEMENT':
            personnel = getattr(request.user, 'personnel', None)
            employee = getattr(personnel, 'employee', None)
            if employee is None:
                payrolls = payrolls.none()
            else:
                payrolls = payrolls.filter(employee_id=employee.id)

        def _num(v):
            return float(v or 0)

        rows = []
        totals = {
            'employee_count': payrolls.count(),
            'total_gross': ZERO,
            'total_pph21': ZERO,
            'total_deduction': ZERO,
            'total_thp': ZERO,
            'total_transfer': ZERO,
        }
        for p in payrolls:
            pph = sum(
                (it.amount for it in p.items.all() if it.component_code == 'PPh21'),
                ZERO,
            )
            totals['total_gross'] += p.gross_salary
            totals['total_pph21'] += pph
            totals['total_deduction'] += p.total_deduction
            totals['total_thp'] += p.net_salary
            totals['total_transfer'] += p.transfer_amount
            rows.append({
                'payroll_id': p.id,
                'employee_id': p.employee_id,
                'employee_name': p.employee.full_name,
                'basic_salary': _num(p.basic_salary),
                'total_fixed_earning': _num(p.total_fixed_earning),
                'total_variable_earning': _num(p.total_variable_earning),
                'reimbursement_total': _num(p.reimbursement_total),
                'gross_salary': _num(p.gross_salary),
                'pph21': _num(pph),
                'total_deduction': _num(p.total_deduction),
                'net_salary': _num(p.net_salary),
                'transfer_amount': _num(p.transfer_amount),
                'is_dtp': p.is_dtp,
                'items': PayrollItemSerializer(p.items.all(), many=True).data,
            })
        return Response({
            'period': PayrollPeriodSerializer(period).data,
            'summary': {k: _num(v) for k, v in totals.items()},
            'employees': rows,
        })


class PayrollViewSet(viewsets.ReadOnlyModelViewSet):
    """Payroll records (and items) for a period. HR + MANAGEMENT read-only via API;
    manual item editing is handled by HR through dedicated endpoints (see below).

    MANAGEMENT scope: only their OWN payroll (self-slip). Direct reports' and
    other employees' payroll is never visible to MANAGEMENT."""

    queryset = Payroll.objects.select_related('employee', 'period').prefetch_related('items')
    serializer_class = PayrollSerializer
    permission_classes = [IsPayrollAdmin]
    filterset_fields = ['period', 'employee']
    search_fields = ['employee__full_name']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if _role(self.request.user) == 'MANAGEMENT':
            personnel = getattr(self.request.user, 'personnel', None)
            employee = getattr(personnel, 'employee', None)
            if employee is None:
                return qs.none()
            return qs.filter(employee_id=employee.id)
        return qs

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
        payroll = Payroll.objects.prefetch_related('items').get(pk=payroll.pk)
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
        payroll = Payroll.objects.prefetch_related('items').get(pk=payroll.pk)
        refresh_payroll_totals(payroll)
        return Response(PayrollSerializer(payroll).data)

    @action(detail=True, methods=['get'])
    def payslip(self, request, pk=None):
        """Slip gaji PDF (PRD Section 6) — HR only, period PAID/LOCKED."""
        if _role(request.user) not in PAYROLL_ADMIN_ROLES:
            return Response({'detail': 'Tidak berwenang.'}, status=403)
        return build_payslip_pdf(self.get_object())

