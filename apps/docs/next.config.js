/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    domains: ["i.ytimg.com", "/", "image.mux.com"]
  },
  pageExtensions: ["md", "tsx", "ts", "jsx", "js", "md", "mdx"],
  experimental: {
    mdxRs: false
  }
}

module.exports = nextConfig
