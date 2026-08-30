from django.contrib import admin

from .models import Reimbursement, ReimbursementCategory, ReimbursementNotification

@admin.register(ReimbursementCategory)
class ReimbursementCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_active', 'requires_attachment')

@admin.register(Reimbursement)
class ReimbursementAdmin(admin.ModelAdmin):
    list_display = ('employee', 'category', 'transaction_date', 'amount', 'status')

@admin.register(ReimbursementNotification)
class ReimbursementNotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'reimbursement', 'is_read', 'created_at')
