import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function EventsPage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', event_date: '', location: '', location_url: '', bit_link: '', blessing_email: '' })
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetchEvents()
  }, [])

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*, guests(count)')
      .order('event_date', { ascending: true })
    setEvents(data || [])
    setLoading(false)
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('events')
        .insert([{
          name: form.name,
          event_date: new Date(form.event_date).toISOString(),
          location: form.location,
          location_url: form.location_url || null,
          bit_link: form.bit_link || null,
          blessing_email: form.blessing_email || null,
        }])
        .select()
        .single()

      if (error) throw error

      setShowModal(false)
      setForm({ name: '', event_date: '', location: '', location_url: '', bit_link: '', blessing_email: '' })
      navigate(`/events/${data.id}`)
    } catch (err) {
      console.error('Create event error:', err)
      alert('שגיאה ביצירת האירוע. נסה שוב.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('אתה בטוח שאתה רוצה למחוק את האירוע?')) return

    await supabase.from('guests').delete().eq('event_id', id)
    await supabase.from('messages').delete().eq('event_id', id)
    await supabase.from('events').delete().eq('id', id)
    fetchEvents()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">אירועים</h1>
        <Button onClick={() => setShowModal(true)}>+ אירוע חדש</Button>
      </div>

      {events.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <p className="text-4xl mb-3">🎉</p>
            <p className="text-gray-500">אין אירועים עדיין. צור את האירוע הראשון שלך!</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {events.map((event) => (
            <Card key={event.id} className="hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => navigate(`/events/${event.id}`)}
                >
                  <h3 className="font-semibold text-gray-800 text-lg">{event.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    📅 {new Date(event.event_date).toLocaleDateString('he-IL')}
                  </p>
                  {event.location && (
                    <p className="text-sm text-gray-400 mt-0.5">📍 {event.location}</p>
                  )}
                  <p className="text-sm text-gold-600 mt-2">
                    👥 {event.guests?.[0]?.count || 0} מוזמנים
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(event.id)}>
                  🗑️
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="אירוע חדש">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="שם האירוע"
            placeholder="למשל: החתונה של דני ומיכל"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            label="תאריך"
            type="datetime-local"
            value={form.event_date}
            onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            required
          />
          <Input
            label="מיקום"
            placeholder="למשל: אולמי הגן, ראשון לציון"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          <Input
            label="קישור למיקום (Google Maps)"
            placeholder="הדבק קישור מ-Google Maps"
            value={form.location_url}
            onChange={(e) => setForm({ ...form, location_url: e.target.value })}
          />
          <Input
            label="קישור לתשלום BIT"
            placeholder="הדבק קישור BIT"
            value={form.bit_link}
            onChange={(e) => setForm({ ...form, bit_link: e.target.value })}
          />
          <Input
            label="מייל לקבלת ברכות"
            placeholder="your@email.com"
            type="email"
            value={form.blessing_email}
            onChange={(e) => setForm({ ...form, blessing_email: e.target.value })}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'יוצר...' : 'צור אירוע'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
