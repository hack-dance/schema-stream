import type { MetadataRoute } from "next"
import { SITE_URL } from "../lib/site"

/** Publishes crawler policy for the canonical site while hiding only the internal rewrite path. */
export default function robots(): MetadataRoute.Robots {
  return {
    host: SITE_URL,
    rules: {
      allow: "/",
      disallow: "/llms.mdx/",
      userAgent: "*"
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  }
}
