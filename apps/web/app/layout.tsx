import type { Metadata } from 'next';
import './globals.css';
import { SiteShell } from '../components/site-shell';

export const metadata: Metadata = {
  title: 'GORKH',
  description: 'Desktop intelligence layer for local-first operator workflows',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
