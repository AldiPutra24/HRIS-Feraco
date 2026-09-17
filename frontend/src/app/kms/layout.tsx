import { ProtectedRoute } from '@/components/auth/protected-route';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'Knowledge Management',
  description: 'Pusat knowledge & informasi internal FERACO',
  robots: {
    index: false,
    follow: false
  }
};

export default async function KmsLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  return (
    <ProtectedRoute>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          <Header />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
