import localFont from "next/font/local";

/**
 * Self-hosted fonts via next/font: preloaded, with size-adjusted fallbacks so text doesn't shift or
 * re-render late when the web font arrives. Latin subset covers English, Spanish, Portuguese, French, Haitian Creole.
 *
 * Body: Atkinson Hyperlegible Next, drawn by the Braille Institute for low-vision readers. Many people reading
 * TrialBridge are in treatment, tired, or reading on a small phone; legibility comes first.
 * Display: Anybody, a variable face with a 50–150% width axis. Headlines are set condensed, and the width
 * axis is what moves when a person interacts with type (see .tb-stretch and the footer wordmark).
 */
export const atkinson = localFont({
  src: "../node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2",
  variable: "--font-atkinson",
  weight: "200 800",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const anybody = localFont({
  src: "../node_modules/@fontsource-variable/anybody/files/anybody-latin-standard-normal.woff2",
  variable: "--font-anybody",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "50% 150%" }],
  fallback: ["Arial Narrow", "ui-sans-serif", "system-ui", "sans-serif"],
});
