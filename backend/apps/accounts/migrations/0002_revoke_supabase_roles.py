"""Revoke Data API (PostgREST) access to HRIS tables.

Supabase exposes tables to the `anon` and `authenticated` roles via PostgREST
when grants exist. This app never uses the Data API (Next.js -> Django/DRF ->
PostgreSQL direct), so revoke those roles' table/sequence privileges on the
Django HRIS tables. The Django connection role and Supabase Storage are
untouched; no RLS is enabled.
"""

from django.db import migrations

APPS = ('accounts', 'personnel', 'audit', 'leaves')
ROLES = ('anon', 'authenticated')


def revoke(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    cursor = connection.cursor()
    quote = connection.ops.quote_name
    tables = [
        model._meta.db_table
        for model in apps.get_models(include_auto_created=True)
        if model._meta.app_label in APPS
    ]
    for role in ROLES:
        cursor.execute('SELECT 1 FROM pg_roles WHERE rolname = %s', [role])
        if cursor.fetchone() is None:
            continue
        for table in tables:
            cursor.execute(
                f'REVOKE ALL PRIVILEGES ON TABLE {quote(table)} FROM {quote(role)}'
            )


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        ('personnel', '0007_employeecontract_termination_date_and_more'),
        ('audit', '0002_auditlog_fields'),
        ('leaves', '0002_leaverequest_balance_deducted'),
    ]

    operations = [
        migrations.RunPython(revoke, migrations.RunPython.noop),
    ]
