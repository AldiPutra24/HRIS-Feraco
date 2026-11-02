'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { getSelfAccount } from '@/lib/auth/auth-client';
import { useAuth } from '@/lib/auth/auth-provider';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  hr_lead: 'HR Lead',
  hr_staff: 'HR Staff',
  general_manager: 'General Manager',
  management: 'Management',
  employee: 'Employee'
};

// Backend rules (AUTH_PASSWORD_VALIDATORS): min 8 chars + not a common
// password. The common list here only covers the obvious ones for live
// feedback; the server's full list is the final check on save.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', '11111111', '00000000',
  'qwertyui', 'qwertyuiop', 'qwerty123', 'abc12345', 'abcd1234', 'iloveyou', 'admin123', 'welcome1',
  'letmein1', 'sunshine', 'football', 'baseball', 'princess', 'passw0rd', 'p@ssw0rd', 'superman', 'trustno1'
]);

function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Two-column card: title + explanation on the left, form on the right. */
function SettingsCard({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <Card className='gap-0 overflow-hidden py-0 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2.5fr)]'>
      <div className='border-b px-6 py-6 md:border-r md:border-b-0'>
        <h3 className='text-lg font-semibold'>{title}</h3>
        <p className='text-muted-foreground mt-1.5 text-sm'>{text}</p>
      </div>
      <div className='px-6 py-6'>{children}</div>
    </Card>
  );
}

function Rule({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cn('flex items-center gap-2 text-sm', ok ? 'text-primary' : 'text-muted-foreground')}>
      {ok ? <Icons.circleCheck className='size-4' /> : <Icons.circle className='size-4' />}
      {children}
    </span>
  );
}

const STRENGTH = [
  { label: 'Masukkan password baru', bar: '' },
  { label: 'Lemah', bar: 'bg-red-500' },
  { label: 'Cukup', bar: 'bg-amber-500' },
  { label: 'Kuat', bar: 'bg-emerald-500' },
  { label: 'Sangat kuat', bar: 'bg-primary' }
];

