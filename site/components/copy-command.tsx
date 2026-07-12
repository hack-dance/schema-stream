"use client"

import { track } from "@vercel/analytics"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useCallback, useState } from "react"

interface CopyCommandProps {
  command: string
}

export function CopyCommand({ command }: CopyCommandProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (): Promise<void> => {
    await navigator.clipboard.writeText(command)
    track("copy_install_command")
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }, [command])

  return (
    <div className="copy-command">
      <code>{command}</code>
      <button
        aria-label="Copy install command"
        onClick={copy}
        title="Copy install command"
        type="button"
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </button>
    </div>
  )
}
