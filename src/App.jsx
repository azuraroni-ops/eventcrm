import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import EventsPage from './pages/EventsPage'
import EventDetailPage from './pages/EventDetailPage'
import SendPage from './pages/SendPage'
import RemindersPage from './pages/RemindersPage'
import SettingsPage from './pages/SettingsPage'
import RsvpPage from './pages/RsvpPage'
import BlessingPage from './pages/BlessingPage'
import SeatingPage from './pages/SeatingPage'
import FinancesPage from './pages/FinancesPage'
import LoginPage, { isSessionValid } from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import NotFoundPage from './pages/NotFoundPage'

function ProtectedRoutes() {
  const [authed, setAuthed] = useState(isSessionValid())

  if (localStorage.getItem('setup_complete') !== 'true') {
    return <SetupPage />
  }

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />
  }

  return (
    <Routes>
      <Route element={<Layout onLogout={() => { localStorage.removeItem('crm_auth'); setAuthed(false) }} />}>
        <Route index element={<DashboardPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="events/:id/seating" element={<SeatingPage />} />
        <Route path="events/:id/finances" element={<FinancesPage />} />
        <Route path="send" element={<SendPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/rsvp/preview/:eventId" element={<RsvpPage preview />} />
        <Route path="/rsvp/:token" element={<RsvpPage />} />
        <Route path="/blessing/:token" element={<BlessingPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  )
}
