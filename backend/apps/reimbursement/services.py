"""Reimbursement workflow helpers — in-app notifications."""

from .models import ReimbursementNotification

def notify(recipient, reimbursement, message):
    """Create an in-app notification record (no external integration)."""
    if recipient is None:
        return None
    return ReimbursementNotification.objects.create(
        recipient=recipient,
        reimbursement=reimbursement,
        message=message,
    )
