import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from './providers';
import { Splash } from '@/components/splash';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'],
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Clasp — Sell anywhere, get paid safely',
  description:
    'The payment trust layer for Pi commerce. Clasp holds your payment in escrow and releases it only when delivery is confirmed.',
  applicationName: 'Clasp',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0A0F16',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>
        {/* Pi SDK — only meaningful inside Pi Browser */}
        <Script src="https://sdk.minepi.com/pi-sdk.js" strategy="afterInteractive" />
        <AuthProvider>
          <div className="shell">{children}</div>
          <Splash />
        </AuthProvider>
      </body>
    </html>
  );
}
