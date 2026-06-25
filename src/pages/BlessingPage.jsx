import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const MAX_BLESSING_LENGTH = 2000
const SUBMIT_COOLDOWN_MS = 5000

export default function BlessingPage() {
  const { token } = useParams()
  const [guest, setGuest] = useState(null)
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [lastSubmitTime, setLastSubmitTime] = useState(0)

  useEffect(() => {
    fetchData()
  }, [token])

  const fetchData = async () => {
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

      if (guestData.blessing_text) {
        setMessage(guestData.blessing_text)
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
    if (!message.trim()) return

    // Rate limiting
    const now = Date.now()
    if (now - lastSubmitTime < SUBMIT_COOLDOWN_MS) {
      alert('נא להמתין מספר שניות לפני שליחה נוספת.')
      return
    }

    // Length validation
    const cleanMessage = message.trim().slice(0, MAX_BLESSING_LENGTH)

    setSaving(true)
    setLastSubmitTime(now)

    try {
      await supabase.from('blessings').insert([{
        event_id: event.id,
        guest_id: guest.id,
        message: cleanMessage,
      }])

      await supabase
        .from('guests')
        .update({ blessing_text: cleanMessage })
        .eq('id', guest.id)

      setMessage(cleanMessage)
      setSubmitted(true)
    } catch {
      alert('שגיאה בשמירת הברכה. נסה שוב.')
    } finally {
      setSaving(false)
    }
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

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-amber-50/30" dir="rtl">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl shadow-lg border border-amber-100 overflow-hidden">
            <div className="bg-gradient-to-l from-pink-500 to-purple-500 p-8 text-center">
              <p className="text-5xl mb-3">💝</p>
              <h1 className="text-2xl font-bold text-white">תודה על הברכה!</h1>
              <p className="text-pink-100 text-sm mt-2">הברכה שלך נשמרה בהצלחה</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-pink-50/50 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">הברכה שלך:</p>
                <p className="text-gray-700 whitespace-pre-line">{message}</p>
              </div>

              {event?.bit_link && (
                <div className="text-center space-y-3 pt-2">
                  <p className="text-sm text-gray-600">רוצה גם לשלוח מתנה?</p>
                  <a
                    href={event.bit_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-8 py-3 bg-gradient-to-l from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium transition-colors shadow-sm"
                  >
                    🎁 שלח מתנה ב-BIT
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-white to-amber-50/30" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-8">
        {event?.invitation_url && (
          <div className="mb-6 rounded-2xl overflow-hidden shadow-lg">
            <img src={event.invitation_url} alt="הזמנה" className="w-full" />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-amber-100 overflow-hidden">
          <div className="bg-gradient-to-l from-pink-500 to-purple-500 p-6 text-center">
            <h1 className="text-xl font-bold text-white">{event?.name}</h1>
            <p className="text-pink-100 text-sm mt-1">
              📅 {event && new Date(event.event_date).toLocaleDateString('he-IL')}
            </p>
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="text-center">
                <p className="text-gray-600">
                  שלום <span className="font-semibold">{guest?.name}</span>,
                </p>
                <p className="text-gray-500 text-sm mt-1">נשמח לקבל ממך ברכה אישית 💛</p>
              </div>

              <div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_BLESSING_LENGTH))}
                  placeholder="כתוב/כתבי את הברכה שלך כאן..."
                  rows={5}
                  maxLength={MAX_BLESSING_LENGTH}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none text-sm resize-y"
                  dir="rtl"
                  required
                />
                <p className="text-xs text-gray-400 text-left mt-1">{message.length}/{MAX_BLESSING_LENGTH}</p>
              </div>

              <button
                type="submit"
                disabled={saving || !message.trim()}
                className="w-full py-3 rounded-xl font-medium text-white transition-colors shadow-sm cursor-pointer bg-gradient-to-l from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'שולח...' : '💌 שלח ברכה'}
              </button>

              {event?.bit_link && (
                <div className="text-center border-t border-gray-100 pt-5 space-y-3">
                  <p className="text-sm text-gray-500">רוצה גם לשלוח מתנה?</p>
                  <a
                    href={event.bit_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-8 py-3 bg-gradient-to-l from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium transition-colors shadow-sm"
                  >
                    🎁 שלח מתנה ב-BIT
                  </a>
                </div>
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
