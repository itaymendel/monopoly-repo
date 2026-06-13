import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` is used by Astro for sitemap/canonical URLs and
// is baked into the build, so update it before publishing
// if the production domain changes.
export default defineConfig({
  site: "https://monopoly-repo.dev",
  integrations: [sitemap()],
});
