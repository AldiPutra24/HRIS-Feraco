"""Anti-spam guards for public (no-login) freelance applications.

Shared by the public job apply endpoint (/jobs/<slug>, FREELANCE jobs).
Originally lived on the retired /freelance/apply/<slug> portal view.
"""
import time
from datetime import timedelta

from django.utils import timezone

# Simple in-memory per-IP rate limit: max 5 submissions / 10 minutes.
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 600
_rate: dict = {}

DUPLICATE_WINDOW = timedelta(hours=24)


def client_ip(request):
    fwd = request.META.get('HTTP_X_FORWARDED_FOR', '')
    return (fwd.split(',')[0].strip() if fwd else request.META.get('REMOTE_ADDR', '')) or 'unknown'


def rate_limited(request):
    """Record one submission for this IP; True when over the limit."""
    now = time.monotonic()
    ip = client_ip(request)
    hits = [t for t in _rate.get(ip, []) if now - t < RATE_WINDOW_SECONDS]
    if len(hits) >= RATE_LIMIT:
        return True
    hits.append(now)
    _rate[ip] = hits
    return False


def reset():
    """Clear rate-limit state (tests)."""
    _rate.clear()


def duplicate_application(job, email, skill_id):
    """Same email + same position (skill) on the same job within 24h."""
    from .models import CandidateSkill

    if not str(skill_id or '').isdigit():
        return False
    return CandidateSkill.objects.filter(
        candidate__job=job,
        skill_id=int(skill_id),
        candidate__email__iexact=(email or '').strip(),
        submitted_at__gte=timezone.now() - DUPLICATE_WINDOW,
    ).exists()
