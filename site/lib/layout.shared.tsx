import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { GitForkIcon, PackageIcon } from "lucide-react"
import { GITHUB_URL, NPM_URL } from "@/lib/site"

/** Keeps the docs chrome aligned with the compact public-site navigation. */
export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: GITHUB_URL,
    links: [
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
      title: (
        <span className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">
            {"{}"}
          </span>
          schema-stream
        </span>
      ),
      url: "/"
    }
  }
}
