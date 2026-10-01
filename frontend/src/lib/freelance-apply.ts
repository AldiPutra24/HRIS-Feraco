import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/recruitment/public/freelance`;

export type FreelancePosition = {
  id: number;
  title: string;
  position_text: string;
  location: string;
};

// No credentials / CSRF needed: these endpoints are session-less and public.
export function listFreelancePositions(): Promise<FreelancePosition[]> {
  return fetch(`${BASE}/positions/`).then(async (res) => {
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json() as Promise<FreelancePosition[]>;
  });
}

export async function submitFreelanceApplication(form: {
  full_name: string;
  phone: string;
  email: string;
  domicile: string;
  position_ids: number[];
  portfolio_url: string;
  expected_rate: string;
  notes: string;
  cv: File | null;
}): Promise<void> {
  const fd = new FormData();
  fd.append('full_name', form.full_name);
  fd.append('phone', form.phone);
  fd.append('email', form.email);
  fd.append('domicile', form.domicile);
  fd.append('position_ids', form.position_ids.join(','));
  fd.append('portfolio_url', form.portfolio_url);
  fd.append('expected_rate', form.expected_rate);
  fd.append('notes', form.notes);
  if (form.cv) fd.append('cv', form.cv);
  const res = await fetch(`${BASE}/apply/`, { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const d = data as Record<string, unknown>;
    let msg = typeof d.detail === 'string' ? d.detail : `Gagal mengirim lamaran (${res.status}).`;
    if (d.cv) msg = `CV: ${(d.cv as string[]).join(' ')}`;
    else if (d.position_ids) msg = (d.position_ids as string[]).join(' ');
    else if (d.phone) msg = String((d.phone as string[])[0] ?? d.phone);
    throw new Error(msg);
  }
}
