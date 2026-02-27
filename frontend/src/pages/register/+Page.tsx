import { useState, useEffect } from 'react'
import { api } from '../../api'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  // Theme colors
  const colors = darkMode ? {
    bg: '#21180d',
    card: '#2d2215',
    text: '#f1f7e1',
    textSecondary: '#bbb098',
    primary: '#c06642',
    primaryHover: '#d9774f',
    border: '#4a3a2a',
    error: '#d9534f',
  } : {
    bg: '#fffdff',
    card: '#ffffff',
    text: '#1a1a1a',
    textSecondary: '#666666',
    primary: '#004778',
    primaryHover: '#006099',
    border: '#e5e5e5',
    error: '#dc3545',
  }

  useEffect(() => {
    // Check dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setDarkMode(prefersDark)
    document.documentElement.classList.toggle('dark', prefersDark)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await api.register({ name, email, password })
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4" style={{ backgroundColor: colors.bg }}>
        <div className="max-w-md w-full">
          <div
            className="rounded-xl p-6 shadow-lg text-center"
            style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}` }}
          >
            <div className="text-6xl mb-4" style={{ color: colors.primary }}>✓</div>
            <h2 className="text-2xl font-bold mb-2" style={{ color: colors.text }}>Registration Successful!</h2>
            <p className="mb-6" style={{ color: colors.textSecondary }}>
              Please check your email to verify your account before logging in.
            </p>
            <a
              href="/login"
              className="inline-block px-6 py-3 rounded-lg font-medium"
              style={{ backgroundColor: colors.primary, color: '#fff' }}
            >
              Go to Login
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4" style={{ backgroundColor: colors.bg }}>
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: colors.text }}>Video Generator</h1>
          <p className="mt-2" style={{ color: colors.textSecondary }}>Create your account</p>
        </div>

        <div
          className="rounded-xl p-6 shadow-lg"
          style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}` }}
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div
                className="p-3 rounded-lg text-sm"
                style={{ backgroundColor: `${colors.error}15`, color: colors.error }}
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1" style={{ color: colors.textSecondary }}>
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                } as any}
                placeholder="John Doe"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1" style={{ color: colors.textSecondary }}>
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                } as any}
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1" style={{ color: colors.textSecondary }}>
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                } as any}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <p className="mt-1 text-xs" style={{ color: colors.textSecondary }}>Minimum 8 characters</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: colors.primary, color: '#fff' }}
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm" style={{ color: colors.textSecondary }}>
              Already have an account?{' '}
              <a
                href="/login"
                className="font-medium"
                style={{ color: colors.primary }}
              >
                Sign In
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
