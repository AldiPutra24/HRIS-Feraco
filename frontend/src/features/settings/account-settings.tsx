'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { getSelfAccount } from '@/lib/auth/auth-client';
import { useAuth } from '@/lib/auth/auth-provider';

export function AccountSettings() {
  const { user, updateAccount } = useAuth();
  const [form, setForm] = useState({
    username: '',
    email: '',
    name: '',
    password: '',
    current_password: ''
  });
  const [saving, setSaving] = useState(false);
  // Original first/last name: an unchanged "Nama" is sent back as-is so a
  // password-only change never rewrites the user's name fields.
  const [original, setOriginal] = useState({ name: '', first_name: '', last_name: '' });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getSelfAccount()
      .then((acc) => {
        if (cancelled) return;
        const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ');
        setOriginal({ name, first_name: acc.first_name, last_name: acc.last_name });
        setForm((f) => ({ ...f, username: acc.username, email: acc.email, name }));
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Gagal memuat data akun.'));
    return () => {
      cancelled = true;
    };
    // Load once per logged-in user; later `user` refreshes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password && !form.current_password) {
      toast.error('Isi password saat ini untuk mengganti password.');
      return;
    }
    const nameChanged = form.name.trim() !== original.name;
    setSaving(true);
    try {
      await updateAccount({
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: nameChanged ? form.name.trim() : original.first_name,
        last_name: nameChanged ? '' : original.last_name,
        ...(form.password ? { password: form.password, current_password: form.current_password } : {})
      });
      if (nameChanged) setOriginal({ name: form.name.trim(), first_name: form.name.trim(), last_name: '' });
      setForm((f) => ({ ...f, password: '', current_password: '' }));
      toast.success('Akun diperbarui.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui akun.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Account</h2>
        <p className='text-muted-foreground text-sm'>Perbarui username, email, nama, dan password akun Anda.</p>
      </div>

      <Card className='w-full'>
        <CardHeader>
          <CardTitle>Profil Akun</CardTitle>
          <CardDescription>Role: {user?.role ?? '-'}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className='space-y-4'>
            <div className='space-y-1.5'>
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </div>
            <div className='space-y-1.5'>
              <Label>Email</Label>
              <Input type='email' value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className='space-y-1.5'>
              <Label>Nama</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div className='border-slate-200 space-y-4 border-t pt-4'>
              <div className='space-y-1.5'>
                <Label>Password Baru</Label>
                <Input
                  type='password'
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder='Kosongkan jika tidak diubah'
                />
                <p className='text-muted-foreground text-xs'>Minimal 8 karakter, hindari password umum seperti "password" atau "12345678".</p>
              </div>
              <div className='space-y-1.5'>
                <Label>Password Saat Ini</Label>
                <Input
                  type='password'
                  value={form.current_password}
                  onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
                  placeholder='Wajib jika mengubah password'
                />
              </div>
            </div>

            <div className='flex justify-end'>
              <Button type='submit' disabled={saving}>
                {saving ? <Icons.spinner className='mr-2 h-4 w-4 animate-spin' /> : null}
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
