from django.contrib import admin

from .models import LeaveBalance, LeaveNotification, LeaveRequest, LeaveType


@admin.register(LeaveType)
class LeaveTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'kind', 'is_active', 'default_quota', 'requires_attachment')
    list_filter = ('kind', 'is_active')


@admin.register(LeaveBalance)
class LeaveBalanceAdmin(admin.ModelAdmin):
    list_display = ('employee', 'leave_type', 'year', 'allocated_days', 'used_days', 'remaining_days')


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ('employee', 'leave_type', 'start_date', 'end_date', 'total_days', 'status')


@admin.register(LeaveNotification)
class LeaveNotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'leave_request', 'is_read', 'created_at')
