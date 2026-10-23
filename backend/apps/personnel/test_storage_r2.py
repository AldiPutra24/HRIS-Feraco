"""Cloudflare R2 storage backend (STORAGE_BACKEND=r2) + migrate_storage_to_r2.

Uses a real boto3 S3 client with botocore's Stubber, so request shapes
(bucket, key prefix, content type) are validated without network access.
"""
import io
from io import StringIO
from unittest import mock

import boto3
from botocore.response import StreamingBody
from botocore.stub import Stubber
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, override_settings

from apps.personnel import storage

R2 = dict(STORAGE_BACKEND='r2', R2_ACCOUNT_ID='acc123', R2_ACCESS_KEY_ID='AKID', R2_SECRET_ACCESS_KEY='SECRET',
          R2_BUCKET='hris-files')
PDF = b'%PDF-1.4 r2 data'
NAME = 'Invoice Hotel, Makan & Taksi.pdf'


def _client():
    return boto3.client('s3', endpoint_url='https://acc123.r2.cloudflarestorage.com', region_name='auto',
                        aws_access_key_id='AKID', aws_secret_access_key='SECRET')


def _not_found(stubber, key):
    stubber.add_client_error('head_object', service_error_code='404', http_status_code=404,
                             expected_params={'Bucket': 'hris-files', 'Key': key})


@override_settings(**R2)
class R2BackendTests(SimpleTestCase):
    def setUp(self):
        self.client_ = _client()
        self.stubber = Stubber(self.client_)
        self.stubber.activate()
        patcher = mock.patch('apps.personnel.storage.r2_client', return_value=self.client_)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.stubber.deactivate)

    def test_is_configured_follows_backend(self):
        self.assertTrue(storage.is_configured())
        with override_settings(R2_BUCKET=''):
            self.assertFalse(storage.is_configured())

    def test_upload_uses_bucket_prefix_and_never_overwrites(self):
        key = f'reimbursement-documents/reimbursements/7/attachments/{NAME}'
        _not_found(self.stubber, key)
        self.stubber.add_response('put_object', {}, {
            'Bucket': 'hris-files', 'Key': key, 'Body': PDF, 'ContentType': 'application/pdf',
        })
        self.assertEqual(
            storage.upload_bytes('reimbursement-documents', f'reimbursements/7/attachments/{NAME}', PDF, 'application/pdf'),
            f'reimbursements/7/attachments/{NAME}',
        )
        # Existing object -> error like Supabase x-upsert:false (no silent overwrite).
        self.stubber.add_response('head_object', {'ContentLength': 5}, {'Bucket': 'hris-files', 'Key': key})
        with self.assertRaisesRegex(RuntimeError, '409'):
            storage.upload_bytes('reimbursement-documents', f'reimbursements/7/attachments/{NAME}', PDF)
        self.stubber.assert_no_pending_responses()

    def test_key_is_sanitized_like_supabase(self):
        # Same object_key() as the Supabase backend -> migrated keys match.
        self.assertEqual(storage.r2_key('employee-documents', 'emp/CV–José [v2].pdf'),
                         'employee-documents/emp/CV_Jose _v2_.pdf')

    def test_stream_file_response_from_r2(self):
        key = f'employee-documents/emp_1/{NAME}'
        self.stubber.add_response('get_object', {'Body': StreamingBody(io.BytesIO(PDF), len(PDF))},
                                  {'Bucket': 'hris-files', 'Key': key})
        res = storage.stream_file_response('employee-documents', f'emp_1/{NAME}', NAME)
        self.assertEqual(b''.join(res.streaming_content), PDF)
        self.assertEqual(res['Content-Type'], 'application/pdf')
        self.assertIn('inline', res['Content-Disposition'])

    def test_missing_object_raises_runtime_error(self):
        self.stubber.add_client_error('get_object', service_error_code='NoSuchKey', http_status_code=404)
        with self.assertRaisesRegex(RuntimeError, 'Storage download failed'):
            storage.open_object('employee-documents', 'missing.pdf')

    def test_delete(self):
        self.stubber.add_response('delete_object', {}, {'Bucket': 'hris-files', 'Key': 'employee-photos/emp_1.jpg'})
        self.assertTrue(storage.delete_object('employee-photos', 'emp_1.jpg'))

    def test_signed_url_for_photo_download(self):
        url = storage.signed_url('employee-photos', 'emp_1_1700.jpg', expires_in=600, download='foto-budi.jpg')
        self.assertTrue(url.startswith('https://acc123.r2.cloudflarestorage.com/hris-files/employee-photos/emp_1_1700.jpg?'))
        self.assertIn('response-content-disposition=attachment', url)
        self.assertIn('X-Amz-Expires=600', url)


