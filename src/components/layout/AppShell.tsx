'use client';

import { AmbientBackground } from '@/components/layout/AmbientBackground';
import { CookieConsent } from '@/components/layout/CookieConsent';
import { FloatingWhatsApp } from '@/components/layout/FloatingWhatsApp';
import { Footer } from '@/components/layout/Footer';
import { MaintenanceScreen } from '@/components/layout/MaintenanceScreen';
import { Navbar } from '@/components/layout/Navbar';
import { ScrollProgressBar } from '@/components/layout/ScrollProgressBar';
import { Toaster } from '@/components/ui/toaster';
import { useSiteConfig } from '@/hooks/useSiteConfig';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { siteConfig, loading } = useSiteConfig();

  const isAdminRoute = pathname?.startsWith('/admin');
  const shouldShowMaintenance = !isAdminRoute && !!siteConfig.maintenanceMode;
  const shouldHoldPublicRender = !isAdminRoute && loading;

  if (shouldHoldPublicRender) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-accent-border)] border-t-[var(--color-accent-val)]" />
      </div>
    );
  }

  if (shouldShowMaintenance) {
    return (
      <>
        <MaintenanceScreen />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <AmbientBackground />
      <ScrollProgressBar />
      <Navbar />
      <main className="flex-1 pt-20">
        {children}
      </main>
      <Footer />
      <FloatingWhatsApp />
      <CookieConsent />
      <Toaster />
    </>
  );
}
