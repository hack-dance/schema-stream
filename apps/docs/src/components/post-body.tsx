import React from "react"
import { MDXRemote } from "next-mdx-remote/rsc"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeHighlight from "rehype-highlight"
import rehypeShikiji from "rehype-shikiji"
import rehypeSlug from "rehype-slug"
import remarkFrontmatter from "remark-frontmatter"
import remarkGfm from "remark-gfm"
import remarkToc from "remark-toc"

import codeTheme from "@/lib/code-theme.json"

import { customComponents } from "./mdx-components"

export async function PostBody({ children }) {
  return (
    <MDXRemote
      source={children}
      options={{
        mdxOptions: {
          remarkPlugins: [
            remarkGfm,
            remarkFrontmatter,
            [
              remarkToc,
              {
                tight: true,
                maxDepth: 5
              }
            ]
          ],
          rehypePlugins: [
            rehypeSlug,
            rehypeAutolinkHeadings,
            rehypeHighlight,
            [
              //@ts-ignore
              rehypeShikiji,
              {
                themes: {
                  light: codeTheme,
                  dark: codeTheme
                }
              }
            ]
          ]
        }
      }}
      components={customComponents}
    ></MDXRemote>
  )
}
