import Link from "next/link"
import { SiteHeader } from "@/components/site-header"

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="not-found">
        <p className="section-label">404</p>
        <h1>That snapshot is not here.</h1>
        <Link className="primary-link" href="/docs">
          Return to docs
        </Link>
      </main>
    </>
  )
}
