import { Metadata } from 'next';
import { TalentProfilePage } from '@/features/recruitment/talent-profile-page';

export const metadata: Metadata = {
  title: 'Profil Talent Pool'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TalentProfilePage id={id} />;
}
