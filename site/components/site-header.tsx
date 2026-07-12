import { GitForkIcon, MenuIcon, PackageIcon } from "lucide-react"
import Link from "next/link"
import { GITHUB_URL, NPM_URL, primaryNavigation } from "@/lib/site"

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/">
          <span aria-hidden="true" className="brand-mark">
            {"{}"}
          </span>
          <span>schema-stream</span>
        </Link>

        <nav aria-label="Primary" className="desktop-nav">
          {primaryNavigation.map(item => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="site-actions">
          <a aria-label="schema-stream on npm" href={NPM_URL} rel="noreferrer" target="_blank">
            <PackageIcon aria-hidden="true" />
          </a>
          <a
            aria-label="schema-stream on GitHub"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <GitForkIcon aria-hidden="true" />
          </a>
        </div>

        <details className="mobile-nav">
          <summary aria-label="Open navigation">
            <MenuIcon aria-hidden="true" />
          </summary>
          <nav aria-label="Mobile primary">
            {primaryNavigation.map(item => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <a href={GITHUB_URL} rel="noreferrer" target="_blank">
              GitHub
            </a>
            <a href={NPM_URL} rel="noreferrer" target="_blank">
              npm
            </a>
          </nav>
        </details>
      </div>
    </header>
  )
}
