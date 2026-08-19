from django.contrib.auth.models import AbstractUser, Group, Permission
from django.db import models


class Role(models.Model):
    """Granular role with optional M2M permissions (RBAC)."""

    ADMIN = 'ADMIN'
    HR_STAFF = 'HR_STAFF'
    HR_LEAD = 'HR_LEAD'
    EMPLOYEE = 'EMPLOYEE'
    MANAGEMENT = 'MANAGEMENT'
    ROLE_CHOICES = [
        (ADMIN, 'Admin'),
        (HR_STAFF, 'HR Staff'),
        (HR_LEAD, 'HR Lead'),
        (EMPLOYEE, 'Employee'),
        (MANAGEMENT, 'Management'),
    ]

    key = models.CharField(max_length=32, choices=ROLE_CHOICES, unique=True)
    name = models.CharField(max_length=64)
    permissions = models.ManyToManyField(Permission, blank=True, related_name='roles')

    class Meta:
        ordering = ['key']

    def __str__(self):
        return self.key


class User(AbstractUser):
    """Custom user carrying a single role (roles granted via Group too)."""

    role = models.ForeignKey(
        Role,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='users',
    )

    def __str__(self):
        return self.get_username()

    def has_role(self, key: str) -> bool:
        return self.role is not None and self.role.key == key

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        # Keep the auth Group in sync with the assigned role for standard RBAC.
        if self.role:
            group, _ = Group.objects.get_or_create(name=self.role.key)
            if is_new:
                self.groups.add(group)
            else:
                self.groups.set([group])
        else:
            self.groups.clear()
