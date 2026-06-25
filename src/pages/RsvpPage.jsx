import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const MAX_GUESTS = 20
const SUBMIT_COOLDOWN_MS = 5000 // 5 seconds between submissions

export default function RsvpPage({ preview = false }) {
  const { token, eventId } = useParams()
  const [guest, setGuest] = useState(null)
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [rsvp, setRsvp] = useState('attending')
  const [numGuests, setNumGuests] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [lastSubmitTime, setLastSubmitTime] = useState(0)

  useEffect(() => {
    if (preview) {
      fetchEventPreview()
    } else {
      fetchGuest()
    }
  }, [token, eventId])

  const fetchEventPreview = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single()

      if (eventError || !eventData) {
        setError('האירוע לא נמצא')
        setLoading(false)
        return
      }

      setEvent(eventData)
      setGuest({ name: 'שם המוזמן' })
    } catch {
      setError('שגיאה בטעינת הנתונים')
    } finally {
      setLoading(false)
    }
  }

  const fetchGuest = async () => {
    try {
      const { data: guestData, error: guestError } = await supabase
        .from('guests')
        .select('*, events(*)')
        .eq('rsvp_token', token)
        .single()

      if (guestError || !guestData) {
        setError('הלינק לא תקין או שפג תוקפו')
        setLoading(false)
        return
      }

      setGuest(guestData)
      setEvent(guestData.events)

      if (guestData.rsvp_status !== 'pending') {
        setRsvp(guestData.rsvp_status)
        setNumGuests(guestData.num_guests || 1)
        setSubmitted(true)
      }
    } catch {
      setError('שגיאה בטעינת הנתונים')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (preview) return

    // Rate limiting
    const now = Date.now()
    if (now - lastSubmitTime < SUBMIT_COOLDOWN_MS) {
      alert('נא להמתין מספר שניות לפני שליחה נוספת.')
      return
    }

    // Validate num_guests
    const safeNumGuests = Math.min(Math.max(1, numGuests), MAX_GUESTS)

    setSaving(true)
    setLastSubmitTime(now)

    try {
      const { error: updateError } = await supabase
        .from('guests')
        .update({
          rsvp_status: rsvp,
          num_guests: rsvp === 'attending' ? safeNumGuests : 0,
          rsvp_date: new Date().toISOString(),
          ...(rsvp !== 'attending' ? { table_number: null } : {}),
        })
        .eq('rsvp_token', token)

      if (updateError) throw updateError
      setNumGuests(safeNumGuests)
      setSubmitted(true)
      setEditing(false)
    } catch {
      alert('שגיאה בשמירת האישור. נסה שוב.')
    } finally {
      setSaving(false)
    }
  }

  const getCalendarUrl = () => {
    if (!event) return '#'
    const start = new Date(event.event_date)
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const details = [
      event.location || '',
      event.location_url ? `הוראות הגעה: ${event.location_url}` : '',
    ].filter(Boolean).join('\n')
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.name,
      dates: `${fmt(start)}/${fmt(end)}`,
      location: event.location || '',
      details,
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-white">
        <div className="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-white p-4">
        <div className="text-center">
          <p className="text-4xl mb-4">😕</p>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  if (submitted && !editing) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-amber-50/30" dir="rtl">
        <div className="max-w-lg mx-auto px-4 py-8">
          {preview && (
            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <p className="text-sm text-blue-700 font-medium">👁️ תצוגה מקדימה - ככה המוזמנים יראו את הדף</p>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-lg border border-amber-100 overflow-hidden">
            <div className="bg-gradient-to-l from-amber-500 to-amber-600 p-8 text-center">
              <p className="text-5xl mb-3">{rsvp === 'attending' ? '🎉' : '💛'}</p>
              <h1 className="text-2xl font-bold text-white">
                {rsvp === 'attending' ? 'תודה על אישורך!' : 'תודה על התשובה!'}
              </h1>
              <p className="text-amber-100 text-sm mt-2">האישור התקבל ונרשם במערכת</p>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-center text-gray-700">
                {rsvp === 'attending'
                  ? `נתראה ב${event?.name}! 🥂`
                  : 'נשמח לראותך באירועים הבאים!'}
              </p>

              {rsvp === 'attending' && (
                <div className="text-center text-sm text-gray-500">
                  מספר אורחים: <span className="font-bold text-gray-800">{numGuests}</span>
                </div>
              )}

              {rsvp === 'attending' && event && (
                <div className="bg-amber-50/50 rounded-xl p-5 space-y-3">
                  <h3 className="font-semibold text-gray-800 text-center">פרטי האירוע</h3>
                  <div className="text-sm text-gray-600 space-y-2">
                    <p>📅 {new Date(event.event_date).toLocaleDateString('he-IL')} בשעה {new Date(event.event_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</p>
                    {event.location && <p>📍 {event.location}</p>}
                    {event.location_url && (
                      <a
                        href={preview ? undefined : event.location_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-amber-600 hover:underline"
                      >
                        🗺️ הוראות הגעה
                      </a>
                    )}
                  </div>

                  <div className="pt-2">
                    <a
                      href={preview ? undefined : getCalendarUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-block w-full text-center px-6 py-3 rounded-xl font-medium text-white transition-colors shadow-sm ${
                        preview ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-l from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700'
                      }`}
                    >
                      📅 הוסף ליומן
                    </a>
                  </div>
                </div>
              )}

              {rsvp !== 'attending' && event?.bit_link && (
                <div className="bg-blue-50 rounded-xl p-5 text-center space-y-3">
                  <p className="text-sm text-gray-600">גם אם לא מגיעים, אפשר לשלוח מתנה 🎁</p>
                  <a
                    href={preview ? undefined : event.bit_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
                  >
                    💝 שלח מתנה ב-BIT
                  </a>
                </div>
              )}

              {!preview && (
                <button
                  onClick={() => setEditing(true)}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-2 cursor-pointer"
                >
                  שנה את התשובה שלך
                </button>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            מופעל באמצעות מערכת ניהול הזמנות
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-amber-50/30" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-8">
        {preview && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
            <p className="text-sm text-blue-700 font-medium">👁️ תצוגה מקדימה - ככה המוזמנים יראו את הדף</p>
            <p className="text-xs text-blue-500 mt-1">לכל מוזמן יופיע השם שלו ולינק ייחודי משלו</p>
          </div>
        )}

        {event?.invitation_url && (
          <div className="mb-6 rounded-2xl overflow-hidden shadow-lg">
            <img src={event.invitation_url} alt="הזמנה" className="w-full" />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-amber-100 overflow-hidden">
          <div className="bg-gradient-to-l from-amber-500 to-amber-600 p-6 text-center">
            <h1 className="text-xl font-bold text-white">{event?.name}</h1>
            <p className="text-amber-100 text-sm mt-1">
              📅 {event && new Date(event.event_date).toLocaleDateString('he-IL')}
              {event?.location && ` | 📍 ${event.location}`}
            </p>
            {event?.location_url && (
              <a
                href={preview ? undefined : event.location_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-full text-white text-sm transition-colors"
              >
                🗺️ מיקום האירוע
              </a>
            )}
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="text-center">
                <p className="text-gray-600">
                  שלום <span className="font-semibold">{guest?.name}</span>,
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  {editing ? 'עדכן/י את התשובה:' : 'אנא אשר/י הגעה:'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => !preview && setRsvp('attending')}
                  className={`flex-1 py-4 rounded-xl text-center font-medium transition-all cursor-pointer ${
                    rsvp === 'attending'
                      ? 'bg-green-50 border-2 border-green-400 text-green-700 shadow-sm'
                      : 'bg-gray-50 border-2 border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <span className="text-2xl block mb-1">✅</span>
                  מגיע/ה
                </button>
                <button
                  type="button"
                  onClick={() => !preview && setRsvp('not_attending')}
                  className={`flex-1 py-4 rounded-xl text-center font-medium transition-all cursor-pointer ${
                    rsvp === 'not_attending'
                      ? 'bg-red-50 border-2 border-red-400 text-red-700 shadow-sm'
                      : 'bg-gray-50 border-2 border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <span className="text-2xl block mb-1">❌</span>
                  לא מגיע/ה
                </button>
              </div>

              {rsvp === 'attending' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    כמה אורחים (כולל אותך)?
                  </label>
                  <div className="flex items-center gap-3 justify-center">
                    <button
                      type="button"
                      onClick={() => !preview && setNumGuests(Math.max(1, numGuests - 1))}
                      className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-lg cursor-pointer"
                    >
                      -
                    </button>
                    <span className="text-3xl font-bold text-gray-800 w-12 text-center">
                      {numGuests}
                    </span>
                    <button
                      type="button"
                      onClick={() => !preview && setNumGuests(Math.min(MAX_GUESTS, numGuests + 1))}
                      className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-lg cursor-pointer"
                      disabled={numGuests >= MAX_GUESTS}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={saving || preview}
                className={`w-full py-3 rounded-xl font-medium text-white transition-colors shadow-sm cursor-pointer
                  ${preview
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-l from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
              >
                {preview ? 'שלח אישור (לא פעיל בתצוגה מקדימה)' : saving ? 'שומר...' : editing ? 'עדכן תשובה' : 'שלח אישור'}
              </button>

              {editing && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-1 cursor-pointer"
                >
                  ביטול
                </button>
              )}
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          מופעל באמצעות מערכת ניהול הזמנות
        </p>
      </div>
    </div>
  )
}
