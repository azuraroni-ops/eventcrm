import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { sendMessage, sendImage, getSiteBaseUrl, shortenUrl, checkWhatsApp, sendTyping, clearMessagesQueue } from '../lib/whatsapp'
import {
  canSendNow, calculateDelay, incrementCounters, recordSend, recordFail,
  syncCountersFromSupabase, planBatchSchedule, getSafetyConfig,
  applyMessageVariation, acquireSendingLock, releaseSendingLock, refreshSendingLock,
  savePendingBatch, getPendingBatch, clearPendingBatch,
  getTypingDelay, shouldCheckNumbers,
} from '../lib/antiBlock'
import SendingDashboard from '../components/SendingDashboard'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const TABS = [
  { key: 'pending', label: '🔔 תזכורת ממתינים', desc: 'שלח תזכורת למי שטרם אישר' },
  { key: 'last_reminder', label: '⏰ תזכורת אחרונה', desc: 'תזכורת דחופה לממתינים — נוסח מבקש אישור/סירוב לאור המועד הקרב' },
  { key: 'confirmed', label: '📋 תזכורת מאשרים', desc: 'שלח פרטי האירוע למי שאישר' },
  { key: 'blessing', label: '💌 ברכה ומתנה', desc: 'שלח קישור לברכה ו-BIT למי שלא מגיע (ללא מי ששלח מתנה)' },
  { key: 'eventday', label: '📅 יום האירוע', desc: 'תזכורת יום האירוע עם פרטי הגעה' },
]

const DEFAULT_PENDING = `שלום {שם} 👋

תזכורת: עדיין לא אישרת הגעה ל{שם_אירוע}.

👇 *לאישור הגעתכם / אי הגעתכם:*
{קישור_אישור}

נשמח לדעת אם את/ה מגיע/ה! 💛`

const DEFAULT_CONFIRMED = `שלום {שם} 👋

תזכורת: {שם_אירוע} מתקרב!

📅 תאריך: {תאריך}
⏰ שעה: {שעה}
📍 מיקום: {מיקום}
{קישור_מיקום}
{שולחן}

📅 להוספה ליומן:
{קישור_יומן}

נתראה! 🎉`

const DEFAULT_BLESSING = `שלום {שם} 👋

מבינים שלא תוכל/י להגיע ל{שם_אירוע}.
נשמח לקבל ממך ברכה אישית 💛

👇 *לכתיבת ברכה:*
{קישור_ברכה}
{קישור_bit}

תודה! 🙏`

const DEFAULT_LAST_REMINDER = `שלום {שם} 👋

{שם_אירוע} כבר בקרוב! 🎉
📅 {תאריך} בשעה {שעה}

טרם קיבלנו ממך אישור הגעה, ונשמח מאוד לדעת אם את/ה מתכנן/ת להגיע 🙏

👇 *אנא אשר/י הגעה או אי-הגעה:*
{קישור_אישור}

חשוב לנו לדעת כדי שנוכל להתארגן כמו שצריך ❤️
תודה!`

const DEFAULT_EVENTDAY = `שלום {שם}! 🎉

היום זה היום! {שם_אירוע} 🥂

⏰ שעה: {שעה}
📍 מיקום: {מיקום}
{קישור_מיקום}
{שולחן}
{קישור_bit}

מחכים לך! 💛`

function MessagePreview({ guest, buildMessage }) {
  const [text, setText] = useState('טוען תצוגה מקדימה...')
  useEffect(() => {
    let cancelled = false
    buildMessage(guest).then((msg) => {
      if (!cancelled) setText(msg)
    }).catch(() => {
      if (!cancelled) setText('שגיאה בטעינת תצוגה מקדימה')
    })
    return () => { cancelled = true }
  }, [guest, buildMessage])

  return (
    <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
      <p className="text-xs font-medium text-gray-500 mb-2">תצוגה מקדימה ({guest.name}):</p>
      <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans" dir="auto">{text}</pre>
    </div>
  )
}

