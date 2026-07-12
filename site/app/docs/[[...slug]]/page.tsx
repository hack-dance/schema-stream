import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getMDXComponents } from "@/components/mdx"
import { source } from "@/lib/source"

interface DocsRouteProps {
  params: Promise<{ slug?: string[] }>
}

export default async function Page({ params }: DocsRouteProps) {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) {
    notFound()
  }

  const MDX = page.data.body

  return (
    <DocsPage full={page.data.full} tableOfContent={{ style: "clerk" }} toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.description ? <DocsDescription>{page.data.description}</DocsDescription> : null}
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateMetadata({ params }: DocsRouteProps): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug)

  if (!page) {
    notFound()
  }

  return {
    alternates: { canonical: page.url },
    description: page.data.description,
    openGraph: {
      description: page.data.description,
      title: page.data.title,
      url: page.url
    },
    title: page.data.title
  }
}

export function generateStaticParams(): Array<{ slug?: string[] }> {
  return source.generateParams()
}
