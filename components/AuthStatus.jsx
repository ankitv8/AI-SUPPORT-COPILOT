'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useChatStore } from '../stores/chatStore'

export default function AuthStatus({ compact = false, redirectWhenUnauthenticated = false }) {
  const clearAccountSession = useChatStore((store) => store.clearAccountSession)
  const [state, setState] = useState({ loading: true, configured: false, user: null })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Account service unavailable')
        const payload = await response.json()
        if (!active) return
        setState({
          loading: false,
          configured: payload.configured === true,
          user: payload.user || null,
          unavailable: false,
        })
        if (!payload.user && redirectWhenUnauthenticated) {
          window.location.replace('/login?next=/chat')
        }
      })
      .catch(() => {
        if (active) {
          setState({ loading: false, configured: true, user: null, unavailable: true })
        }
      })

    return () => {
      active = false
    }
  }, [redirectWhenUnauthenticated])

  async function logout() {
    clearAccountSession()
    try {
      const response = await fetch('/api/auth/me', { method: 'DELETE', credentials: 'include' })
      if (!response.ok) console.error('[auth] logout request failed', response.status)
    } catch (error) {
      console.error('[auth] logout request failed', error)
    } finally {
      window.location.replace('/login')
    }
  }

  if (state.loading) {
    return compact ? null : <p className="mb-3 text-[10px] text-zinc-400">Checking account...</p>
  }

  if (!state.configured) {
    if (compact) {
      return (
        <Link
          href="/login"
          className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark"
        >
          Sign in
        </Link>
      )
    }
    return (
      <p className="mb-3 text-[10px] text-amber-700 dark:text-amber-400">
        Account access is unavailable. Configure the database connection.
      </p>
    )
  }

  if (state.unavailable) {
    return compact
      ? <p className="text-[10px] text-amber-600 dark:text-amber-400">Account service unavailable</p>
      : <p className="mb-3 text-[10px] text-amber-700 dark:text-amber-400">Could not verify your account. Check the database connection and retry.</p>
  }

  if (compact) {
    if (!state.user) {
      return (
        <Link
          href="/login"
          className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark"
        >
          Sign in
        </Link>
      )
    }
    const initial = state.user?.email?.[0]?.toUpperCase() || '?'
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white shadow-sm ring-offset-2 transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-brand/50"
          aria-label="Open account menu"
          title={state.user?.email}
        >
          {initial}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="truncate px-2 py-1 text-xs text-zinc-600 dark:text-zinc-300">{state.user?.email}</p>
            <button
              type="button"
              onClick={logout}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-brand hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Log out
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Signed in</p>
        <p className="truncate text-xs text-zinc-700 dark:text-zinc-200">{state.user?.email}</p>
      </div>
      <button type="button" onClick={logout} className="shrink-0 text-[10px] font-medium text-brand hover:underline">
        Log out
      </button>
    </div>
  )
}
