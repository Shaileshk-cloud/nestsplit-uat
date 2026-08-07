import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NestSplit",
    short_name: "NestSplit",
    description: "Personal and shared home finances in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fffdf9",
    theme_color: "#244c39",
    icons: [
      // 192×192 — minimum required for Chrome installability
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      // 512×512 — required for splash screen
      {
        src: "/icon2",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // 512×512 maskable — Android adaptive icon (full-bleed safe-zone logo)
      {
        src: "/icon3",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
