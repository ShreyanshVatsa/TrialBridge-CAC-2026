import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** Web app manifest (installable PWA). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TrialBridge",
    short_name: "TrialBridge",
    description: "Find cancer clinical trials that fit you, in minutes, privately.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4fb",
    theme_color: "#4b32c3",
    categories: ["health", "medical"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [{ name: "Find a trial", url: "/find/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
