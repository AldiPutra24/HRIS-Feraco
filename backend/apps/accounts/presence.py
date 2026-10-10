"""Session presence (Online / Last seen) for Settings -> Users.

Only records WHEN a logged-in session was last active — set on login and by
the frontend heartbeat while an HRIS tab is open. Nothing about screen
content, input or browsing is collected.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

# Online = last heartbeat younger than this (frontend beats every ~45s).
ONLINE_WINDOW = timedelta(minutes=2)
# Several open tabs each send heartbeats; skip DB writes closer together
# than this so presence never turns into write load.
MIN_WRITE_INTERVAL = timedelta(seconds=15)


def touch_last_seen(user, *, force=False):
    """Set user.last_seen_at = now (throttled unless force). Returns the value."""
    now = timezone.now()
    last = user.last_seen_at
    if force or last is None or now - last >= MIN_WRITE_INTERVAL:
        # Queryset update: no save() signals/role-group sync, no race with
        # other fields being edited on the same user.
        get_user_model().objects.filter(pk=user.pk).update(last_seen_at=now)
        user.last_seen_at = now
    return user.last_seen_at


def is_online(last_seen_at, now=None):
    if last_seen_at is None:
        return False
    now = now or timezone.now()
    return now - last_seen_at < ONLINE_WINDOW


def seconds_since(last_seen_at, now=None):
    """Whole seconds since last seen (never negative), or None."""
    if last_seen_at is None:
        return None
    now = now or timezone.now()
    return max(0, int((now - last_seen_at).total_seconds()))
