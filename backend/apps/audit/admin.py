from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'user', 'content_object', 'ip_address', 'created_at')
    list_filter = ('action', 'created_at')
    readonly_fields = ('action', 'user', 'content_type', 'object_id', 'description', 'ip_address', 'created_at')
