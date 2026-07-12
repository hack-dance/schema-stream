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
  const publicRoutes: MetadataRoute.Sitemap = [
    { path: "/", priority: 1 },
    { path: "/approach", priority: 0.8 },
    { path: "/examples", priority: 0.8 },
    { path: "/playground", priority: 0.8 }
  ].map(route => ({
    changeFrequency: "weekly",
    priority: route.priority,
    url: getCanonicalUrl(route.path)
  }))

  return [...publicRoutes, ...docs]
}
