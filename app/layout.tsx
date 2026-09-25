import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WaveBackdrop } from "@/components/WaveBackdrop";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Navo",
  description: "Turn what's due into what to do today.",
  // Home-screen install (#39): manifest + iOS standalone hints + touch icon.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Navo", statusBarStyle: "default" },
  icons: {
    icon: "/icon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// The browser-chrome color per scheme — the DEFAULT before the user's stored
// theme is known. These two hexes are the brand canvas (--bg light) and ink
// (--bg dark) tokens from app/globals.css — metadata can't read CSS variables,
// so raw hex is allowed here and in components/ThemeToggle.tsx (which rewrites
// these metas to follow data-theme) only. Keep both in sync with the tokens
// (and with public/manifest.webmanifest).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#161619" },
  ],
};

// Set the theme attribute before first paint so there's no flash of the wrong
// theme. Mirrors the Flowboard prototype's localStorage key.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('flowboard-theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="font-sans">
        <WaveBackdrop />
        {children}
      </body>
    </html>
  );
}
