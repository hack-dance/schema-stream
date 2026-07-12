import { resolve } from "node:path"
import { createMDX } from "fumadocs-mdx/next"

/** @type {import("next").NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  redirects() {
    return Promise.resolve([
      {
        destination: "/docs/changelog",
        permanent: true,
        source: "/changelog"
      },
      {
        destination: "https://schema.stream/:path*",
        has: [{ type: "host", value: "www.schema.stream" }],
        permanent: true,
        source: "/:path*"
      }
    ])
  },
  webpack(webpackConfig) {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      "schema-stream": resolve(import.meta.dirname, "../dist/index.mjs")
    }
    return webpackConfig
  }
}

const withMDX = createMDX()

export default withMDX(config)
