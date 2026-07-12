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
  }
}

const withMDX = createMDX()

export default withMDX(config)
