import { redirect } from 'next/navigation';

export const metadata = { title: 'Recruitment' };

export default function Page() {
  redirect('/dashboard/recruitment/jobs');
}
