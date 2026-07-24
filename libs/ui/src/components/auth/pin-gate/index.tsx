'use client'

import { useState } from 'react'
import { useAuth } from '@lmthing/auth'

import '@lmthing/css/components/auth/index.css'
import '@lmthing/css/elements/forms/button/index.css'
import * as Prim from '@lmthing/ui/elements/primitives'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

export function PinGate({ children }: { children: React.ReactNode }) {
  const { needsPin, pinUnlocked, unlockPin } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!needsPin || pinUnlocked) {
    return <>{children}</>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const valid = await unlockPin(pin)
      if (!valid) {
        setError('Incorrect PIN')
        setPin('')
      }
    } catch {
      setError('Failed to verify PIN')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Prim.Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" padding="$4">
      <Prim.Box display="flex" flexDirection="column" width="100%" maxWidth={360} gap="$8">
        <Prim.Box textAlign="center">
          <Prim.Text as="h1" fontSize={28} fontWeight="$bold" letterSpacing={'-0.02em' as unknown as number} margin={0}>
            <CozyThingText text="lmthing" />
          </Prim.Text>
          <Prim.Text block fontSize="$sm" opacity={0.6} marginTop="$1">
            Enter your PIN to unlock
          </Prim.Text>
        </Prim.Box>

        {error && (
          <p style={{ color: 'var(--color-destructive)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="Enter your PIN"
            required
            minLength={4}
            autoFocus
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-background)',
              fontSize: '0.875rem',
              textAlign: 'center',
              letterSpacing: '0.25em',
            }}
          />
          <Prim.Pressable
            type="submit"
            disabled={loading}
            className="btn btn--primary"
            width="100%"
            marginTop="$1"
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </Prim.Pressable>
        </form>
      </Prim.Box>
    </Prim.Box>
  )
}
