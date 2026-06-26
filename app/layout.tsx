import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import './globals.css';
import { Nav } from './components/Nav';
import { ServiceWorker } from './components/ServiceWorker';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Domestique — Tourspillet 2026',
  description: 'Maximise your Holdet.dk team value growth across all 21 Tour de France 2026 stages. Offline-first PWA.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Domestique' },
};

export const viewport: Viewport = {
  themeColor: '#0a0c0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        <ServiceWorker />
        <div className="min-h-screen">
          <Nav />
          <main className="mx-auto max-w-6xl animate-fade-up px-4 pb-24 pt-6 sm:px-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
