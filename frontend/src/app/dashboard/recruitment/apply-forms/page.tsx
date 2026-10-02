import { redirect } from 'next/navigation';

// Apply forms were consolidated into Job Freelance.
export default function Page() {
  redirect('/dashboard/recruitment/jobs?type=FREELANCE');
}
