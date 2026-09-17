from django.contrib import admin

from .models import (
    Notification,
    NotificationDeliveryLog,
    NotificationEventConfig,
    NotificationSetting,
)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'kind', 'title', 'is_read', 'created_at')
    list_filter = ('kind', 'is_read')
    search_fields = ('recipient__username', 'title', 'message')
    readonly_fields = ('created_at',)


@admin.register(NotificationEventConfig)
class NotificationEventConfigAdmin(admin.ModelAdmin):
    list_display = ('event', 'enabled', 'updated_at')


@admin.register(NotificationSetting)
class NotificationSettingAdmin(admin.ModelAdmin):
    list_display = ('default_hr_emails', 'birthday_h1_enabled', 'birthday_h0_enabled', 'updated_at')
    filter_horizontal = ('additional_hr_users',)


@admin.register(NotificationDeliveryLog)
class NotificationDeliveryLogAdmin(admin.ModelAdmin):
    list_display = ('key', 'channel', 'event', 'status', 'created_at')
    list_filter = ('channel', 'event', 'status')
    search_fields = ('key', 'recipient_email')
    readonly_fields = ('key', 'channel', 'event', 'recipient_email', 'recipient',
                       'subject', 'status', 'detail', 'created_at')

    def has_add_permission(self, request):
        return False
