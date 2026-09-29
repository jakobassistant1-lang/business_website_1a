import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { WaveBackdrop } from "@/components/WaveBackdrop";
import { asTheme, THEME_COOKIE, THEME_HEX, themeBootstrapScript } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Navo",
  description: "Turn what’s due into what to do today.",
  // Home-screen install (#39): manifest + iOS standalone hints + touch icon.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Navo", statusBarStyle: "default" },
  icons: {
    icon: "/icon.svg",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// The media pair is only the DEFAULT before the user's theme is known; the
// bootstrap below repoints every theme-color meta at the chosen theme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_HEX.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_HEX.dark },
  ],
};

// Pre-paint theme bootstrap (cookie → legacy localStorage → light; see
// themeBootstrapScript in lib/theme.ts for the order and why). It also points
// every <meta name="theme-color"> at the chosen theme.
const themeBootstrap = themeBootstrapScript(THEME_HEX);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-render the stored theme so first paint is right even when JS or
  // storage is blocked. Reading cookies() makes this layout dynamic — every
  // page already is (force-dynamic or an auth/cookie read), so nothing changes.
  const cookieTheme = asTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={cookieTheme ?? "light"} suppressHydrationWarning className={inter.variable}>
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
