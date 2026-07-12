import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { GitForkIcon, PackageIcon, PlayIcon } from "lucide-react"
import { GITHUB_URL, NPM_URL } from "@/lib/site"

/** Keeps the docs chrome aligned with the compact public-site navigation. */
export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: GITHUB_URL,
    links: [
      {
        icon: <PlayIcon aria-hidden="true" />,
        text: "Playground",
        url: "/playground"
      },
      {
        external: true,
        icon: <PackageIcon aria-hidden="true" />,
        text: "npm",
        url: NPM_URL
      },
      {
        external: true,
        icon: <GitForkIcon aria-hidden="true" />,
        text: "GitHub",
        url: GITHUB_URL
      }
    ],
    nav: {
      title: <span className="brand-lockup">schema-stream</span>,
      url: "/"
    }
  }
}