export default function RemindersPage() {
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [activeTab, setActiveTab] = useState('pending')
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 })
  const [log, setLog] = useState([])
  const [nextDelay, setNextDelay] = useState(0)
  const [waitInfo, setWaitInfo] = useState(null)
  const [pendingResume, setPendingResume] = useState(null)
  const [autoResumeIn, setAutoResumeIn] = useState(0)
  const [resumeTargets, setResumeTargets] = useState(null)
  const [templates, setTemplates] = useState({
    pending: DEFAULT_PENDING,
    last_reminder: DEFAULT_LAST_REMINDER,
    confirmed: DEFAULT_CONFIRMED,
    blessing: DEFAULT_BLESSING,
    eventday: DEFAULT_EVENTDAY,
  })
  const [paused, setPaused] = useState(false)
  const abortRef = useRef(false)
  const lockIntervalRef = useRef(null)
  const [sentMessageIds, setSentMessageIds] = useState({})
  const [manualSelection, setManualSelection] = useState(false)
  const [selectedGuestIds, setSelectedGuestIds] = useState(new Set())

  useEffect(() => {
    fetchEvents()
    syncCountersFromSupabase()
    const pending = getPendingBatch()
    if (pending && pending.page === 'reminders') {
      setPendingResume(pending)
      setAutoResumeIn(5)
    }
  }, [])

  // Auto-resume countdown
  useEffect(() => {
    if (autoResumeIn <= 0 || !pendingResume) return
    if (autoResumeIn <= 1) {
      handleAutoResume(pendingResume)
      return
    }
    const timer = setTimeout(() => setAutoResumeIn(prev => prev - 1), 1000)
    return () => clearTimeout(timer)
  }, [autoResumeIn, pendingResume])

  // Trigger sending after state is set from auto-resume
  useEffect(() => {
    if (resumeTargets && selectedEvent) {
      startSending(resumeTargets)
      setResumeTargets(null)
    }
  }, [resumeTargets, selectedEvent])

  const handleAutoResume = async (pending) => {
    setPendingResume(null)
    setAutoResumeIn(0)

    const { data: event } = await supabase
      .from('events').select('*').eq('id', pending.eventId).single()
    if (!event) { clearPendingBatch(); return }

    const [guestsRes, messagesRes] = await Promise.all([
      supabase.from('guests').select('*').eq('event_id', event.id),
      supabase.from('messages').select('guest_id, type').eq('event_id', event.id).eq('status', 'sent'),
    ])
    const allGuests = guestsRes.data || []

    // Update drip tracking
    const byType = {}
    for (const m of (messagesRes.data || [])) {
      if (!byType[m.type]) byType[m.type] = new Set()
      byType[m.type].add(m.guest_id)
    }
    setSentMessageIds(byType)

    const remainingSet = new Set(pending.remainingGuestIds)
    const targets = allGuests.filter(g => remainingSet.has(g.id))

    if (targets.length === 0) { clearPendingBatch(); return }

    await syncCountersFromSupabase()
    clearPendingBatch()

    setSelectedEvent(event)
    if (pending.activeTab) setActiveTab(pending.activeTab)
    if (pending.templates) setTemplates(prev => ({ ...prev, ...pending.templates }))
    setGuests(allGuests || [])
    setResumeTargets(targets)
  }

  const dismissPending = () => {
    clearPendingBatch()
    setPendingResume(null)
    setAutoResumeIn(0)
  }

  const fetchEvents = async () => {
    const { data } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })
    setEvents(data || [])
    setLoading(false)
  }

  const selectEvent = async (event) => {
    setSelectedEvent(event)
    const [guestsRes, messagesRes] = await Promise.all([
      supabase.from('guests').select('*').eq('event_id', event.id),
      supabase.from('messages').select('guest_id, type').eq('event_id', event.id).eq('status', 'sent'),
    ])
    setGuests(guestsRes.data || [])

    // Group sent message IDs by type for drip tracking
    const byType = {}
    for (const m of (messagesRes.data || [])) {
      if (!byType[m.type]) byType[m.type] = new Set()
      byType[m.type].add(m.guest_id)
    }
    setSentMessageIds(byType)
  }

  const getTargetGuests = () => {
    switch (activeTab) {
      case 'pending':
      case 'last_reminder':
        return guests.filter((g) => g.rsvp_status === 'pending')
      case 'confirmed':
      case 'eventday':
        return guests.filter((g) => g.rsvp_status === 'attending')
      case 'blessing':
        // Exclude non-attending guests who already sent a gift
        return guests.filter((g) => g.rsvp_status === 'not_attending' && !g.gift_description)
      default:
        return []
    }
  }

  // Guests who haven't received this message type yet
  const getUnsentGuests = () => {
    const msgType = getMessageType()
    const sentSet = sentMessageIds[msgType] || new Set()
    return getTargetGuests().filter(g => !sentSet.has(g.id))
  }

  const getRsvpUrl = (token) => `${getSiteBaseUrl()}/rsvp/${token}`
  const getBlessingUrl = (token) => `${getSiteBaseUrl()}/blessing/${token}`

  const getCalendarUrl = () => {
    if (!selectedEvent) return ''
    const start = new Date(selectedEvent.event_date)
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: selectedEvent.name,
      dates: `${fmt(start)}/${fmt(end)}`,
      location: selectedEvent.location || '',
    })
    return `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  const buildMessage = async (guest) => {
    const calendarUrl = getCalendarUrl()
    const date = new Date(selectedEvent.event_date).toLocaleDateString('he-IL')
    const time = new Date(selectedEvent.event_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

    const [shortRsvp, shortBlessing, shortCalendar, shortLocation, shortBit] = await Promise.all([
      shortenUrl(getRsvpUrl(guest.rsvp_token)),
      shortenUrl(getBlessingUrl(guest.rsvp_token)),
      shortenUrl(calendarUrl),
      selectedEvent.location_url ? shortenUrl(selectedEvent.location_url) : Promise.resolve(''),
      selectedEvent.bit_link ? shortenUrl(selectedEvent.bit_link) : Promise.resolve(''),
    ])

    const locationUrl = shortLocation
      ? `🗺️ הוראות הגעה:\n${shortLocation}`
      : ''
    const tableText = guest.table_number
      ? `🪑 שולחן מספר: ${guest.table_number}`
      : ''
    const bitText = shortBit
      ? `🎁 לשליחת מתנה ב-BIT:\n${shortBit}`
      : ''

    const replacements = {
      '{שם}': guest.name,
      '{שם_אירוע}': selectedEvent.name,
      '{קישור_אישור}': shortRsvp,
      '{קישור_ברכה}': shortBlessing,
      '{תאריך}': date,
      '{שעה}': time,
      '{מיקום}': selectedEvent.location || '',
      '{קישור_יומן}': shortCalendar,
      '{קישור_מיקום}': locationUrl,
      '{שולחן}': tableText,
      '{קישור_bit}': bitText,
    }

    let msg = templates[activeTab]
    for (const [key, value] of Object.entries(replacements)) {
      msg = msg.split(key).join(value)
    }

    return msg.replace(/\n{3,}/g, '\n\n').trim()
  }

  const getMessageType = () => {
    switch (activeTab) {
      case 'pending': return 'reminder'
      case 'last_reminder': return 'last_reminder'
      case 'confirmed': return 'confirmed_reminder'
      case 'blessing': return 'blessing'
      case 'eventday': return 'event_day_reminder'
      default: return 'reminder'
    }
  }

  const handleSend = async () => {
    // If manual selection is active, send only to selected guests
    const targets = manualSelection && selectedGuestIds.size > 0
      ? getUnsentGuests().filter(g => selectedGuestIds.has(g.id))
      : getUnsentGuests()
    if (targets.length === 0) return

    const sendCheck = canSendNow()
    const plan = planBatchSchedule(targets.length)
    const config = getSafetyConfig()
    const avgDelay = (config.minDelay + config.maxDelay) / 2
    const msgType = getMessageType()

    if (!sendCheck.allowed) {
      const waitTimeStr = sendCheck.waitUntil
        ? sendCheck.waitUntil.toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
        : 'חלון השליחה הבא'
      const scheduleMsg = `${sendCheck.reason}\n\nהשליחה תתחיל אוטומטית ב-${waitTimeStr}.\nלתזמן את השליחה?`
      if (!confirm(scheduleMsg)) return

      savePendingBatch({
        eventId: selectedEvent.id,
        remainingGuestIds: targets.map(g => g.id),
        type: msgType,
        page: 'reminders',
        activeTab,
        templates,
      })
      setWaitInfo({
        reason: sendCheck.reason,
        until: sendCheck.waitUntil,
        remaining: targets.length,
      })
      setSending(true)
      setPaused(true)

      const waitAndStart = async () => {
        while (true) {
          await new Promise(r => setTimeout(r, 30000))
          if (abortRef.current) {
            setSending(false)
            setPaused(false)
            setWaitInfo(null)
            return
          }
          const recheck = canSendNow()
          if (recheck.allowed) break
          setWaitInfo(prev => prev ? { ...prev, until: recheck.waitUntil, reason: recheck.reason } : null)
        }
        setWaitInfo(null)
        setPaused(false)
        clearPendingBatch()
        await syncCountersFromSupabase()
        setSending(false)
        startSending(targets)
      }
      abortRef.current = false
      waitAndStart()
      return
    }

    // Confirmation dialog
    const estimatedMinutes = Math.ceil((Math.min(targets.length, config.dailyLimit) * avgDelay) / 60)

    let confirmMsg = `לשלוח תזכורות ל-${targets.length} מוזמנים?\nזמן משוער: כ-${estimatedMinutes} דקות`
    if (plan.needsSplit) {
      confirmMsg += `\n\n⚠️ המכסה היומית (${config.dailyLimit}) לא מספיקה — השליחה תפוצל ל-${plan.totalDays} ימים.`
      confirmMsg += `\nהיום יישלחו ${plan.batches[0].count} הודעות, הנותרות ימשיכו אוטומטית.`
    }

    if (!confirm(confirmMsg)) return

    startSending(targets)
  }

  const startSending = async (targets) => {
    if (!acquireSendingLock()) {
      alert('שליחה כבר פעילה בטאב אחר. סגור את הטאב האחר ונסה שנית.')
      return
    }

    abortRef.current = false
    setSending(true)
    setPaused(false)
    setProgress({ sent: 0, failed: 0, total: targets.length })
    setLog([])

    // Clear outgoing message queue before starting (Green API recommendation)
    await clearMessagesQueue()

    lockIntervalRef.current = setInterval(refreshSendingLock, 30000)
    const msgType = getMessageType()

    for (let i = 0; i < targets.length; i++) {
      const guest = targets[i]

      if (abortRef.current) {
        const remaining = targets.slice(i)
        if (remaining.length > 0) {
          savePendingBatch({
            eventId: selectedEvent.id,
            remainingGuestIds: remaining.map(g => g.id),
            type: msgType,
            page: 'reminders',
            activeTab,
            templates,
          })
          setLog((l) => [...l, { name: 'מערכת', status: 'info', error: `השליחה הופסקה. ${remaining.length} הודעות נשמרו להמשך.` }])
        }
        break
      }

      const sendCheck = canSendNow()
      if (!sendCheck.allowed) {
        const remaining = targets.slice(i)
        savePendingBatch({
          eventId: selectedEvent.id,
          remainingGuestIds: remaining.map(g => g.id),
          type: msgType,
          page: 'reminders',
          activeTab,
          templates,
        })

        const waitTimeStr = sendCheck.waitUntil
          ? sendCheck.waitUntil.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          : ''
        setLog((l) => [...l, { name: 'מערכת', status: 'info', error: `${sendCheck.reason} — ממתין לחלון השליחה הבא (${waitTimeStr})...` }])
        setPaused(true)
        setWaitInfo({
          reason: sendCheck.reason,
          until: sendCheck.waitUntil,
          remaining: remaining.length,
        })

        while (!abortRef.current) {
          await new Promise(r => setTimeout(r, 30000))
          const recheck = canSendNow()
          if (recheck.allowed) break
          setWaitInfo(prev => prev ? { ...prev, until: recheck.waitUntil, reason: recheck.reason } : null)
        }

        setWaitInfo(null)
        setPaused(false)

        if (abortRef.current) {
          setLog((l) => [...l, { name: 'מערכת', status: 'info', error: `השליחה הופסקה. ${remaining.length} הודעות נשמרו להמשך.` }])
          break
        }

        clearPendingBatch()
        await syncCountersFromSupabase()
        setLog((l) => [...l, { name: 'מערכת', status: 'info', error: '⏰ חלון השליחה נפתח — ממשיך לשלוח!' }])
      }

      try {
        // Step 1: Check if number exists on WhatsApp (prevents spam flags)
        if (shouldCheckNumbers()) {
          const check = await checkWhatsApp(guest.phone)
          if (check.checked && !check.exists) {
            setLog((l) => [...l, { name: guest.name, status: 'skipped', error: 'מספר לא קיים בוואטסאפ — דילוג' }])
            setProgress((p) => ({ ...p, failed: p.failed + 1 }))
            continue
          }
        }

        let message = await buildMessage(guest)
        message = applyMessageVariation(message, i)

        // Step 2: Send "typing..." indicator to simulate human behavior
        const typingMs = getTypingDelay()
        if (typingMs > 0) {
          await sendTyping(guest.phone)
          await new Promise((r) => setTimeout(r, typingMs))
        }

        // Step 3: Send the actual message with built-in typingTime
        const builtinTyping = Math.min(Math.max(1000, Math.round(typingMs * 0.7)), 20000)
        if ((activeTab === 'pending' || activeTab === 'last_reminder') && selectedEvent.invitation_url) {
          await sendImage(guest.phone, selectedEvent.invitation_url, message, builtinTyping)
        } else {
          await sendMessage(guest.phone, message, builtinTyping)
        }

        await supabase.from('messages').insert([{
          event_id: selectedEvent.id,
          guest_id: guest.id,
          type: msgType,
          status: 'sent',
          sent_at: new Date().toISOString(),
        }])

        if (activeTab === 'pending' || activeTab === 'last_reminder') {
          await supabase
            .from('guests')
            .update({ reminder_count: (guest.reminder_count || 0) + 1 })
            .eq('id', guest.id)
        }

        incrementCounters()
        recordSend(msgType)

        setProgress((p) => ({ ...p, sent: p.sent + 1 }))
        setLog((l) => [...l, { name: guest.name, status: 'sent' }])

        // Update drip tracking — mark this guest as sent for this message type
        setSentMessageIds(prev => {
          const updated = { ...prev }
          const newSet = new Set(updated[msgType] || [])
          newSet.add(guest.id)
          updated[msgType] = newSet
          return updated
        })
      } catch (err) {
        await supabase.from('messages').insert([{
          event_id: selectedEvent.id,
          guest_id: guest.id,
          type: msgType,
          status: 'failed',
          sent_at: new Date().toISOString(),
        }])

        recordFail(msgType)

        setProgress((p) => ({ ...p, failed: p.failed + 1 }))
        setLog((l) => [...l, { name: guest.name, status: 'failed', error: err.message }])
      }

      if (i < targets.length - 1) {
        const delay = calculateDelay(i, targets.length)
        setNextDelay(Math.ceil(delay / 1000))
        await new Promise((r) => setTimeout(r, delay))
        setNextDelay(0)
      }
    }

    clearInterval(lockIntervalRef.current)
    releaseSendingLock()
    setSending(false)
  }

  if (loading) return <LoadingSpinner />

  const targetGuests = selectedEvent ? getTargetGuests() : []
  const unsentGuests = selectedEvent ? getUnsentGuests() : []
  const totalAlreadySent = targetGuests.length - unsentGuests.length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">תזכורות והודעות</h1>

      {/* Pending batch resume banner */}
      {pendingResume && !sending && (
        <Card className="!p-4 border-2 border-purple-300 bg-purple-50">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-bold text-purple-800">
                📦 יש שליחה ממתינה — {pendingResume.remainingGuestIds?.length || 0} הודעות שטרם נשלחו
              </p>
              <p className="text-xs text-purple-600 mt-1">
                סוג: {TABS.find(t => t.key === pendingResume.activeTab)?.label || 'תזכורת'}
              </p>
              {autoResumeIn > 0 && (
                <p className="text-xs text-purple-500 mt-1">ממשיך אוטומטית בעוד {autoResumeIn} שניות...</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleAutoResume(pendingResume)}>
                ▶️ המשך עכשיו
              </Button>
              <Button size="sm" variant="secondary" onClick={dismissPending}>
                ✕ בטל
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!selectedEvent ? (
        <div>
          <p className="text-gray-500 mb-4">בחר אירוע:</p>
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <Card key={event.id} className="cursor-pointer hover:shadow-md transition-shadow">
                <div onClick={() => selectEvent(event)}>
                  <h3 className="font-semibold text-gray-800">{event.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(event.event_date).toLocaleDateString('he-IL')}
                  </p>
                </div>
              </Card>
            ))}
            {events.length === 0 && (
              <Card>
                <p className="text-center text-gray-400 py-4">אין אירועים</p>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{selectedEvent.name}</h2>
              <p className="text-sm text-gray-500">{guests.length} מוזמנים</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setSelectedEvent(null); setProgress({ sent: 0, failed: 0, total: 0 }); setLog([]); setManualSelection(false); setSelectedGuestIds(new Set()) }}>
              ← חזור
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setManualSelection(false); setSelectedGuestIds(new Set()) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'bg-gold-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="text-sm text-gray-500">
            {TABS.find((t) => t.key === activeTab)?.desc} — {targetGuests.length} מוזמנים
            {totalAlreadySent > 0 && (
              <span className="text-green-600 mr-2"> (✅ {totalAlreadySent} כבר קיבלו, 📨 {unsentGuests.length} נותרו)</span>
            )}
          </p>

          {targetGuests.length === 0 ? (
            <Card>
              <div className="text-center py-8">
                <p className="text-4xl mb-3">
                  {activeTab === 'pending' ? '🎉' : activeTab === 'blessing' ? '💛' : '📋'}
                </p>
                <p className="text-gray-600">
                  {activeTab === 'pending' && 'כל המוזמנים כבר אישרו! אין צורך בתזכורות.'}
                  {activeTab === 'last_reminder' && 'כל המוזמנים כבר אישרו! אין צורך בתזכורת אחרונה.'}
                  {activeTab === 'confirmed' && 'אין מאשרי הגעה עדיין.'}
                  {activeTab === 'blessing' && 'אין מוזמנים שסירבו (או שכולם כבר שלחו מתנה).'}
                  {activeTab === 'eventday' && 'אין מאשרי הגעה עדיין.'}
                </p>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      תבנית הודעה:
                    </label>
                    <textarea
                      value={templates[activeTab]}
                      onChange={(e) => setTemplates({ ...templates, [activeTab]: e.target.value })}
                      rows={8}
                      className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm resize-y"
                      dir="auto"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שם}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שם_אירוע}'}</span>
                      {(activeTab === 'pending' || activeTab === 'last_reminder') && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_אישור}'}</span>}
                      {activeTab === 'blessing' && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_ברכה}'}</span>}
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{תאריך}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שעה}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{מיקום}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_מיקום}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שולחן}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_bit}'}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_יומן}'}</span>
                    </div>
                  </div>

                  {targetGuests.length > 0 && (
                    <MessagePreview guest={targetGuests[0]} buildMessage={buildMessage} />
                  )}

                  {/* Sending progress — if some already sent */}
                  {totalAlreadySent > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-green-800 font-medium">📊 התקדמות שליחה</span>
                        <span className="text-green-700">{totalAlreadySent}/{targetGuests.length} נשלחו</span>
                      </div>
                      <div className="w-full bg-green-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all duration-500"
                          style={{ width: `${targetGuests.length > 0 ? (totalAlreadySent / targetGuests.length) * 100 : 0}%` }}
                        />
                      </div>
                      {unsentGuests.length > 0 && (
                        <p className="text-xs text-green-700">📨 נותרו {unsentGuests.length} שטרם קיבלו</p>
                      )}
                      {unsentGuests.length === 0 && (
                        <p className="text-xs text-green-700 font-medium">✅ כל התזכורות נשלחו!</p>
                      )}
                    </div>
                  )}

                  <SendingDashboard
                    totalToSend={unsentGuests.length}
                    isSending={sending}
                    progress={progress}
                    nextDelay={nextDelay}
                    waitInfo={waitInfo}
                  />

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSend}
                      disabled={sending || (manualSelection ? selectedGuestIds.size === 0 : unsentGuests.length === 0)}
                      size="lg"
                      className="flex-1"
                    >
                      {sending
                        ? paused
                          ? '⏸️ ממתין לחלון שליחה...'
                          : `שולח... (${progress.sent + progress.failed}/${progress.total})`
                        : manualSelection && selectedGuestIds.size > 0
                          ? `📤 שלח ל-${selectedGuestIds.size} נבחרים`
                          : unsentGuests.length > 0
                            ? `📤 שלח ל-${unsentGuests.length} מוזמנים`
                            : '✅ הכל נשלח'}
                    </Button>
                    {sending && (
                      <Button variant="danger" size="lg" onClick={() => { abortRef.current = true }}>
                        ⏹️ עצור
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              {(progress.sent > 0 || progress.failed > 0) && (
                <Card>
                  <div className="flex gap-4 mb-3">
                    <span className="text-green-600">✅ נשלחו: {progress.sent}</span>
                    {progress.failed > 0 && <span className="text-red-600">❌ נכשלו: {progress.failed}</span>}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {log.map((entry, i) => (
                      <div key={i} className={`text-sm px-2 py-1 rounded ${
                        entry.status === 'sent' ? 'text-green-700' : entry.status === 'info' ? 'text-blue-600 bg-blue-50' : entry.status === 'skipped' ? 'text-amber-600 bg-amber-50' : 'text-red-600'
                      }`}>
                        {entry.status === 'sent' ? '✅' : entry.status === 'info' ? 'ℹ️' : entry.status === 'skipped' ? '⏭️' : '❌'} {entry.name}
                        {entry.error && ` - ${entry.error}`}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800">
                    {activeTab === 'pending' && 'ממתינים לאישור'}
                    {activeTab === 'last_reminder' && 'ממתינים לאישור — תזכורת אחרונה'}
                    {activeTab === 'confirmed' && 'מאשרי הגעה'}
                    {activeTab === 'blessing' && 'לא מגיעים (ללא מי ששלח מתנה)'}
                    {activeTab === 'eventday' && 'מאשרי הגעה'}
                    <span className="text-sm font-normal text-gray-400 mr-2">({targetGuests.length})</span>
                  </h3>
                  <button
                    onClick={() => {
                      setManualSelection(!manualSelection)
                      setSelectedGuestIds(new Set())
                    }}
                    className={`text-xs px-3 py-1 rounded-full cursor-pointer transition-colors ${manualSelection ? 'bg-gold-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {manualSelection ? '✕ בטל בחירה ידנית' : '☑️ בחירה ידנית'}
                  </button>
                </div>

                {manualSelection && (
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setSelectedGuestIds(new Set(unsentGuests.map(g => g.id)))}
                      className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-full cursor-pointer hover:bg-blue-100"
                    >
                      בחר הכל ({unsentGuests.length})
                    </button>
                    <button
                      onClick={() => setSelectedGuestIds(new Set())}
                      className="text-xs px-3 py-1 bg-gray-100 text-gray-600 rounded-full cursor-pointer hover:bg-gray-200"
                    >
                      בטל הכל
                    </button>
                    {selectedGuestIds.size > 0 && (
                      <span className="text-xs text-gold-600 font-medium self-center">
                        {selectedGuestIds.size} נבחרו
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {targetGuests.map((guest) => {
                    const msgType = getMessageType()
                    const sentSet = sentMessageIds[msgType] || new Set()
                    const wasSent = sentSet.has(guest.id)
                    const isSelected = selectedGuestIds.has(guest.id)

                    return (
                      <div
                        key={guest.id}
                        onClick={() => {
                          if (!manualSelection || wasSent) return
                          const newSet = new Set(selectedGuestIds)
                          isSelected ? newSet.delete(guest.id) : newSet.add(guest.id)
                          setSelectedGuestIds(newSet)
                        }}
                        className={`flex items-center justify-between py-2 border-b border-gray-50 last:border-0 ${wasSent ? 'opacity-50' : ''} ${manualSelection && !wasSent ? 'cursor-pointer hover:bg-gold-50 rounded-lg px-2 -mx-2' : ''} ${manualSelection && isSelected ? 'bg-gold-50' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          {manualSelection && !wasSent && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              readOnly
                              className="w-4 h-4 rounded border-gray-300 text-gold-500 focus:ring-gold-400"
                            />
                          )}
                          {wasSent && <span className="text-green-500 text-xs">✅</span>}
                          <div>
                            <p className={`font-medium ${wasSent ? 'text-gray-400' : 'text-gray-800'}`}>{guest.name}</p>
                            <p className="text-sm text-gray-500">{guest.phone}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {wasSent && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              נשלח ✓
                            </span>
                          )}
                          {guest.table_number && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              שולחן {guest.table_number}
                            </span>
                          )}
                          {(activeTab === 'pending' || activeTab === 'last_reminder') && guest.reminder_count > 0 && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                              {guest.reminder_count} תזכורות
                            </span>
                          )}
                          {guest.gift_description && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              🎁 {guest.gift_description}
                            </span>
                          )}
                          <Badge status={guest.rsvp_status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

    </div>
  )
}
