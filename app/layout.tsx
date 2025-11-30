import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nordic Scout',
  description: 'Advanced Fantasy Hockey Screener',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
