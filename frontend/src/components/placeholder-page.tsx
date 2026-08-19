import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function PlaceholderPage({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>{title}</h2>
        <p className='text-muted-foreground text-sm'>{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Modul dalam pengembangan</CardTitle>
          <CardDescription>
            Halaman ini adalah placeholder. Fungsionalitas akan ditambahkan pada iterasi berikutnya.
          </CardDescription>
        </CardHeader>
        <CardContent className='text-muted-foreground text-sm'>
          Struktur route dan navigasi sudah siap untuk pengembangan modul {title}.
        </CardContent>
      </Card>
    </div>
  );
}
