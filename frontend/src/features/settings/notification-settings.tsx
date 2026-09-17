'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  EVENT_CONFIG_LABELS,
  getNotificationSettings,
  listEventConfigs,
  listHrCandidates,
  updateEventConfig,
  updateNotificationSettings,
  type EventConfig,
  type HrCandidate,
  type NotificationSetting,
} from '@/lib/notifications';

const HR_ROLES = ['ADMIN', 'HR_STAFF', 'HR_LEAD'];

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
          <textarea
            id={`body-${config.id}`}
            className='min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm'
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='Isi email (placeholder boleh dipakai)'
          />
        </div>
        <div className='text-muted-foreground text-xs'>
          <p className='mb-1 font-medium'>Placeholder tersedia:</p>
          <div className='flex flex-wrap gap-1'>
            {config.available_placeholders.map((p) => (
              <button
                key={p}
                type='button'
                className='bg-muted rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent'
                title='Klik untuk salin'
                onClick={() => navigator.clipboard?.writeText(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className='flex justify-end'>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? 'Menyimpan…' : 'Simpan Template'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function NotificationSettings() {
  const { user } = useAuth();
  const role = (user as { role?: string | null } | null)?.role ?? null;
  const allowed = role !== null && HR_ROLES.includes(role);

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
