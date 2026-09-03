from django.contrib import admin

from .models import Onboarding, OnboardingStatusHistory


class OnboardingStatusHistoryInline(admin.TabularInline):
    model = OnboardingStatusHistory
    extra = 0
    readonly_fields = ('from_status', 'to_status', 'changed_by', 'changed_at', 'note')
    can_delete = False


@admin.register(Onboarding)
class OnboardingAdmin(admin.ModelAdmin):
    list_display = ('candidate', 'status', 'target_join_date', 'created_by', 'created_at')
    search_fields = ('candidate__full_name', 'candidate__email')
    list_filter = ('status', 'target_join_date')
    readonly_fields = ('candidate', 'created_by', 'created_at', 'updated_at', 'completed_at')
    inlines = [OnboardingStatusHistoryInline]
