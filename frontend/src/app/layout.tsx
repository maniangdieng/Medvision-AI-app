import type { Metadata } from 'next';
import { ConfirmationProvider } from '@/components/Confirmation';
import { ToastProvider } from '@/components/Toasts';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedVision',
  description: 'Aide au compte rendu radiologique',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body><AuthProvider><ToastProvider><ConfirmationProvider>{children}</ConfirmationProvider></ToastProvider></AuthProvider></body>
    </html>
  );
}
