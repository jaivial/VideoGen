interface NavigationColors {
  card: string
  border: string
  primary: string
  text: string
  textSecondary: string
  bg?: string
}

interface AppNavigationProps {
  colors: NavigationColors
  darkMode: boolean
  activeTab: 'generate' | 'editor' | 'library' | 'settings'
  onToggleDarkMode: () => void
  maxWidthClassName?: string
}

const NAV_ITEMS = [
  { id: 'generate', label: 'Generate', href: '/generate' },
  { id: 'editor', label: 'Editor', href: '/editor' },
  { id: 'library', label: 'My Library', href: '/library' },
  { id: 'settings', label: 'Settings', href: '/settings' },
] as const

export function AppNavigation({
  colors,
  darkMode,
  activeTab,
  onToggleDarkMode,
  maxWidthClassName = 'max-w-6xl',
}: AppNavigationProps) {
  return (
    <nav className="border-b" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
      <div className={`${maxWidthClassName} mx-auto px-4 sm:px-6 lg:px-8`}>
        <div className="flex justify-between h-16 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <svg className="w-8 h-8 shrink-0" fill="none" stroke={colors.primary} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span className="text-xl font-bold truncate" style={{ color: colors.primary }}>
              VideoGen
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              aria-label="Toggle dark mode"
              onClick={onToggleDarkMode}
              className="p-2 rounded-lg transition-colors"
              style={{ backgroundColor: colors.border }}
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" stroke={colors.text} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke={colors.text} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id
              return (
                <a
                  key={item.id}
                  href={item.href}
                  className="px-4 py-2 rounded-lg font-medium transition-colors"
                  style={isActive
                    ? { backgroundColor: colors.primary, color: darkMode ? colors.bg || colors.text : '#fff' }
                    : { color: colors.textSecondary }}
                >
                  {item.label}
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
