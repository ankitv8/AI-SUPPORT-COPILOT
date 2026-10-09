'use client'

import { useEffect, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import SupportCopilot from './SupportCopilot'

export default function ChatExperience() {
  const configureDemo = useChatStore((s) => s.configureDemo)
  const [accountReady, setAccountReady] = useState(false)
  const [accountError, setAccountError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Account service is temporarily unavailable.')
        const payload = await response.json()
        if (!payload.user) {
          window.location.replace('/login?next=/chat')
          return
        }
        if (active) {
          configureDemo(payload.user.id)
          setAccountReady(true)
        }
      })
      .catch((error) => {
        if (active) setAccountError(error.message)
      })

    return () => {
      active = false
    }
  }, [configureDemo])

  if (accountError) {
    return <p className="p-6 text-sm text-red-600">{accountError}</p>
  }
  if (!accountReady) {
    return <p className="p-6 text-sm text-zinc-500">Loading your account…</p>
  }
  return <SupportCopilot />
}
