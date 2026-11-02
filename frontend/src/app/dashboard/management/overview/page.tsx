import { redirect } from 'next/navigation';

// Old URL: the Management/GM overview now lives at /dashboard/management.
export default function Page() {
  redirect('/dashboard/management');
}
