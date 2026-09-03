from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.services import log_event

from .models import Onboarding
from .permissions import IsOnboardingAdmin
from .serializers import OnboardingSerializer
from .services import transition_onboarding


class OnboardingViewSet(viewsets.ModelViewSet):
    queryset = (
        Onboarding.objects.select_related(
            'candidate',
            'candidate__job',
            'candidate__job__department',
            'candidate__job__position',
            'created_by',
        )
        .prefetch_related('status_history')
        .all()
    )
    serializer_class = OnboardingSerializer
    permission_classes = [IsOnboardingAdmin]
    filterset_fields = ['status', 'candidate']
    search_fields = ['candidate__full_name', 'candidate__email', 'candidate__job__title']
    ordering_fields = ['created_at', 'target_join_date']
    ordering = ['-created_at']

    def create(self, request, *args, **kwargs):
        candidate_id = request.data.get('candidate')
        if not candidate_id:
            return Response({'detail': 'candidate wajib diisi.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.recruitment.models import Candidate
        try:
            candidate = Candidate.objects.select_related('job').get(pk=candidate_id)
        except Candidate.DoesNotExist:
            return Response({'detail': 'Candidate tidak ditemukan.'}, status=status.HTTP_400_BAD_REQUEST)

        if candidate.status != 'OFFER_ACCEPTED':
            return Response(
                {'detail': 'Onboarding hanya dapat dibuat untuk candidate dengan status OFFER_ACCEPTED.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Onboarding.objects.filter(candidate=candidate).exists():
            return Response(
                {'detail': 'Onboarding untuk candidate ini sudah ada.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save(candidate=candidate, created_by=request.user)
        log_event(
            request,
            'create',
            obj=obj,
            description=f'Onboarding dibuat untuk candidate "{candidate.full_name}"',
        )
        return Response(
            self.get_serializer(obj, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        if not obj.is_editable():
            raise serializers.ValidationError('Onboarding COMPLETED/CANCELLED tidak dapat diubah.')
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        obj = self.get_object()
        if not obj.is_editable():
            raise serializers.ValidationError('Onboarding COMPLETED/CANCELLED tidak dapat diubah.')
        return super().partial_update(request, *args, **kwargs)

    def perform_update(self, serializer):
        obj = serializer.save()
        log_event(
            self.request,
            'update',
            obj=obj,
            description=f'Onboarding "{obj.candidate.full_name}" diperbarui',
        )

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        """Forward-only status move. HR/admin only."""
        obj = self.get_object()
        to_status = request.data.get('status')
        note = (request.data.get('note') or '').strip()
        if not to_status or to_status not in dict(Onboarding.Status.choices):
            return Response({'detail': 'Status tidak valid.'}, status=status.HTTP_400_BAD_REQUEST)
        onboarding, history = transition_onboarding(obj, to_status, request, note)
        if onboarding is None:
            return Response(
                {'detail': f'Transisi dari {obj.status} ke {to_status} tidak diizinkan.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(self.get_serializer(onboarding, context={'request': request}).data)



