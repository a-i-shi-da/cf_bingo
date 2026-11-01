import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 画面はほぼすべて動的（リアルタイム）なので、増分キャッシュ（R2 など）は使わない
export default defineCloudflareConfig({});