export function AccountSettings() {
  const { user, updateAccount } = useAuth();
  // Last saved account values (the password form resends these unchanged).
  const [saved, setSaved] = useState({ username: '', email: '', name: '', first_name: '', last_name: '' });
  const [info, setInfo] = useState({ username: '', email: '', name: '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getSelfAccount()
      .then((acc) => {
        if (cancelled) return;
        const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ');
        setSaved({ username: acc.username, email: acc.email, name, first_name: acc.first_name, last_name: acc.last_name });
        setInfo({ username: acc.username, email: acc.email, name });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Gagal memuat data akun.'));
    return () => {
      cancelled = true;
    };
    // Load once per logged-in user; later `user` refreshes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const infoChanged =
    info.username.trim() !== saved.username || info.email.trim() !== saved.email || info.name.trim() !== saved.name;

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    const nameChanged = info.name.trim() !== saved.name;
    setSavingInfo(true);
    try {
      // An unchanged name is sent back as-is so first/last name are never rewritten.
      const first_name = nameChanged ? info.name.trim() : saved.first_name;
      const last_name = nameChanged ? '' : saved.last_name;
      await updateAccount({ username: info.username.trim(), email: info.email.trim(), first_name, last_name });
      setSaved({ username: info.username.trim(), email: info.email.trim(), name: info.name.trim(), first_name, last_name });
      toast.success('Informasi login diperbarui.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui akun.');
    } finally {
      setSavingInfo(false);
    }
  }

  const longEnough = pw.next.length >= 8;
  const lettersDigits = /[a-zA-Z]/.test(pw.next) && /\d/.test(pw.next);
  const notCommon = pw.next.length > 0 && !COMMON_PASSWORDS.has(pw.next.toLowerCase());
  const score = !pw.next
    ? 0
    : !longEnough || !notCommon
      ? 1
      : 2 + Number(lettersDigits) + Number(pw.next.length >= 12 && /[^a-zA-Z0-9]/.test(pw.next));
  const mismatch = pw.confirm.length > 0 && pw.confirm !== pw.next;
  const canSavePw = !!pw.current && longEnough && notCommon && pw.confirm === pw.next;

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!canSavePw) return;
    setSavingPw(true);
    try {
      await updateAccount({
        username: saved.username,
        email: saved.email,
        first_name: saved.first_name,
        last_name: saved.last_name,
        password: pw.next,
        current_password: pw.current
      });
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password diperbarui.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui password.');
    } finally {
      setSavingPw(false);
    }
  }

  const role = user?.role ?? '';
  const profileHref =
    role === 'management' || role === 'general_manager'
      ? '/dashboard/management/profile'
      : role === 'employee' || role === 'hr_staff' || role === 'hr_lead'
        ? '/dashboard/employee/profile'
        : null;
  const displayName = saved.name || user?.name || '';
  const pwType = showPw ? 'text' : 'password';

  return (
    <div className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 md:p-8'>
      <div>
        <h2 className='text-3xl font-bold tracking-tight'>Pengaturan Akun</h2>
        <p className='text-muted-foreground mt-1'>Kelola informasi login dan keamanan akun HRIS Anda.</p>
      </div>

      <Card className='flex-row flex-wrap items-center gap-4 px-6 py-5'>
        {user?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.photoUrl} alt='' className='size-14 rounded-full object-cover' />
        ) : (
          <span className='bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full text-xl font-semibold'>
            {initials(displayName) || '?'}
          </span>
        )}
        <div className='min-w-0 flex-1'>
          <p className='truncate font-semibold'>{displayName}</p>
          <p className='text-muted-foreground truncate text-sm'>{saved.email || user?.email}</p>
        </div>
        <span className='bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm'>
          <Icons.user className='size-3.5' />
          Role: {ROLE_LABELS[role] ?? role}
        </span>
        {profileHref && (
          <Link href={profileHref} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 px-4')}>
            Lihat profil karyawan
            <Icons.arrowRight className='size-4' />
          </Link>
        )}
      </Card>

      <SettingsCard title='Informasi login' text='Username dan email dipakai untuk masuk ke HRIS. Nama tampil di seluruh sistem.'>
        <form onSubmit={saveInfo} className='space-y-5'>
          <div className='space-y-2'>
            <Label htmlFor='acc-name'>Nama tampilan</Label>
            <Input id='acc-name' className='h-11' value={info.name} onChange={(e) => setInfo((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='acc-username'>Username</Label>
            <Input
              id='acc-username'
              className='h-11'
              autoComplete='username'
              value={info.username}
              onChange={(e) => setInfo((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='acc-email'>Email</Label>
            <Input
              id='acc-email'
              type='email'
              className='h-11'
              value={info.email}
              onChange={(e) => setInfo((f) => ({ ...f, email: e.target.value }))}
            />
            <p className='text-muted-foreground text-xs'>Notifikasi HRIS dikirim ke email ini.</p>
          </div>
          <div className='flex justify-end'>
            <Button type='submit' className='h-11 px-5' disabled={!infoChanged || savingInfo || !info.username.trim() || !info.email.trim()}>
              {savingInfo && <Icons.spinner className='size-4 animate-spin' />}
              {savingInfo ? 'Menyimpan...' : 'Simpan perubahan'}
            </Button>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard title='Ubah password' text='Masukkan password saat ini untuk memastikan ini benar Anda.'>
        <form onSubmit={savePassword} className='space-y-5'>
          <div className='space-y-2'>
            <Label htmlFor='pw-current'>Password saat ini</Label>
            <Input
              id='pw-current'
              type={pwType}
              className='h-11'
              autoComplete='current-password'
              value={pw.current}
              onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pw-new'>Password baru</Label>
            <Input
              id='pw-new'
              type={pwType}
              className='h-11'
              autoComplete='new-password'
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
            />
            <div className='grid grid-cols-4 gap-1.5 pt-1' aria-hidden>
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={cn('h-1.5 rounded-full', i <= score ? STRENGTH[score].bar : 'bg-muted')} />
              ))}
            </div>
            <p className='text-muted-foreground text-sm' aria-live='polite'>
              {STRENGTH[score].label}
            </p>
            <div className='grid gap-2 sm:grid-cols-3'>
              <Rule ok={longEnough}>Minimal 8 karakter</Rule>
              <Rule ok={lettersDigits}>Huruf dan angka (disarankan)</Rule>
              <Rule ok={longEnough && notCommon}>Bukan password umum</Rule>
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='pw-confirm'>Ulangi password baru</Label>
            <Input
              id='pw-confirm'
              type={pwType}
              className='h-11'
              autoComplete='new-password'
              aria-invalid={mismatch}
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
            />
            {mismatch && <p className='text-destructive text-sm'>Password baru tidak sama.</p>}
          </div>
          <label className='flex w-fit items-center gap-2 text-sm'>
            <input type='checkbox' className='size-4' checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
            Tampilkan password
          </label>
          <div className='flex justify-end'>
            <Button type='submit' className='h-11 px-5' disabled={!canSavePw || savingPw}>
              {savingPw && <Icons.spinner className='size-4 animate-spin' />}
              {savingPw ? 'Menyimpan...' : 'Perbarui password'}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </div>
  );
}
