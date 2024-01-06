export type SiteConfig = typeof siteConfig

export const siteConfig = {
  name: "App docs",
  url: "https://hack.dance",
  description: "",
  links: {},
  mainNav: [
    {
      label: "blog",
      url: "/blog"
    },
    {
      label: "GH",
      url: "https://hack.dance",
      external: true
    }
  ]
}
