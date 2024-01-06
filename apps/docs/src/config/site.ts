export type SiteConfig = typeof siteConfig

export const siteConfig = {
  name: "App docs",
  url: "https://hack.dance",
  description: "",
  links: {},
  mainNav: [
    {
      label: "docs",
      url: "/docs"
    },
    {
      label: "hack dance",
      url: "https://hack.dance",
      external: true
    }
  ]
}
