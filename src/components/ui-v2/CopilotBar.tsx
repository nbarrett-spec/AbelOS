'use client'

import { useEffect, useState } from 'react'

const PROMPTS = [
  'Why is lot 214 running over?',
  "Summarize Brookfield's open POs for framing",
  'Draft a follow-up to Abel on PO 4817',
  "What's our average delivery window at Mobberly?",
  'Which invoices age into 30+ days next week?',
]

/**
 * CopilotBar — Home-level prompt surface for Aegis Copilot v1.
 * Non-destructive: asks and answers; never takes action without approval.
 * See AEGIS_DESIGN_SYSTEM.md §5.7 + §16.1.
 */
export function CopilotBar({ onSubmit }: { onSubmit?: (q: string) => void }) {
  const [promptIdx, setPromptIdx] = useState(0)
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setInterval(() => setPromptIdx((i) => (i + 1) % PROMPTS.length), 4500)
    return () => clearInterval(t)
  }, [])

  return (
    <form
      className="v4-copilot"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim()) onSubmit?.(q.trim())
      }}
    >
      <input
        className="v4-copilot__input"
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Ask about your purchasing. e.g. "${PROMPTS[promptIdx]}"`}
        aria-label="Ask Aegis Copilot about your purchasing"
      />
      <kbd className="v4-copilot__kbd" aria-hidden>
        ⌘ /
      </kbd>
    </form>
  )
}

export default CopilotBar
