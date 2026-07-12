import type { MetadataRoute } from "next"
import { DESCRIPTION } from "../lib/site"

/** Describes Schema Stream when the documentation site is installed from a browser. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    categories: ["developer", "documentation", "utilities"],
    description: DESCRIPTION,
    display: "standalone",
    id: "/",
    icons: [{ sizes: "64x64", src: "/icon", type: "image/png" }],
    lang: "en",
    name: "Schema Stream",
    scope: "/",
    short_name: "Schema Stream",
    start_url: "/",
    theme_color: "#ffffff"
  }
}
