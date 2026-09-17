'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import { EmailBodyEditor } from '@/features/settings/email-body-editor';
import {
  EVENT_CONFIG_LABELS,
  getNotificationSettings,
  listEventConfigs,
  listHrCandidates,
  previewEventConfig,
  updateEventConfig,
  updateNotificationSettings,
  type EventConfig,
  type EventPreview,
  type HrCandidate,
  type NotificationSetting,
} from '@/lib/notifications';

// Frontend role casing (AuthRole union): lowercase — matches user.role from
// auth-client toUser() which lowercases backend Role.key (uppercase).
const HR_ROLES: ReadonlySet<string> = new Set(['admin', 'hr_staff', 'hr_lead']);

function PreviewModal({
  preview,
  onClose,
}: {
  preview: EventPreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;
  // Konvensi modal HRIS: klik backdrop TIDAK menutup modal (hanya tombol).
  return (
    <div className='bg-background/60 fixed inset-0 z-50 flex items-center justify-center p-4'>
      <div className='bg-background flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border shadow-lg'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <p className='text-sm font-semibold'>Preview Email</p>
          <Button variant='ghost' size='icon-sm' onClick={onClose} aria-label='Tutup preview'>
            <Icons.close className='size-4' />
          </Button>
        </div>
        <div className='flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs'>
          <span className='text-muted-foreground shrink-0'>Subjek:</span>
          <span className='truncate font-medium'>{preview.subject}</span>
        </div>
        <div className='overflow-auto px-4 py-3'>
          {/* Rendered exactly like the email body (sanitized server-side,
              placeholders replaced with dummy data). Not editable. */}
          {preview.is_html ? (
            <div
              className='text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-l-border [&_blockquote]:pl-3 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6'
              // Sanitized server-side (whitelist sanitizer) before it is
              // returned by the preview API; never edited by the user here.
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <p className='text-sm leading-relaxed whitespace-pre-wrap'>{preview.text}</p>
          )}
        </div>
        <div className='flex justify-end gap-2 border-t px-4 py-3'>
          <Button variant='outline' onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventCard({
  config,
  onSaved,
  showEnabled,
}: {
  config: EventConfig;
  onSaved: () => void;
  showEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [subject, setSubject] = useState(config.subject);
  const [body, setBody] = useState(config.body);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<EventPreview | null>(null);

  async function save() {
    setSaving(true);
    try {
      await updateEventConfig(config.id, {
        enabled: showEnabled ? enabled : true,
        subject,
        body,
      });
      toast.success('Template disimpan.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  async function showPreview() {
    setPreviewing(true);
    try {
      // Send the UNSAVED editor content; backend renders with dummy data,
      // saves nothing, sends nothing.
      const result = await previewEventConfig({ event: config.event, subject, body });
      setPreview(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat preview.');
    } finally {
      setPreviewing(false);
    }
  }

  const dirty =
    enabled !== config.enabled || subject !== config.subject || body !== config.body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center justify-between gap-2 text-base'>
          <span>{EVENT_CONFIG_LABELS[config.event] ?? config.event}</span>
          {showEnabled && (
            <label className='flex items-center gap-2 text-sm font-normal'>
              <input
                type='checkbox'
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Aktif
            </label>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div>
          <Label className='mb-1 block text-xs' htmlFor={`subj-${config.id}`}>
            Email Subject
          </Label>
          <Input
            id={`subj-${config.id}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder='Subject email (placeholder boleh dipakai)'
          />
        </div>
        <div>
          <Label className='mb-1 block text-xs' htmlFor={`body-${config.id}`}>
            Email Body
          </Label>
          <EmailBodyEditor
            id={`body-${config.id}`}
            value={body}
            onChange={setBody}
            placeholders={config.available_placeholders}
          />
        </div>
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={showPreview} disabled={previewing}>
            {previewing ? 'Memuat…' : 'Preview Email'}
          </Button>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? 'Menyimpan…' : 'Simpan Template'}
          </Button>
        </div>
      </CardContent>
      <PreviewModal preview={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

export function NotificationSettings() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const allowed = role !== null && HR_ROLES.has(role);

  const [loading, setLoading] = useState(true);
  const [setting, setSetting] = useState<NotificationSetting | null>(null);
  const [configs, setConfigs] = useState<EventConfig[]>([]);
  const [candidates, setCandidates] = useState<HrCandidate[]>([]);
  const [hrEmails, setHrEmails] = useState('');
  const [offsets, setOffsets] = useState('');
  const [savingSetting, setSavingSetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, evs, cands] = await Promise.all([
        getNotificationSettings(),
        listEventConfigs(),
        listHrCandidates(),
      ]);
      setSetting(s);
      setHrEmails(s.default_hr_emails);
      setOffsets(s.contract_offsets);
      setConfigs(evs);
      setCandidates(cands);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pengaturan.');
    } finally {
      setLoading(false);
    }
  }, []);

  // oxlint-disable-next-line react/set-state-in-effect -- initial data fetch
  useEffect(() => {
    load();
  }, [load]);

  const selectedHr = setting?.additional_hr_details ?? [];

  async function toggleHrUser(id: number) {
    if (!setting) return;
    const current = setting.additional_hr_users;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    await saveSettings({ additional_hr_users: next });
  }

  async function toggleBirthday(kind: 'h1' | 'h0') {
    if (!setting) return;
    await saveSettings(
      kind === 'h1'
        ? { birthday_h1_enabled: !setting.birthday_h1_enabled }
        : { birthday_h0_enabled: !setting.birthday_h0_enabled },
    );
  }

  async function saveSettings(patch: Record<string, unknown>) {
    setSavingSetting(true);
    try {
      const updated = await updateNotificationSettings(patch);
      setSetting(updated);
      setHrEmails(updated.default_hr_emails);
      setOffsets(updated.contract_offsets);
      toast.success('Pengaturan disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSavingSetting(false);
    }
  }

  if (!allowed) {
    return (
      <Card>
        <CardContent className='py-10 text-center'>
          <p className='font-medium'>Akses ditolak</p>
          <p className='text-muted-foreground text-sm'>
            Hanya HR/Admin yang dapat mengatur notifikasi.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className='h-24 w-full' />
        ))}
      </div>
    );
  }

  const leaveEvents = configs.filter((c) => c.event.startsWith('LEAVE'));
  const contractEvents = configs.filter((c) => c.event === 'CONTRACT');
  const birthdayEvents = configs.filter((c) => c.event.startsWith('BIRTHDAY'));

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Penerima HR</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div>
            <Label className='mb-1 block text-xs' htmlFor='hr-emails'>
              Default HR Email (pisahkan dengan koma)
            </Label>
            <div className='flex gap-2'>
              <Input
                id='hr-emails'
                value={hrEmails}
                onChange={(e) => setHrEmails(e.target.value)}
                placeholder='hr@example.com, hrd@example.com'
              />
              <Button
                variant='outline'
                disabled={savingSetting}
                onClick={() => saveSettings({ default_hr_emails: hrEmails })}
              >
                Simpan
              </Button>
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              Email default ini selalu menerima notifikasi HR (tidak dapat dihapus
              seluruhnya).
            </p>
          </div>
          <div>
            <Label className='mb-1 block text-xs'>
              HR Tambahan (dari User role HR Staff / HR Lead)
            </Label>
            {candidates.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                Tidak ada user dengan role HR Staff/HR Lead.
              </p>
            ) : (
              <div className='space-y-1'>
                {candidates.map((c) => (
                  <label key={c.id} className='flex items-center gap-2 text-sm'>
                    <input
                      type='checkbox'
                      checked={selectedHr.some((s) => s.id === c.id)}
                      onChange={() => toggleHrUser(c.id)}
                      disabled={savingSetting}
                    />
                    <span className='font-medium'>{c.username}</span>
                    <span className='text-muted-foreground'>
                      ({c.email} — {c.role})
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>End of Contract</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div>
            <Label className='mb-1 block text-xs' htmlFor='offsets'>
              Reminder (H-, hari sebelum end_date, pisahkan koma)
            </Label>
            <div className='flex gap-2'>
              <Input
                id='offsets'
                value={offsets}
                onChange={(e) => setOffsets(e.target.value)}
                placeholder='30,14,7,3,1,0'
              />
              <Button
                variant='outline'
                disabled={savingSetting}
                onClick={() => saveSettings({ contract_offsets: offsets })}
              >
                Simpan
              </Button>
            </div>
          </div>
          {contractEvents.map((c) => (
            <EventCard key={c.id} config={c} onSaved={load} showEnabled />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Birthday</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap gap-4'>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={setting?.birthday_h1_enabled ?? false}
                onChange={() => toggleBirthday('h1')}
                disabled={savingSetting}
              />
              H-1 (besok)
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={setting?.birthday_h0_enabled ?? false}
                onChange={() => toggleBirthday('h0')}
                disabled={savingSetting}
              />
              H-0 (hari ini)
            </label>
          </div>
          {birthdayEvents.map((c) => (
            <EventCard key={c.id} config={c} onSaved={load} showEnabled={false} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Izin/Cuti</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {leaveEvents.map((c) => (
            <EventCard key={c.id} config={c} onSaved={load} showEnabled />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
