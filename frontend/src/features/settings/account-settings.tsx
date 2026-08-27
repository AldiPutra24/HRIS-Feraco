'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
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

  useEffect(() => {
    if (user) {
      setForm((f) => ({
        ...f,
        username: f.username || user.email,
        email: f.email || user.email,
        name: f.name || user.name
      }));
    }
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateAccount({
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.name.trim(),
        last_name: '',
        ...(form.password ? { password: form.password, current_password: form.current_password } : {})
      });
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
