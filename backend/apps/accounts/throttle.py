"""Login brute-force protection: max N failed logins per email and per IP
within a sliding window (default 5 per 15 minutes).

Stored in the database (LoginAttempt) so the limit holds across gunicorn
workers and restarts.
"""
import math
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import LoginAttempt


def _limit():
    return int(getattr(settings, 'LOGIN_FAILURE_LIMIT', 5))


def _window():
    return timedelta(minutes=int(getattr(settings, 'LOGIN_FAILURE_WINDOW_MINUTES', 15)))


def client_ip(request):
    """Client IP behind nginx: X-Real-IP is set by nginx itself ($remote_addr)
    and cannot be spoofed by the client, unlike the first X-Forwarded-For hop."""
    ip = (request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR') or '').strip()
    return ip or None


def _scopes(email, ip):
    scopes = [{'email': email}]
    if ip:
        scopes.append({'ip': ip})
    return scopes


def lock_seconds(email, ip):
    """Seconds until login is allowed again (0 = not locked).

    Locked while the email OR the IP has >= limit failures in the window;
    it unlocks when the limit-th most recent failure leaves the window.
    """
    limit, window, now = _limit(), _window(), timezone.now()
    since = now - window
    wait = 0
    for scope in _scopes(email, ip):
        recent = list(
            LoginAttempt.objects.filter(created_at__gte=since, **scope)
            .order_by('-created_at')
            .values_list('created_at', flat=True)[:limit]
        )
        if len(recent) >= limit:
            wait = max(wait, (recent[limit - 1] + window - now).total_seconds())
    return max(0, math.ceil(wait))


def remaining_attempts(email, ip):
    since = timezone.now() - _window()
    used = max(
        LoginAttempt.objects.filter(created_at__gte=since, **scope).count() for scope in _scopes(email, ip)
    )
    return max(0, _limit() - used)


def record_failure(email, ip):
    LoginAttempt.objects.create(email=email, ip=ip)
    # Housekeeping: rows older than a day are never needed.
    LoginAttempt.objects.filter(created_at__lt=timezone.now() - timedelta(days=1)).delete()


def clear_failures(email):
    LoginAttempt.objects.filter(email=email).delete()


def lock_message(seconds):
    minutes = max(1, math.ceil(seconds / 60))
    return (
        f'Terlalu banyak percobaan login gagal. Akun/perangkat ini dikunci sementara, '
        f'coba lagi dalam {minutes} menit.'
    )
