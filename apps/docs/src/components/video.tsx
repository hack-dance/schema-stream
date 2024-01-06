"use client"

import MuxPlayer from "@mux/mux-player-react"

import { cn } from "@/lib/utils"

export const Video = ({ className, ...props }: React.ComponentProps<typeof MuxPlayer>) => (
  <MuxPlayer className={cn("rounded-md", className)} {...props} />
)
