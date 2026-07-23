import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import PwaRegister from "./PwaRegister";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Plan personal budgets, shared bills and savings with fair, automatic splits.";

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Household Budget Planner",
      template: "%s · Household Budget Planner",
    },
    description,
    applicationName: "Household Budget Planner",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Budget Planner",
    },
    icons: {
      icon: [
        { url: "/favicon.ico" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      url: origin,
      title: "Household Budget Planner",
      description,
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "Household Budget Planner — Your money, made clear." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Household Budget Planner",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f5f1e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