@override_settings(**R2, SUPABASE_URL='https://ref.supabase.co', SUPABASE_SECRET_KEY='svc')
class MigrateStorageCommandTests(SimpleTestCase):
    def setUp(self):
        self.r2 = mock.Mock()
        patches = [
            mock.patch('apps.personnel.storage.r2_client', return_value=self.r2),
            mock.patch('apps.personnel.storage.supabase_list_buckets', return_value=['employee-documents', 'employee-photos']),
            mock.patch('apps.personnel.storage.supabase_list_objects', side_effect=self._list),
            mock.patch('apps.personnel.storage.supabase_open_object', side_effect=self._open),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.r2_sizes = {}  # key -> size already in R2

        def head(Bucket, Key):
            from botocore.exceptions import ClientError

            if Key not in self.r2_sizes:
                raise ClientError({'Error': {'Code': '404'}, 'ResponseMetadata': {'HTTPStatusCode': 404}}, 'HeadObject')
            return {'ContentLength': self.r2_sizes[Key]}

        def put(Bucket, Key, Body, ContentType):
            self.r2_sizes[Key] = len(Body)

        self.r2.head_object.side_effect = head
        self.r2.put_object.side_effect = put
        self.files = {
            'employee-documents': {f'emp_1/{NAME}': PDF, 'emp_2/ktp.pdf': PDF + b'x'},
            'employee-photos': {'emp_1_1700.jpg': b'\xff\xd8\xff photo'},
        }

    def _list(self, bucket):
        return [(k, len(v)) for k, v in self.files[bucket].items()]

    def _open(self, bucket, key):
        res = mock.Mock()
        res.iter_content.return_value = iter([self.files[bucket][key]])
        res.headers = {'Content-Type': 'application/pdf'}
        return res

    def _run(self, *args):
        out = StringIO()
        call_command('migrate_storage_to_r2', *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_dry_run_copies_nothing(self):
        out = self._run('--dry-run')
        self.assertIn('Total 3 file', out)
        self.assertIn('akan disalin 3', out)
        self.r2.put_object.assert_not_called()

    def test_copies_with_same_keys_and_is_idempotent(self):
        out = self._run()
        self.assertIn('disalin 3', out)
        self.assertEqual(set(self.r2_sizes), {
            f'employee-documents/emp_1/{NAME}', 'employee-documents/emp_2/ktp.pdf', 'employee-photos/emp_1_1700.jpg',
        })
        # Second run (e.g. right after switching): nothing to copy.
        self.r2.put_object.reset_mock()
        out = self._run()
        self.assertIn('sudah ada di R2 3', out)
        self.r2.put_object.assert_not_called()
        # A new upload in Supabase is picked up by the next run.
        self.files['employee-photos']['emp_2_1800.jpg'] = b'\xff\xd8\xff new'
        out = self._run('--bucket', 'employee-photos')
        self.assertIn('disalin 1', out)

    def test_size_mismatch_is_recopied_and_failures_reported(self):
        self.r2_sizes['employee-photos/emp_1_1700.jpg'] = 1  # partial/corrupt earlier copy
        self.files['employee-documents']['emp_2/ktp.pdf'] = PDF

        def flaky_open(bucket, key):
            if key == 'emp_2/ktp.pdf':
                raise RuntimeError('Storage download failed (500)')
            return self._open(bucket, key)

        with mock.patch('apps.personnel.storage.supabase_open_object', side_effect=flaky_open):
            with self.assertRaisesRegex(CommandError, '1 file gagal'):
                self._run()
        self.assertEqual(self.r2_sizes['employee-photos/emp_1_1700.jpg'], len(self.files['employee-photos']['emp_1_1700.jpg']))

    def test_requires_r2_settings(self):
        with override_settings(R2_BUCKET=''):
            with self.assertRaisesRegex(CommandError, 'R2_'):
                self._run('--dry-run')
