import { redirect } from 'next/navigation';

// Retired public form: each form became Job Freelance `portal-<slug>`.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/jobs/portal-${slug}`);
}
