import type { MetadataRoute } from "next"
import { getCanonicalUrl } from "../lib/get-llm-text"
import { source } from "../lib/source"

/** Builds the human-facing sitemap directly from the generated Fumadocs page collection. */
export default function sitemap(): MetadataRoute.Sitemap {
  const docs: MetadataRoute.Sitemap = source.getPages().map(page => ({
    changeFrequency: "weekly",
    priority: page.url === "/docs" ? 0.9 : 0.7,
    url: getCanonicalUrl(page.url)
  }))

  return [
    {
      changeFrequency: "weekly",
      priority: 1,
      url: getCanonicalUrl("/")
    },
    ...docs
  ]
}
