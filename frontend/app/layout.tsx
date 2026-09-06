import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prism - Analytics Intelligence',
  description: 'Ask your data a question.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 font-sans text-paper antialiased">{children}</body>
    </html>
  );
}
