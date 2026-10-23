"""Copy every file from Supabase Storage to Cloudflare R2 (same keys).

Each Supabase bucket becomes a key prefix in the single R2 bucket
(`<bucket>/<path>`), matching apps.personnel.storage.r2_key, so paths stored
in the database keep working once STORAGE_BACKEND=r2.

Safe to run repeatedly: objects already in R2 with the same size are
skipped. Run once before switching STORAGE_BACKEND, and once more right
after the switch to pick up files uploaded in between. Supabase is only
read, never modified.

    python manage.py migrate_storage_to_r2 --dry-run
    python manage.py migrate_storage_to_r2
    python manage.py migrate_storage_to_r2 --bucket employee-documents
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.personnel import storage


def _mb(n):
    return f'{n / (1024 * 1024):.1f} MB'


class Command(BaseCommand):
    help = 'Copy all Supabase Storage objects to Cloudflare R2 (idempotent; Supabase is read-only).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Only list what would be copied.')
        parser.add_argument('--bucket', action='append', default=[],
                            help='Only this Supabase bucket (repeatable). Default: all buckets.')
        parser.add_argument('--force', action='store_true', help='Re-copy even when R2 already has the object.')

    def handle(self, *args, **opts):
        if not storage.supabase_configured():
            raise CommandError('SUPABASE_URL / SUPABASE_SECRET_KEY belum diisi (sumber migrasi).')
        if not storage.r2_configured():
            raise CommandError('R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET belum diisi.')

        buckets = opts['bucket'] or storage.supabase_list_buckets()
        dry = opts['dry_run']
        self.stdout.write(f'Sumber: Supabase {buckets} -> R2 bucket "{settings.R2_BUCKET}"'
                          f'{" (DRY RUN)" if dry else ""}')

        totals = {'objects': 0, 'bytes': 0, 'copied': 0, 'copied_bytes': 0, 'skipped': 0}
        failures = []
        for bucket in buckets:
            b_objects = b_copied = 0
            for key, size in storage.supabase_list_objects(bucket):
                totals['objects'] += 1
                totals['bytes'] += size
                b_objects += 1
                try:
                    if not opts['force'] and storage.r2_head(bucket, key) == size:
                        totals['skipped'] += 1
                        continue
                    if dry:
                        self.stdout.write(f'  akan disalin: {bucket}/{key} ({_mb(size)})')
                        totals['copied'] += 1
                        totals['copied_bytes'] += size
                        b_copied += 1
                        continue
                    self._copy(bucket, key)
                    totals['copied'] += 1
                    totals['copied_bytes'] += size
                    b_copied += 1
                except Exception as exc:  # keep going; report at the end
                    failures.append((f'{bucket}/{key}', str(exc)[:200]))
                    self.stderr.write(f'  GAGAL: {bucket}/{key}: {str(exc)[:200]}')
            self.stdout.write(f'- {bucket}: {b_objects} file, {"akan " if dry else ""}disalin {b_copied}')

        self.stdout.write(
            f'\nTotal {totals["objects"]} file ({_mb(totals["bytes"])}); '
            f'{"akan disalin" if dry else "disalin"} {totals["copied"]} ({_mb(totals["copied_bytes"])}); '
            f'sudah ada di R2 {totals["skipped"]}; gagal {len(failures)}.'
        )
        if failures:
            for name, err in failures[:50]:
                self.stderr.write(f'  - {name}: {err}')
            raise CommandError(f'{len(failures)} file gagal disalin. Jalankan ulang command ini (file yang sudah ada dilewati).')
        self.stdout.write(self.style.SUCCESS('Selesai.' if not dry else 'Dry run selesai, tidak ada yang disalin.'))

    @staticmethod
    def _copy(bucket, key):
        upstream = storage.supabase_open_object(bucket, key)
        try:
            data = b''.join(upstream.iter_content(chunk_size=1024 * 1024))
            content_type = upstream.headers.get('Content-Type') or 'application/octet-stream'
        finally:
            upstream.close()
        storage.r2_client().put_object(Bucket=settings.R2_BUCKET, Key=storage.r2_key(bucket, key),
                                       Body=data, ContentType=content_type)
        copied = storage.r2_head(bucket, key)
        if copied != len(data):
            raise RuntimeError(f'Verifikasi ukuran gagal (Supabase {len(data)} B, R2 {copied} B)')
