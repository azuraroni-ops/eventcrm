import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'דשבורד', icon: '📊' },
  { to: '/events', label: 'אירועים', icon: '🎉' },
  { to: '/send', label: 'שליחת הזמנות', icon: '💬' },
  { to: '/reminders', label: 'תזכורות', icon: '🔔' },
  { to: '/settings', label: 'הגדרות', icon: '⚙️' },
]

export default function Navbar({ onLogout }) {
  return (
    <nav className="bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="text-2xl">💍</span>
            <span className="text-lg font-bold text-gray-800">ניהול הזמנות</span>
          </NavLink>

          <div className="hidden md:flex items-center gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-gold-50 text-gold-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`
                }
              >
                <span>{link.icon}</span>
                {link.label}
              </NavLink>
            ))}
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors cursor-pointer mr-2"
              >
                🚪 התנתק
              </button>
            )}
          </div>

          <div className="md:hidden flex items-center gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `p-2 rounded-lg text-lg ${
                    isActive ? 'bg-gold-50' : 'hover:bg-gray-50'
                  }`
                }
                title={link.label}
              >
                {link.icon}
              </NavLink>
            ))}
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-2 rounded-lg text-lg hover:bg-red-50 cursor-pointer"
                title="התנתק"
              >
                🚪
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
