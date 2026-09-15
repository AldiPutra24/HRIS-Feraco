from django.contrib import admin

from .models import (
    Event,
    EventAssignment,
    FreelancerDocument,
    FreelancerPerformance,
    FreelancerSkill,
    Skill,
    SkillCategory,
)


@admin.register(SkillCategory)
class SkillCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active')
    search_fields = ('name',)


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'is_active')
    search_fields = ('name',)
    list_filter = ('category', 'is_active')


@admin.register(FreelancerSkill)
class FreelancerSkillAdmin(admin.ModelAdmin):
    list_display = ('freelancer', 'skill', 'note')
    search_fields = ('freelancer__full_name', 'skill__name')


@admin.register(FreelancerDocument)
class FreelancerDocumentAdmin(admin.ModelAdmin):
    list_display = ('name', 'freelancer', 'doc_type', 'created_at')
    search_fields = ('name', 'freelancer__full_name')


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ('name', 'event_date', 'location', 'client')
    search_fields = ('name', 'client', 'location')


@admin.register(EventAssignment)
class EventAssignmentAdmin(admin.ModelAdmin):
    list_display = ('freelancer', 'event', 'role', 'pic', 'assigned_at')
    search_fields = ('freelancer__full_name', 'event__name')


@admin.register(FreelancerPerformance)
class FreelancerPerformanceAdmin(admin.ModelAdmin):
    list_display = ('assignment', 'rating', 'recommendation', 'evaluator')
    list_filter = ('recommendation',)
