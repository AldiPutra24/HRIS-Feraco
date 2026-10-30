from django.contrib import admin

from .models import Candidate, CandidateProfile, Job


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ('title', 'department', 'status', 'open_date', 'close_date')
    search_fields = ('title',)
    list_filter = ('status',)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'email', 'job', 'track', 'source', 'created_at')
    raw_id_fields = ('profile',)
    search_fields = ('full_name', 'email')
    list_filter = ('source',)


@admin.register(CandidateProfile)
class CandidateProfileAdmin(admin.ModelAdmin):
    list_display = ('code', 'full_name', 'email', 'phone', 'created_at')
    search_fields = ('code', 'full_name', 'email', 'phone')
    raw_id_fields = ('possible_duplicate_of', 'freelancer', 'employee')
