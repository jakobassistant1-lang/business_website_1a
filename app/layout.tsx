import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WaveBackdrop } from "@/components/WaveBackdrop";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "StudyPlan",
  description: "Turn what's due into what to do today.",
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
