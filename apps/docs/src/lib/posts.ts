import fs from "fs/promises"
import path from "path"
import type { Post } from "@/types"
import matter from "gray-matter"

export const getPosts = async () => {
  const posts = await fs.readdir(process.cwd() + "/src/posts")
  return await Promise.all(
    posts
      .filter(file => path.extname(file) === ".md" || path.extname(file) === ".mdx")
      .map(async file => {
        const filePath = `${process.cwd()}/src/posts/${file}`

        const postContent = await fs.readFile(filePath, "utf8")
        const { data, content } = matter(postContent)

        if (data.published !== true) return null

        return { id: file.split(".")[0], ...data, body: content } as Post
      })
  ).then(posts =>
    posts
      .filter(post => post !== null)
      .sort((a, b) => Number(new Date(b.date)) - Number(new Date(a.date)))
  )
}

export async function getAllPosts() {
  const posts = await getPosts()

  return posts.sort((a, b) => {
    return Number(new Date(b.date)) - Number(new Date(a.date))
  })
}

export async function getPostBySlug(slug: string) {
  const posts = await getPosts()

  return posts.find(post => post.slug === slug)
}
