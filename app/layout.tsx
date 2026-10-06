import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./personal.css";
import "./house.css";
import "./onboarding.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NestSplit",
  description: "Personal and shared home finances in one place.",
  applicationName: "NestSplit",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NestSplit" },
  formatDetection: { telephone: false },
};

// themeColor lives on the viewport export (not metadata) in this Next fork.
// Media-based values let the browser chrome follow the OS scheme for users on
// the default "system" theme; explicit in-app overrides drive the DOM instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdf9" },
    { media: "(prefers-color-scheme: dark)", color: "#151d18" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const serviceWorkerScript = process.env.NODE_ENV === "production"
    ? "if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));"
    : "if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));";

  // Runs synchronously before first paint to set the chosen theme with no
  // flash. Only explicit "dark"/"light" choices set data-theme; "system"
  // (unset) falls through to the @media(prefers-color-scheme) block in CSS.
  const themeInitScript =
    "try{var t=localStorage.getItem('ns-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
        <script dangerouslySetInnerHTML={{ __html: serviceWorkerScript }} />
      </body>
    </html>
  );
}
