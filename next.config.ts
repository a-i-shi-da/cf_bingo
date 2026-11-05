import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // 本番の URL はリポジトリに書かず、ビルド時に .env.production.local の SITE_URL から埋め込む（docs/operations.md）
  env: { SITE_URL: process.env.SITE_URL ?? "" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// next dev でも Cloudflare のバインディング（env）を使えるようにする
initOpenNextCloudflareForDev();
