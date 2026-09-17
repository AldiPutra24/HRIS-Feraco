from django.conf import settings
from django.db import models


class Notification(models.Model):
    """In-app notification owned by a user (bell popover source).

    Generic across events: leave workflow, contract end, birthday.
    `link` is a frontend path (e.g. /dashboard/leave) for deep navigation.
    """

    KIND_CHOICES = [
        ('LEAVE_SUBMITTED', 'Izin/Cuti - Pengajuan Baru'),
        ('LEAVE_APPROVED', 'Izin/Cuti - Disetujui'),
        ('LEAVE_REJECTED', 'Izin/Cuti - Ditolak'),
        ('CONTRACT', 'End of Contract'),
        ('BIRTHDAY', 'Birthday'),
    ]

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    title = models.CharField(max_length=255, blank=True)
    message = models.TextField()
    link = models.CharField(max_length=512, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient_id}: {self.kind}: {self.message[:40]}'


class NotificationEventConfig(models.Model):
    """Per-event ON/OFF + email subject/body overrides.

    Rows: LEAVE_SUBMITTED, LEAVE_APPROVED, LEAVE_REJECTED, CONTRACT,
    BIRTHDAY_HR (info email to HR), BIRTHDAY_EMPLOYEE (greeting email).
    For birthday rows the ON/OFF is the master `birthday_h1_enabled` /
    `birthday_h0_enabled` on NotificationSetting — the row only carries
    templates (row.enabled stays True and is not exposed for birthday).
    """

    event = models.CharField(max_length=32, unique=True)
    enabled = models.BooleanField(default=True)
    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['event']

    def __str__(self):
        return self.event


class NotificationSetting(models.Model):
    """Singleton configuration for employee notification + email reminders.

    - default_hr_emails: comma-separated HR recipient emails. The first
      default (hrgaferaco@gmail.com) is a DB default only — never hardcoded
      in business logic. Additional HR recipients come from User accounts
      with role HR_STAFF/HR_LEAD (their account email), selected in Settings.
    - birthday_h1_enabled / birthday_h0_enabled: independent ON/OFF.
    - contract_offsets: comma-separated days-before-end_date values.
    """

    default_hr_emails = models.CharField(max_length=1024, default='hrgaferaco@gmail.com')
    # Additional HR recipients picked from User accounts with role
    # HR_STAFF / HR_LEAD (their account email is used).
    additional_hr_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='notification_hr_recipient_of',
    )
    birthday_h1_enabled = models.BooleanField(default=True)
    birthday_h0_enabled = models.BooleanField(default=True)
    contract_offsets = models.CharField(max_length=255, default='30,14,7,3,1,0')
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_notification_settings',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Notification setting'
        verbose_name_plural = 'Notification settings'

    def __str__(self):
        return 'Notification settings'

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def hr_email_list(self):
        """Default HR emails + emails of selected additional HR users."""
        emails = []
        for raw in (self.default_hr_emails or '').replace(';', ',').split(','):
            raw = raw.strip()
            if '@' in raw and raw not in emails:
                emails.append(raw)
        for u in self.additional_hr_users.filter(is_active=True):
            if u.email and u.email not in emails:
                emails.append(u.email)
        return emails

    def contract_offset_list(self):
        offsets = []
        for raw in (self.contract_offsets or '').split(','):
            raw = raw.strip()
            if raw.isdigit():
                offsets.append(int(raw))
        return sorted(set(offsets), reverse=True)


class NotificationDeliveryLog(models.Model):
    """Delivery/idempotency record — one row per delivered unit.

    `key` embeds the idempotency identity incl. recipient:
      - email:  f'{event_key}:email:{email}'  where event_key examples:
                leave-submitted:{leave_id}, leave-status:{leave_id}:{STATUS},
                contract:{contract_id}:{days_before},
                birthday:{employee_id}:{year}:{offset}:hr,
                birthday:{employee_id}:{year}:{offset}:employee
      - in-app: f'{event_key}:inapp:{user_id}'
    Re-running the engine (or re-firing a hook) get_or_create's the same key
    and must not deliver twice.
    """

    CHANNEL_CHOICES = [
        ('EMAIL', 'Email'),
        ('IN_APP', 'In-app'),
    ]
    STATUS_CHOICES = [
        ('SENT', 'Sent'),
        ('FAILED', 'Failed'),
        ('SKIPPED', 'Skipped'),
    ]

    key = models.CharField(max_length=255, unique=True)
    channel = models.CharField(max_length=16, choices=CHANNEL_CHOICES)
    event = models.CharField(max_length=32, choices=Notification.KIND_CHOICES)
    recipient_email = models.CharField(max_length=254, blank=True)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notification_deliveries',
    )
    subject = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='SENT')
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.key}: {self.status}'
