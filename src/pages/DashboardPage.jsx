import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import StatsCard from '../components/ui/StatsCard'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function DashboardPage() {
  const [events, setEvents] = useState([])
  const [stats, setStats] = useState({ total: 0, attending: 0, notAttending: 0, pending: 0, totalGuests: 0 })
  const [loading, setLoading] = useState(true)
  const [eventStats, setEventStats] = useState({})

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const { data: eventsData } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: true })

      const { data: guestsData } = await supabase
        .from('guests')
        .select('*')

      const guests = guestsData || []
      setEvents(eventsData || [])
      setStats({
        total: guests.length,
        attending: guests.filter((g) => g.rsvp_status === 'attending').length,
        notAttending: guests.filter((g) => g.rsvp_status === 'not_attending').length,
        pending: guests.filter((g) => g.rsvp_status === 'pending').length,
        totalGuests: guests
          .filter((g) => g.rsvp_status === 'attending')
          .reduce((sum, g) => sum + (g.num_guests || 1), 0),
      })

      const perEvent = {}
      for (const e of (eventsData || [])) {
        const eventGuests = guests.filter((g) => g.event_id === e.id)
        perEvent[e.id] = {
          total: eventGuests.length,
          attending: eventGuests.filter((g) => g.rsvp_status === 'attending').length,
          pending: eventGuests.filter((g) => g.rsvp_status === 'pending').length,
          totalGuests: eventGuests
            .filter((g) => g.rsvp_status === 'attending')
            .reduce((sum, g) => sum + (g.num_guests || 1), 0),
        }
      }
      setEventStats(perEvent)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const isToday = (dateStr) => {
    const eventDate = new Date(dateStr)
    const today = new Date()
    return eventDate.toDateString() === today.toDateString()
  }

  const isUpcoming = (dateStr) => {
    return new Date(dateStr) >= new Date(new Date().toDateString())
  }

  if (loading) return <LoadingSpinner />

  const todayEvents = events.filter((e) => isToday(e.event_date))
  const upcomingEvents = events.filter((e) => isUpcoming(e.event_date) && !isToday(e.event_date))
  const pastEvents = events.filter((e) => !isUpcoming(e.event_date) && !isToday(e.event_date))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">דשבורד</h1>
        <Link to="/events">
          <Button>+ אירוע חדש</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatsCard label="סה״כ מוזמנים" value={stats.total} icon="👥" color="blue" />
        <StatsCard label="מגיעים" value={stats.attending} icon="✅" color="green" />
        <StatsCard label="לא מגיעים" value={stats.notAttending} icon="❌" color="red" />
        <StatsCard label="ממתינים" value={stats.pending} icon="⏳" color="gold" />
        <StatsCard label="סה״כ אורחים" value={stats.totalGuests} icon="🎯" color="blue" />
      </div>

      {todayEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
            🔴 אירועים היום
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {todayEvents.map((event) => {
              const es = eventStats[event.id] || {}
              return (
                <Card key={event.id} className="border-2 border-red-200 bg-red-50/30">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-gray-800 text-lg">{event.name}</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        ⏰ {new Date(event.event_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                        {event.location && ` | 📍 ${event.location}`}
                      </p>
                    </div>
                    <span className="text-3xl">🎉</span>
                  </div>
                  <div className="flex gap-3 text-sm mb-3">
                    <span className="text-green-600">✅ {es.attending || 0} מגיעים</span>
                    <span className="text-amber-600">⏳ {es.pending || 0} ממתינים</span>
                    <span className="text-blue-600">🎯 {es.totalGuests || 0} אורחים</span>
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/events/${event.id}`}>
                      <Button variant="secondary" size="sm">פרטי אירוע</Button>
                    </Link>
                    <Link to="/reminders">
                      <Button size="sm">📅 שלח תזכורת יום האירוע</Button>
                    </Link>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {upcomingEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">אירועים קרובים</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {upcomingEvents.map((event) => {
              const es = eventStats[event.id] || {}
              const daysUntil = Math.ceil((new Date(event.event_date) - new Date()) / (1000 * 60 * 60 * 24))
              return (
                <Link key={event.id} to={`/events/${event.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-gray-800">{event.name}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {new Date(event.event_date).toLocaleDateString('he-IL')}
                          <span className="text-gold-600 mr-2">({daysUntil} ימים)</span>
                        </p>
                        {event.location && (
                          <p className="text-sm text-gray-400 mt-0.5">📍 {event.location}</p>
                        )}
                        <div className="flex gap-3 text-xs mt-2 text-gray-500">
                          <span>✅ {es.attending || 0}</span>
                          <span>⏳ {es.pending || 0}</span>
                          <span>🎯 {es.totalGuests || 0} אורחים</span>
                        </div>
                      </div>
                      <span className="text-2xl">🎉</span>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {pastEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-3">אירועים שעברו</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {pastEvents.map((event) => (
              <Link key={event.id} to={`/events/${event.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer opacity-60">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-800">{event.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {new Date(event.event_date).toLocaleDateString('he-IL')}
                      </p>
                    </div>
                    <span className="text-2xl">📋</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {events.length === 0 && (
        <Card>
          <p className="text-gray-500 text-center py-4">
            אין אירועים עדיין.{' '}
            <Link to="/events" className="text-gold-600 hover:underline">
              צור אירוע חדש
            </Link>
          </p>
        </Card>
      )}
    </div>
  )
}
