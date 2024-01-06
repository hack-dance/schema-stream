import { Metadata } from "next"
import { notFound } from "next/navigation"

import { siteConfig } from "@/config/site"
import { getPostBySlug, getPosts } from "@/lib/posts"
import { PostBody } from "@/components/post-body"
import { ScrollArea } from "@/components/ui/scroll-area"

export async function generateStaticParams() {
  const posts = await getPosts()

  return posts.map(post => ({ slug: post.slug }))
}

export const generateMetadata = async ({
  params
}: {
  params: {
    slug: string
  }
}): Promise<Metadata> => {
  const post = await getPostBySlug(params.slug)

  return {
    title: post?.title,
    description: post?.description,
    alternates: {
      canonical: `${siteConfig.url}/${params.slug}`
    },
    openGraph: {
      images: [`/api/og?title=${post?.title}&description=${post?.description}`]
    }
  }
}

export default async function PostPage({
  params
}: {
  params: {
    slug: string
  }
}) {
  const post = await getPostBySlug(params.slug)
  if (!post) return { props: {} }

  if (!post) return notFound()

  return (
    <ScrollArea>
      <div className="md:container py-12 max-w-screen px-4 w-screen">
        <header className="mb-4">
          <h1 className="text-3xl font-blunt tracking-tight">{post.title}</h1>
          <p>{post.description}</p>

          <small className="text-xs mt-4 block py-4 border-y">Last updated: {post.date}</small>
        </header>

        <div className="w-full prose dark:prose-invert max-w-full">
          {post?.body && <PostBody>{post.body}</PostBody>}
        </div>
      </div>
    </ScrollArea>
  )
}
