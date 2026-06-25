import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { sendImage, getSiteBaseUrl, shortenUrl, checkWhatsApp, sendTyping, clearMessagesQueue } from '../lib/whatsapp'
import {
  canSendNow, calculateDelay, incrementCounters, recordSend, recordFail,
  syncCountersFromSupabase, planBatchSchedule, getRemainingQuota, getSafetyConfig,
  applyMessageVariation, acquireSendingLock, releaseSendingLock, refreshSendingLock,
  savePendingBatch, getPendingBatch, clearPendingBatch,
  getTypingDelay, shouldCheckNumbers,
} from '../lib/antiBlock'
import SendingDashboard from '../components/SendingDashboard'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const DEFAULT_MESSAGE = `שלום {שם}! 🎉

שמחים להזמינך ל{שם_אירוע}!

מצורפת בזאת ההזמנה.

👇 *לאישור הגעתכם / אי הגעתכם:*
{קישור_אישור}

{קישור_מיקום}`

function SendPreview({ guest, buildMessage }) {
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
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs font-medium text-gray-500 mb-2">תצוגה מקדימה (לדוגמה: {guest.name}):</p>
      <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans" dir="auto">{text}</pre>
    </div>
  )
}

export default function SendPage() {
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [guests, setGuests] = useState([])
  const [sentGuestIds, setSentGuestIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0 })
  const [sendTo, setSendTo] = useState('not_sent')
  const [log, setLog] = useState([])
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_MESSAGE)
  const [nextDelay, setNextDelay] = useState(0)
  const [waitInfo, setWaitInfo] = useState(null)
  const [pendingResume, setPendingResume] = useState(null)
  const [autoResumeIn, setAutoResumeIn] = useState(0)
  const [resumeTargets, setResumeTargets] = useState(null)
  const abortRef = useRef(false)
  const lockIntervalRef = useRef(null)

  useEffect(() => {
    fetchEvents()
    syncCountersFromSupabase()
    // Check for pending batch to auto-resume
    const pending = getPendingBatch()
    if (pending && pending.page === 'send') {
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
      supabase.from('messages').select('guest_id').eq('event_id', event.id).eq('type', 'invitation').eq('status', 'sent'),
    ])

    const allGuests = guestsRes.data || []
    const sentSet = new Set((messagesRes.data || []).map(m => m.guest_id))
    const remainingSet = new Set(pending.remainingGuestIds)
    const targets = allGuests.filter(g => remainingSet.has(g.id) && !sentSet.has(g.id))

    if (targets.length === 0) { clearPendingBatch(); return }

    await syncCountersFromSupabase()
    clearPendingBatch()

    setSelectedEvent(event)
    if (pending.messageTemplate) setMessageTemplate(pending.messageTemplate)
    setGuests(allGuests)
    setSentGuestIds(sentSet)
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
      supabase.from('messages').select('guest_id').eq('event_id', event.id).eq('type', 'invitation').eq('status', 'sent'),
    ])

    setGuests(guestsRes.data || [])
    setSentGuestIds(new Set((messagesRes.data || []).map((m) => m.guest_id)))
  }

  const getTargetGuests = () => {
    if (sendTo === 'all') return guests
    return guests.filter((g) => !sentGuestIds.has(g.id))
  }

  const getRsvpUrl = (token) => {
    return `${getSiteBaseUrl()}/rsvp/${token}`
  }

  const buildMessage = async (guest) => {
    const [shortRsvp, shortLocation] = await Promise.all([
      shortenUrl(getRsvpUrl(guest.rsvp_token)),
      selectedEvent.location_url ? shortenUrl(selectedEvent.location_url) : Promise.resolve(''),
    ])

    const locationText = shortLocation
      ? `קישור למיקום האירוע:\n${shortLocation}`
      : ''

    const replacements = {
      '{שם}': guest.name,
      '{שם_אירוע}': selectedEvent.name,
      '{קישור_אישור}': shortRsvp,
      '{קישור_מיקום}': locationText,
    }

    let msg = messageTemplate
    for (const [key, value] of Object.entries(replacements)) {
      msg = msg.split(key).join(value)
    }

    return msg.trim()
  }

  const handleSend = async () => {
    if (!selectedEvent?.invitation_url) {
      alert('לא הועלתה תמונת הזמנה לאירוע זה. עבור לעמוד האירוע והעלה תמונה.')
      return
    }

    const targets = getTargetGuests()
    if (targets.length === 0) {
      alert('אין מוזמנים לשליחה')
      return
    }

    // Check if we can send right now
    const sendCheck = canSendNow()
    const plan = planBatchSchedule(targets.length)
    const config = getSafetyConfig()
    const avgDelay = (config.minDelay + config.maxDelay) / 2

    if (!sendCheck.allowed) {
      // Outside safe hours or quota full — offer to schedule for next window
      const waitTimeStr = sendCheck.waitUntil
        ? sendCheck.waitUntil.toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
        : 'חלון השליחה הבא'
      const scheduleMsg = `${sendCheck.reason}\n\nהשליחה תתחיל אוטומטית ב-${waitTimeStr}.\nלתזמן את השליחה?`
      if (!confirm(scheduleMsg)) return

      // Save pending batch and show wait UI
      savePendingBatch({
        eventId: selectedEvent.id,
        remainingGuestIds: targets.map(g => g.id),
        type: 'invitation',
        page: 'send',
        messageTemplate: messageTemplate,
      })
      setWaitInfo({
        reason: sendCheck.reason,
        until: sendCheck.waitUntil,
        remaining: targets.length,
      })
      setSending(true)
      setPaused(true)

      // Start a background wait loop
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
        // Window opened — clear wait state and start sending
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

    // Can send now — show confirmation
    const estimatedMinutes = Math.ceil((Math.min(targets.length, config.dailyLimit) * avgDelay) / 60)

    let confirmMsg = `לשלוח הזמנות ל-${targets.length} מוזמנים?\n\nזמן משוער: כ-${estimatedMinutes} דקות`
    if (plan.needsSplit) {
      confirmMsg += `\n\n⚠️ המכסה היומית (${config.dailyLimit}) לא מספיקה — השליחה תפוצל ל-${plan.totalDays} ימים.`
      confirmMsg += `\nהיום יישלחו ${plan.batches[0].count} הודעות.`
    }

    if (!confirm(confirmMsg)) {
      return
    }

    startSending(targets)
  }

  const startSending = async (targets) => {
    // Acquire sending lock (prevent dual-tab)
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

    // Refresh lock every 30 seconds
    lockIntervalRef.current = setInterval(refreshSendingLock, 30000)

    for (let i = 0; i < targets.length; i++) {
      const guest = targets[i]

      if (abortRef.current) {
        const remaining = targets.slice(i)
        if (remaining.length > 0) {
          savePendingBatch({
            eventId: selectedEvent.id,
            remainingGuestIds: remaining.map(g => g.id),
            type: 'invitation',
            page: 'send',
            messageTemplate,
          })
          setLog((l) => [...l, { name: 'מערכת', status: 'info', error: `השליחה הופסקה. ${remaining.length} הודעות נשמרו להמשך.` }])
        }
        break
      }

      // Check rate limits before each message
      const sendCheck = canSendNow()
      if (!sendCheck.allowed) {
        // Save backup in case browser/tab closes
        const remaining = targets.slice(i)
        savePendingBatch({
          eventId: selectedEvent.id,
          remainingGuestIds: remaining.map(g => g.id),
          type: 'invitation',
          page: 'send',
          messageTemplate,
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

        // Wait loop — check every 30 seconds until allowed or aborted
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

        // Window opened — clear backup, sync counters, continue
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

        let caption = await buildMessage(guest)
        // Apply message variation for anti-spam
        caption = applyMessageVariation(caption, i)

        // Step 2: Send "typing..." indicator + built-in typingTime
        const typingMs = getTypingDelay()
        if (typingMs > 0) {
          await sendTyping(guest.phone)
          await new Promise((r) => setTimeout(r, typingMs))
        }

        // Step 3: Send the actual message with typingTime parameter
        // This shows "typing..." in recipient's chat before message arrives
        const builtinTyping = Math.min(Math.max(1000, Math.round(typingMs * 0.7)), 20000)
        await sendImage(guest.phone, selectedEvent.invitation_url, caption, builtinTyping)

        await supabase.from('messages').insert([{
          event_id: selectedEvent.id,
          guest_id: guest.id,
          type: 'invitation',
          status: 'sent',
          sent_at: new Date().toISOString(),
        }])

        // Update anti-block counters
        incrementCounters()
        recordSend('invitation')

        setSentGuestIds((prev) => new Set([...prev, guest.id]))
        setProgress((p) => ({ ...p, sent: p.sent + 1 }))
        setLog((l) => [...l, { name: guest.name, status: 'sent' }])
      } catch (err) {
        await supabase.from('messages').insert([{
          event_id: selectedEvent.id,
          guest_id: guest.id,
          type: 'invitation',
          status: 'failed',
          sent_at: new Date().toISOString(),
        }])

        recordFail('invitation')

        setProgress((p) => ({ ...p, failed: p.failed + 1 }))
        setLog((l) => [...l, { name: guest.name, status: 'failed', error: err.message }])
      }

      // Progressive delay based on anti-block engine
      if (i < targets.length - 1) {
        const delay = calculateDelay(i, targets.length)
        setNextDelay(Math.ceil(delay / 1000))
        await new Promise((r) => setTimeout(r, delay))
        setNextDelay(0)
      }
    }

    // Cleanup
    clearInterval(lockIntervalRef.current)
    releaseSendingLock()
    setSending(false)
  }

  const handleStop = () => {
    abortRef.current = true
  }

  const openRsvpPreview = () => {
    window.open(`/rsvp/preview/${selectedEvent.id}`, '_blank')
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">שליחת הזמנות</h1>

      {pendingResume && !sending && (
        <Card className="border-2 border-blue-300 bg-blue-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-blue-800">
                📋 יש {pendingResume.remainingGuestIds.length} הודעות שלא נשלחו
              </p>
              <p className="text-sm text-blue-600 mt-1">
                {autoResumeIn > 0
                  ? `ממשיך אוטומטית בעוד ${autoResumeIn} שניות...`
                  : 'מחדש שליחה...'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleAutoResume(pendingResume)}>▶️ המשך עכשיו</Button>
              <Button variant="secondary" size="sm" onClick={dismissPending}>✖ בטל</Button>
            </div>
          </div>
        </Card>
      )}

      {!selectedEvent ? (
        <div>
          <p className="text-gray-500 mb-4">בחר אירוע לשליחת הזמנות:</p>
          <div className="grid gap-4 md:grid-cols-2">
            {events.map((event) => (
              <Card
                key={event.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
              >
                <div onClick={() => selectEvent(event)}>
                  <h3 className="font-semibold text-gray-800">{event.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(event.event_date).toLocaleDateString('he-IL')}
                  </p>
                  {!event.invitation_url && (
                    <p className="text-xs text-red-400 mt-1">⚠️ לא הועלתה הזמנה</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
          {events.length === 0 && (
            <Card>
              <p className="text-center text-gray-400 py-4">
                אין אירועים. צור אירוע קודם בעמוד האירועים.
              </p>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">{selectedEvent.name}</h2>
              <p className="text-sm text-gray-500">
                {guests.length} מוזמנים
                {sentGuestIds.size > 0 && ` (${sentGuestIds.size} כבר קיבלו)`}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setSelectedEvent(null)}>
              ← חזור
            </Button>
          </div>

          {/* Sending Status Summary */}
          <Card className="border border-gray-200">
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-800 text-base">📊 סטטוס שליחה</h3>

              {/* Progress bar */}
              <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${guests.length > 0 ? (sentGuestIds.size / guests.length) * 100 : 0}%`,
                    backgroundColor: sentGuestIds.size === guests.length ? '#16a34a' : '#d97706',
                  }}
                />
              </div>

              {/* Stats row */}
              <div className="flex gap-4 flex-wrap text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span>
                  <span className="font-medium text-green-700">נשלחו: {sentGuestIds.size}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
                  <span className="font-medium text-amber-700">טרם נשלחו: {guests.length - sentGuestIds.size}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gray-400 inline-block"></span>
                  <span className="text-gray-600">סה״כ: {guests.length}</span>
                </div>
              </div>

              {/* Unsent guests list */}
              {guests.length - sentGuestIds.size > 0 && (
                <div className="mt-2 pt-3 border-t border-gray-100">
                  <p className="text-sm font-medium text-amber-800 mb-2">
                    📋 מוזמנים שטרם קיבלו הזמנה ({guests.length - sentGuestIds.size}):
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {guests
                      .filter(g => !sentGuestIds.has(g.id))
                      .map((g, idx) => (
                        <div key={g.id} className="flex items-center justify-between text-sm bg-amber-50 rounded-lg px-3 py-1.5">
                          <span className="font-medium text-gray-800">{idx + 1}. {g.name}</span>
                          <span className="text-gray-400 text-xs ltr" dir="ltr">{g.phone}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* All sent success message */}
              {guests.length > 0 && sentGuestIds.size === guests.length && (
                <div className="mt-2 pt-3 border-t border-gray-100">
                  <p className="text-sm text-green-700 font-medium">✅ כל ההזמנות נשלחו בהצלחה!</p>
                </div>
              )}
            </div>
          </Card>

          {selectedEvent.invitation_url && (
            <Card>
              <p className="text-sm text-gray-500 mb-2">תצוגה מקדימה של ההזמנה:</p>
              <img
                src={selectedEvent.invitation_url}
                alt="הזמנה"
                className="max-w-xs rounded-lg shadow-sm mx-auto"
              />
            </Card>
          )}

          <Card className="border-2 border-dashed border-gold-200 bg-gold-50/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-800">👁️ תצוגה מקדימה של דף אישור הגעה</p>
                <p className="text-sm text-gray-500 mt-1">ראה איך הדף ייראה למוזמנים לפני השליחה</p>
              </div>
              <Button variant="secondary" onClick={openRsvpPreview}>
                צפה בדוגמה
              </Button>
            </div>
          </Card>

          <Card>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  הודעה אישית (תצורף לתמונת ההזמנה):
                </label>
                <textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm resize-y"
                  dir="rtl"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שם}'} = שם המוזמן</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{שם_אירוע}'} = שם האירוע</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_אישור}'} = קישור לאישור הגעה</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{'{קישור_מיקום}'} = קישור Google Maps</span>
                </div>
              </div>

              {guests.length > 0 && (
                <SendPreview guest={guests[0]} buildMessage={buildMessage} />
              )}

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">שלח ל:</p>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sendTo"
                      value="not_sent"
                      checked={sendTo === 'not_sent'}
                      onChange={(e) => setSendTo(e.target.value)}
                    />
                    <span className="text-sm">מי שעוד לא קיבל ({guests.length - sentGuestIds.size})</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="sendTo"
                      value="all"
                      checked={sendTo === 'all'}
                      onChange={(e) => setSendTo(e.target.value)}
                    />
                    <span className="text-sm">כולם ({guests.length})</span>
                  </label>
                </div>
              </div>

              <SendingDashboard
                totalToSend={getTargetGuests().length}
                isSending={sending}
                progress={progress}
                nextDelay={nextDelay}
                waitInfo={waitInfo}
              />

              <div className="flex gap-2">
                <Button
                  onClick={handleSend}
                  disabled={sending}
                  size="lg"
                  className="flex-1"
                >
                  {sending
                    ? paused
                      ? '⏸️ ממתין...'
                      : `שולח... (${progress.sent + progress.failed}/${progress.total})`
                    : `💬 שלח הזמנות (${getTargetGuests().length} מוזמנים)`}
                </Button>
                {sending && (
                  <Button variant="danger" size="lg" onClick={handleStop}>
                    ⏹️ עצור
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {(progress.sent > 0 || progress.failed > 0) && (
            <Card>
              <h3 className="font-semibold text-gray-800 mb-2">תוצאות שליחה</h3>
              <div className="flex gap-4 mb-4">
                <span className="text-green-600">✅ נשלחו: {progress.sent}</span>
                {progress.failed > 0 && (
                  <span className="text-red-600">❌ נכשלו: {progress.failed}</span>
                )}
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {log.map((entry, i) => (
                  <div
                    key={i}
                    className={`text-sm px-2 py-1 rounded ${
                      entry.status === 'sent' ? 'text-green-700'
                        : entry.status === 'info' ? 'text-blue-600 bg-blue-50'
                        : entry.status === 'skipped' ? 'text-amber-600 bg-amber-50'
                        : 'text-red-600'
                    }`}
                  >
                    {entry.status === 'sent' ? '✅' : entry.status === 'info' ? 'ℹ️' : entry.status === 'skipped' ? '⏭️' : '❌'} {entry.name}
                    {entry.error && ` - ${entry.error}`}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

    </div>
  )
}
