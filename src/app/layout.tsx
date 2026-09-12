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
    // h-full (not the old min-h-full) — CB, Sept 2026, reporting a still-broken "long black
    // popup" and left nav scrolling away with the calendar on Availability specifically: this
    // is the actual root cause, several layers up from anything on the Availability page
    // itself. `min-height: 100%` lets body grow TALLER than the viewport to fit its content,
    // which is exactly right for a short page like /login — but it also means body's own
    // height is INDEFINITE (content-driven) rather than a fixed value. The (portal) layout's
    // whole "only main scrolls, RoleNav and the header stay put" scheme (see that layout's own
    // doc comment) depends on its outer row's `md:h-screen` resolving to a real, definite
    // 100vh — and a flex item's `flex: 1 1 0%` (Tailwind's `flex-1`, used on that row) only
    // lets an explicit height like `h-screen` win when the flex CONTAINER (body) itself has a
    // definite size to distribute. With an indefinite (min-height-only) body, browsers fall
    // back to sizing that row by ITS OWN CONTENT instead — invisible on every other portal
    // page, whose content happens to fit close to one viewport, but Availability's calendar
    // (up to 10 months of grids) is dramatically taller, exposing it: the row grew to match
    // that content instead of clamping to 100vh, `overflow-hidden` had nothing left to clip,
    // and the whole document scrolled as one piece — taking RoleNav with it, and stretching
    // the calendar's `md:h-full` side panel into the long black rectangle CB kept seeing.
    // `h-full` gives body a genuinely definite height (100% of `html`, which is itself already
    // a definite `h-full` against the viewport), which is what an `md:h-screen` flex row
    // actually needs to hold its own height regardless of how tall the page it contains gets.
    // Verified against a static reproduction of this exact class chain with ~10 months of
    // dummy calendar content: with min-h-full the whole document scrolled and the side panel
    // stretched to match; with h-full only the calendar's own column scrolled, and RoleNav,
    // the header, and the panel all stayed exactly in place — confirmed safe for the short
    // pages outside (portal) too (login, forgot/reset password), since a fixed-height body
    // with overflow: visible (the default — nothing here sets overflow: hidden on body) still
    // lets the document scroll normally if a future page's content ever exceeds one viewport.
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
