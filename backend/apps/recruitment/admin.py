from django.contrib import admin

from .models import Candidate, Job


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ('title', 'department', 'status', 'open_date', 'close_date')
    search_fields = ('title',)
    list_filter = ('status',)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'email', 'job', 'source', 'created_at')
    search_fields = ('full_name', 'email')
    list_filter = ('source',)
