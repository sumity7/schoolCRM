import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { DemoBanner } from '@/components/demo-banner';

export const metadata: Metadata = { title: 'EduNex ERP', description: 'School Management. Simplified.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DemoBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
