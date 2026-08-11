import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seen — Saved isn\'t done.',
  description: 'Turns the pile of things you saved into drafts you can actually send.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
