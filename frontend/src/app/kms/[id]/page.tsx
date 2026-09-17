import { KmsArticleDetail } from '@/features/kms/kms-article-detail';

export const metadata = { title: 'Knowledge Management' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KmsArticleDetail id={Number(id)} />;
}
