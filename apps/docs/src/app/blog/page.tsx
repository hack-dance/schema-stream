import Link from "next/link"

import { getPosts } from "@/lib/posts"
import { ScrollArea } from "@/components/ui/scroll-area"

export default async function Page() {
  const posts = await getPosts()

  return (
    <div className="w-full h-full">
      <ScrollArea className="flex-1 h-[calc(100dvh-64px)] w-full">
        <div className="container p-6">
          <ul className="w-full">
            {posts.map(post => (
              <li
                key={post?.slug}
                className="border-b last:border-none p-4 bg-background hover:bg-accent/50 transition-all duration-200 cursor-pointer"
              >
                <Link href={`/thoughts/${post?.slug}`}>
                  <>
                    <h3 className="text-3xl font-blunt tracking-tight">{post?.title}</h3>
                    <p className="leading-7">{post?.description}</p>
                    <small>Published on {post?.date}</small>
                  </>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
    </div>
  )
}
