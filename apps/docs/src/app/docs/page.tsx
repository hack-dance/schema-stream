import Link from "next/link"

import { getPosts } from "@/lib/posts"
import { ScrollArea } from "@/components/ui/scroll-area"

export default async function Page() {
  const posts = await getPosts()

  return (
    <div className="w-full h-full">
      <div className="flex items-start flex-1 h-[calc(100dvh-64px)]">
        <aside className="border-r bg-background h-full">
          <ul className="">
            {posts.map(post => (
              <li
                key={post?.slug}
                className="border-b last:border-none p-4 bg-background hover:bg-accent/50 transition-all duration-200 cursor-pointer"
              >
                <Link href={`/docs/${post?.slug}`}>
                  <>
                    <h3 className="text-sm font-okineMedium uppercase tracking-tight">
                      {post?.title}
                    </h3>
                  </>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <ScrollArea className="flex-1 h-[calc(100dvh-64px)] w-full">
          <main className="flex-1 h-full w-full"></main>
        </ScrollArea>
      </div>
    </div>
  )
}
