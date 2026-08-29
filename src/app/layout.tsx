import type { Metadata } from "next";
// Self-hosted fonts — see the comment at the top of globals.css for why these replaced
// next/font/google. IBM Plex Sans is a fixed-weight family, so each weight this app actually
// uses (400 body, 500 medium labels, 600 semibold buttons/emphasis) is imported individually
// to keep the bundle from including unused weights. Fraunces is imported as one variable-font
// file that covers its full weight range, including the 600/700 .page-title uses.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource-variable/fraunces";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTC HR Portal",
  description: "Talented Teen Club — internal HR portal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
