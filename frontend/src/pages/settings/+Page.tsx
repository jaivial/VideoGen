import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { AppNavigation } from '../../components/AppNavigation'

export default function Settings() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const navigate = useNavigate()

  // Theme colors
  const colors = darkMode ? {
    bg: '#21180d',
    card: '#2d2215',
    cardAlt: '#352a1c',
    text: '#f1f7e1',
    textSecondary: '#bbb098',
    primary: '#c06642',
    primaryHover: '#d9774f',
    border: '#4a3a2a',
    accent: '#c06642',
    success: '#6b9a5b',
    danger: '#d9534f',
  } : {
    bg: '#fffdff',
    card: '#ffffff',
    cardAlt: '#f8f9fa',
    text: '#1a1a1a',
    textSecondary: '#666666',
    primary: '#004778',
    primaryHover: '#006099',
    border: '#e5e5e5',
    accent: '#f19bbf',
    success: '#4a9c5d',
    danger: '#dc3545',
  }

  useEffect(() => {
    // Check dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setDarkMode(prefersDark)
    document.documentElement.classList.toggle('dark', prefersDark)

    api.me()
      .then(setUser)
      .catch(() => {
        navigate('/login')
      })
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await api.logout()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: colors.bg }}>
        <div className="animate-spin rounded-full h-12 w-12 border-4" style={{ borderColor: colors.primary, borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.bg, color: colors.text }}>
      <AppNavigation
        colors={colors}
        darkMode={darkMode}
        activeTab="settings"
        maxWidthClassName="max-w-4xl"
        onToggleDarkMode={() => {
          setDarkMode(!darkMode)
          document.documentElement.classList.toggle('dark', !darkMode)
        }}
      />

      <div className="max-w-2xl mx-auto py-8 px-4">
        {/* Profile Card */}
        <div className="rounded-2xl p-6 mb-6 shadow-lg" style={{ backgroundColor: colors.card }}>
          <div className="flex items-center gap-4 mb-6">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: colors.primary, color: '#fff' }}
            >
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{user?.name || 'User'}</h1>
              <p className="text-sm" style={{ color: colors.textSecondary }}>{user?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Member Since</p>
              <p className="font-semibold">{user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : 'N/A'}</p>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Account Status</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.success }} />
                <p className="font-semibold">Active</p>
              </div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Videos Created</p>
              <p className="font-semibold">-</p>
            </div>
          </div>
        </div>

        {/* Account Settings */}
        <div className="rounded-2xl p-6 mb-6 shadow-lg" style={{ backgroundColor: colors.card }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" style={{ color: colors.primary }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Account Information
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <label className="block text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Full Name</label>
              <p className="font-medium">{user?.name || 'Not set'}</p>
            </div>

            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <label className="block text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Email Address</label>
              <p className="font-medium">{user?.email || 'Not set'}</p>
            </div>

            <div className="p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <label className="block text-xs font-medium uppercase tracking-wider mb-1" style={{ color: colors.textSecondary }}>Account ID</label>
              <p className="font-mono text-sm" style={{ color: colors.textSecondary }}>#{user?.id || 'N/A'}</p>
            </div>
          </div>
        </div>

        {/* Preferences */}
        <div className="rounded-2xl p-6 mb-6 shadow-lg" style={{ backgroundColor: colors.card }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" style={{ color: colors.primary }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Preferences
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <div>
                <p className="font-medium">Dark Mode</p>
                <p className="text-sm" style={{ color: colors.textSecondary }}>Use dark theme for the interface</p>
              </div>
              <button
                onClick={() => {
                  setDarkMode(!darkMode)
                  document.documentElement.classList.toggle('dark', !darkMode)
                }}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                style={{ backgroundColor: darkMode ? colors.primary : colors.border }}
              >
                <span
                  className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  style={{ transform: darkMode ? 'translateX(1.5rem)' : 'translateX(0.25rem)' }}
                />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl" style={{ backgroundColor: colors.cardAlt }}>
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm" style={{ color: colors.textSecondary }}>Receive updates about your videos</p>
              </div>
              <button
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                style={{ backgroundColor: colors.border }}
              >
                <span
                  className="inline-block h-4 w-4 transform rounded-full bg-white"
                  style={{ transform: 'translateX(0.25rem)' }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-2xl p-6 shadow-lg" style={{ backgroundColor: colors.card, border: `1px solid ${colors.danger}30` }}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: colors.danger }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Danger Zone
          </h2>

          <div className="p-4 rounded-xl" style={{ backgroundColor: `${colors.danger}10` }}>
            <p className="text-sm mb-4" style={{ color: colors.textSecondary }}>
              Signing out will end your current session. You can sign back in at any time.
            </p>
            <button
              onClick={handleLogout}
              className="w-full py-3 rounded-xl font-medium transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
              style={{ backgroundColor: colors.danger, color: '#fff' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm" style={{ color: colors.textSecondary }}>
            VideoGen &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}
