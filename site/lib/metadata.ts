import type { Metadata } from "next"
import { DESCRIPTION, SITE_URL } from "./site"

const socialImage = {
  alt: "Schema Stream - typed JSON, while it streams",
  height: 630,
  url: `${SITE_URL}/opengraph-image`,
  width: 1200
}

interface RouteMetadataOptions {
  description?: string
  path: string
  title: string
}

/** Builds canonical and social metadata for a public site route. */
export function createRouteMetadata({
  description = DESCRIPTION,
  path,
  title
}: RouteMetadataOptions): Metadata {
  const url = new URL(path, SITE_URL).href

  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      description,
      images: [socialImage],
      siteName: "schema-stream",
      title,
      type: "website",
      url
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: [socialImage],
      title
    }
  }
}
