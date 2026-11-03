import type { MetadataRoute } from "next";

// PWA / ホーム画面追加用
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ビンゴ大会",
    short_name: "ビンゴ",
    start_url: "/",
    display: "standalone",
    background_color: "#FFF6E9",
    theme_color: "#E8452C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
