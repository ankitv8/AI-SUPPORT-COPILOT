'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function LoginPage() {
  const [register, setRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [configurationError, setConfigurationError] = useState('')

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not verify account service availability.')
        const payload = await response.json()
        if (!payload.configured) {
          setConfigurationError('Authentication is required. Configure DATABASE_URL to enable account access.')
        } else if (payload.user) {
          window.location.replace('/chat')
        }
      })
      .catch(() => setConfigurationError('Could not reach the account service. Check the database connection and try again.'))
  }, [])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Authentication failed.')
      window.location.href = '/chat'
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <form onSubmit={submit} className="w-full space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{register ? 'Create account' : 'Sign in'}</h1>
          <p className="mt-1 text-sm text-zinc-500">Your documents are private to your account.</p>
        </div>
        {configurationError && <p role="alert" className="text-sm text-amber-700">{configurationError}</p>}
        <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" type="email" required placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" type="password" required minLength={8} placeholder="Password (8+ characters)" value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>{busy ? 'Please wait...' : register ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="w-full text-sm text-zinc-500 underline" onClick={() => setRegister((value) => !value)}>{register ? 'Already have an account? Sign in' : 'Need an account? Register'}</button>
        <Link className="block text-center text-sm text-zinc-500 underline" href="/">Back home</Link>
      </form>
    </main>
  )
}