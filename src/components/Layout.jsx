import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout({ onLogout }) {
  return (
    <div className="min-h-screen bg-gray-50/50">
      <Navbar onLogout={onLogout} />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
