import { useState, useEffect } from 'react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

// Credentials set during setup wizard — stored in localStorage
const VALID_EMAIL = localStorage.getItem('setup_admin_email') || ''
const VALID_HASH  = localStorage.getItem('setup_admin_hash')  || ''

// Session expiry: 7 days
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000

// Brute force protection
const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

async function sha256(text) {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getLoginAttempts() {
  try {
    const stored = localStorage.getItem('crm_login_attempts')
    if (!stored) return { count: 0, firstAttempt: null, lockedUntil: null }
    return JSON.parse(stored)
  } catch {
    return { count: 0, firstAttempt: null, lockedUntil: null }
  }
}

function recordFailedAttempt() {
  const attempts = getLoginAttempts()
  const now = Date.now()

  // Reset counter if the window has passed (15 min since first attempt)
  if (attempts.firstAttempt && now - attempts.firstAttempt > LOCKOUT_DURATION_MS) {
    const fresh = { count: 1, firstAttempt: now, lockedUntil: null }
    localStorage.setItem('crm_login_attempts', JSON.stringify(fresh))
    return fresh
  }

  const updated = {
    count: attempts.count + 1,
    firstAttempt: attempts.firstAttempt || now,
    lockedUntil: attempts.count + 1 >= MAX_ATTEMPTS ? now + LOCKOUT_DURATION_MS : null,
  }
  localStorage.setItem('crm_login_attempts', JSON.stringify(updated))
  return updated
}

function clearLoginAttempts() {
  localStorage.removeItem('crm_login_attempts')
}

export function createSession() {
  const session = {
    authenticated: true,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  }
  localStorage.setItem('crm_auth', JSON.stringify(session))
}

export function isSessionValid() {
  try {
    const stored = localStorage.getItem('crm_auth')
    if (!stored) return false
    // Backwards compat: old format was just 'true'
    if (stored === 'true') {
      // Migrate to new format
      createSession()
      return true
    }
    const session = JSON.parse(stored)
    if (!session.authenticated || !session.expiresAt) return false
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem('crm_auth')
      return false
    }
    return true
  } catch {
    localStorage.removeItem('crm_auth')
    return false
  }
}

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [lockRemaining, setLockRemaining] = useState(0)

  useEffect(() => {
    const attempts = getLoginAttempts()
    if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
      setLockRemaining(Math.ceil((attempts.lockedUntil - Date.now()) / 1000))
    }
  }, [])

  useEffect(() => {
    if (lockRemaining <= 0) return
    const timer = setInterval(() => {
      setLockRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [lockRemaining])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Check lockout
    const attempts = getLoginAttempts()
    if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
      const remaining = Math.ceil((attempts.lockedUntil - Date.now()) / 1000)
      setLockRemaining(remaining)
      setError(`החשבון נעול. נסה שוב בעוד ${Math.ceil(remaining / 60)} דקות.`)
      return
    }

    setLoading(true)

    try {
      const hash = await sha256(password)
      if (email.toLowerCase().trim() === VALID_EMAIL && hash === VALID_HASH) {
        clearLoginAttempts()
        createSession()
        onLogin()
      } else {
        const updated = recordFailedAttempt()
        if (updated.lockedUntil) {
          const lockSec = Math.ceil(LOCKOUT_DURATION_MS / 1000)
          setLockRemaining(lockSec)
          setError(`יותר מדי ניסיונות כושלים. החשבון נעול ל-${Math.ceil(lockSec / 60)} דקות.`)
        } else {
          const remaining = MAX_ATTEMPTS - updated.count
          setError(`שם משתמש או סיסמה שגויים (${remaining} ניסיונות נותרו)`)
        }
      }
    } catch {
      setError('שגיאה בהתחברות')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gold-600 mb-2">✨ ניהול הזמנות</h1>
          <p className="text-gray-500">התחבר כדי לנהל את האירועים שלך</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="אימייל"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="סיסמה"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg">
                ❌ {error}
              </div>
            )}

            <Button type="submit" disabled={loading || lockRemaining > 0} className="w-full" size="lg">
              {lockRemaining > 0
                ? `🔒 נעול (${Math.ceil(lockRemaining / 60)} דקות)`
                : loading ? 'מתחבר...' : '🔐 התחבר'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
