import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseExpensesExcel } from '../lib/excelParser'
import { sendMessage, checkWhatsApp, sendTyping } from '../lib/whatsapp'
import {
  canSendNow, calculateDelay, incrementCounters, recordSend, recordFail,
  syncCountersFromSupabase, applyMessageVariation,
  acquireSendingLock, releaseSendingLock, refreshSendingLock,
  getTypingDelay, shouldCheckNumbers, getSafetyConfig,
} from '../lib/antiBlock'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import StatsCard from '../components/ui/StatsCard'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const THANK_YOU_STORAGE_KEY = (eventId) => `thank_you_sent_${eventId}`
// ממוצע 12 דקות (5/שעה) עם וריאציה אקראית בין 8–18 דקות
const getThankYouDelay = () => (8 + Math.random() * 10) * 60 * 1000

const DEFAULT_TEMPLATE = `{שם} תודה 🥰,

תודה רבה מקרב לב! 💛
השתתפותך בחגיגת בת המצווה של מעיין שימחה אותנו מאוד והייתה עבורנו מתנה אמיתית ✨
תודה על תשומת הלב ועל המתנה שהענקת 🎁

שמחנו מאוד לראותך, ומקווים שניפגש ונחגוג יחד בשמחות נוספות 🎉💛

משפחת עזורה 💛🤗`

const getNextSafeStart = (config) => {
  const now = new Date()
  const safeStart = new Date(now)
  safeStart.setHours(config.safeStartHour, config.safeStartMinute || 0, 0, 0)
  if (now >= safeStart) return null // already in safe window
  return safeStart
}

const isSafeHoursNow = (config) => {
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = config.safeStartHour * 60 + (config.safeStartMinute || 0)
  const end = config.safeEndHour * 60 + (config.safeEndMinute || 0)
  return cur >= start && cur < end
}

const CATEGORIES = [
  { key: 'venue', label: 'אולם', color: '#EF4444' },
  { key: 'catering', label: 'קייטרינג', color: '#F59E0B' },
  { key: 'dj', label: 'DJ/מוזיקה', color: '#8B5CF6' },
  { key: 'photo', label: 'צילום', color: '#3B82F6' },
  { key: 'design', label: 'עיצוב/פרחים', color: '#EC4899' },
  { key: 'print', label: 'הזמנות/דפוס', color: '#10B981' },
  { key: 'dress', label: 'שמלה/חליפה', color: '#F97316' },
  { key: 'jewelry', label: 'תכשיטים/אביזרים', color: '#06B6D4' },
  { key: 'transport', label: 'הסעות', color: '#6366F1' },
  { key: 'favors', label: 'מתנות לאורחים', color: '#84CC16' },
  { key: 'other', label: 'שונות', color: '#6B7280' },
]

function getCategoryInfo(key) {
  return CATEGORIES.find(c => c.key === key) || { key, label: key, color: '#A855F7' }
}

// --- Pie Chart Component (pure SVG) ---
function PieChart({ data }) {
  if (!data || data.length === 0) return null

  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) return null

  const size = 200
  const cx = size / 2
  const cy = size / 2
  const r = 80

  let currentAngle = -Math.PI / 2
  const slices = data.map(d => {
    const angle = (d.value / total) * 2 * Math.PI
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    currentAngle = endAngle

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = angle > Math.PI ? 1 : 0

    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    return { ...d, path, percent: Math.round((d.value / total) * 100) }
  })

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />
        ))}
      </svg>
      <div className="flex flex-col gap-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-gray-700">{s.label}</span>
            <span className="text-gray-400 mr-auto">({s.percent}%)</span>
            <span className="font-medium text-gray-800">{s.value.toLocaleString('he-IL')} ₪</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FinancesPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [editingGiftAmount, setEditingGiftAmount] = useState(null)
  const [giftAmountInput, setGiftAmountInput] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [showThankYouModal, setShowThankYouModal] = useState(false)
  const [thankYouTemplate, setThankYouTemplate] = useState('')
  const [thankYouSent, setThankYouSent] = useState({})
  const [thankYouProgress, setThankYouProgress] = useState(null)
  const [isSendingThankYou, setIsSendingThankYou] = useState(false)
  const [thankYouWaitInfo, setThankYouWaitInfo] = useState(null)
  const [thankYouScheduledFor, setThankYouScheduledFor] = useState(null)
  const [thankYouCountdown, setThankYouCountdown] = useState(0)
  const stopSendingRef = useRef(false)
  const countdownRef = useRef(null)
  const excelInputRef = useRef(null)
  const [form, setForm] = useState({
    category: 'venue',
    customCategory: '',
    description: '',
    amount: '',
    paid: false,
    notes: '',
  })

  useEffect(() => {
    fetchData()
  }, [id])

  useEffect(() => {
    if (id) {
      const stored = JSON.parse(localStorage.getItem(THANK_YOU_STORAGE_KEY(id)) || '{}')
      setThankYouSent(stored)
    }
  }, [id])

  const markThankYouSent = (guestId) => {
    setThankYouSent(prev => {
      const updated = { ...prev, [guestId]: new Date().toISOString() }
      localStorage.setItem(THANK_YOU_STORAGE_KEY(id), JSON.stringify(updated))
      return updated
    })
  }

  const applyTemplate = (template, guestName) => {
    const firstName = guestName.split(' ')[0]
    return template.replace(/\{שם\}/g, firstName).replace(/\{שם_מלא\}/g, guestName)
  }

  const handleOpenThankYouModal = () => {
    if (!thankYouTemplate) setThankYouTemplate(DEFAULT_TEMPLATE)
    setShowThankYouModal(true)
  }

  const startCountdown = (targetTime) => {
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      const secsLeft = Math.max(0, Math.round((targetTime - Date.now()) / 1000))
      setThankYouCountdown(secsLeft)
      if (secsLeft <= 0) clearInterval(countdownRef.current)
    }, 1000)
  }

  const handleSendSingleThankYou = async (guest) => {
    if (!guest.phone) return alert(`לא נמצא מספר טלפון עבור ${guest.name}`)
    const template = thankYouTemplate || DEFAULT_TEMPLATE
    const msg = applyMessageVariation(applyTemplate(template, guest.name), 0)
    try {
      if (shouldCheckNumbers()) {
        const check = await checkWhatsApp(guest.phone)
        if (check.checked && !check.exists) return alert(`${guest.name} — מספר לא קיים בוואטסאפ`)
      }
      const typingMs = getTypingDelay()
      if (typingMs > 0) {
        await sendTyping(guest.phone)
        await new Promise(r => setTimeout(r, typingMs))
      }
      await sendMessage(guest.phone, msg)
      incrementCounters()
      recordSend('thank_you')
      markThankYouSent(guest.id)
    } catch (err) {
      recordFail('thank_you')
      alert(`שגיאה בשליחה ל-${guest.name}: ${err.message}`)
    }
  }

  const handleSendBulkThankYou = async (guestsToSend) => {
    if (!acquireSendingLock()) {
      alert('שליחה כבר פעילה בטאב אחר. סגור את הטאב האחר ונסה שנית.')
      return
    }

    await syncCountersFromSupabase()
    stopSendingRef.current = false

    const config = getSafetyConfig()
    setIsSendingThankYou(true)
    setThankYouScheduledFor(null)
    setThankYouWaitInfo(null)
    setThankYouProgress({ current: 0, total: guestsToSend.length, currentName: '', errors: [], nextDelay: 0 })
    const template = thankYouTemplate || DEFAULT_TEMPLATE

    for (let i = 0; i < guestsToSend.length; i++) {
      if (stopSendingRef.current) break

      const guest = guestsToSend[i]
      setThankYouProgress(p => ({ ...p, current: i, currentName: guest.name, nextDelay: 0 }))

      if (!guest.phone) {
        setThankYouProgress(p => ({ ...p, errors: [...p.errors, `${guest.name} — חסר טלפון`] }))
        continue
      }

      if (shouldCheckNumbers()) {
        const check = await checkWhatsApp(guest.phone)
        if (check.checked && !check.exists) {
          setThankYouProgress(p => ({ ...p, errors: [...p.errors, `${guest.name} — מספר לא קיים בוואטסאפ`] }))
          continue
        }
      }

      try {
        const msg = applyMessageVariation(applyTemplate(template, guest.name), i)
        const typingMs = getTypingDelay()
        if (typingMs > 0) {
          await sendTyping(guest.phone)
          await new Promise(r => setTimeout(r, typingMs))
        }
        await sendMessage(guest.phone, msg)
        incrementCounters()
        recordSend('thank_you')
        markThankYouSent(guest.id)
        refreshSendingLock()
      } catch (err) {
        recordFail('thank_you')
        setThankYouProgress(p => ({ ...p, errors: [...p.errors, `${guest.name} — ${err.message}`] }))
      }

      if (i < guestsToSend.length - 1 && !stopSendingRef.current) {
        // שעות בטוחות → קצב רגיל של antiBlock | מחוץ → 8–18 דקות אקראי
        const delay = isSafeHoursNow(config) ? calculateDelay(i, guestsToSend.length) : getThankYouDelay()
        const delayEnd = Date.now() + delay
        startCountdown(delayEnd)
        setThankYouProgress(p => ({ ...p, nextDelay: Math.ceil(delay / 1000) }))
        while (!stopSendingRef.current && Date.now() < delayEnd) {
          await new Promise(r => setTimeout(r, 5000))
          refreshSendingLock()
          setThankYouProgress(p => ({ ...p, nextDelay: Math.max(0, Math.round((delayEnd - Date.now()) / 1000)) }))
        }
        clearInterval(countdownRef.current)
      }
    }

    releaseSendingLock()
    clearInterval(countdownRef.current)
    setThankYouProgress(p => ({ ...p, current: guestsToSend.length, currentName: '', nextDelay: 0 }))
    setIsSendingThankYou(false)
  }

  const fetchData = async () => {
    const [eventRes, expensesRes, guestsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('expenses').select('*').eq('event_id', id).order('created_at'),
      supabase.from('guests').select('*').eq('event_id', id),
    ])
    setEvent(eventRes.data)
    setExpenses(expensesRes.data || [])
    setGuests(guestsRes.data || [])
    setLoading(false)
  }

  const resetForm = () => {
    setForm({ category: 'venue', customCategory: '', description: '', amount: '', paid: false, notes: '' })
    setEditingExpense(null)
  }

  const handleSaveExpense = async (e) => {
    e.preventDefault()
    const category = form.category === '__custom' ? form.customCategory.trim() : form.category
    if (!category) return alert('יש לבחור קטגוריה')
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) return alert('יש להזין סכום תקין')

    const record = {
      event_id: id,
      category,
      description: form.description.trim() || null,
      amount,
      paid: form.paid,
      notes: form.notes.trim() || null,
    }

    if (editingExpense) {
      await supabase.from('expenses').update(record).eq('id', editingExpense)
    } else {
      await supabase.from('expenses').insert([record])
    }

    setShowAddModal(false)
    resetForm()
    fetchData()
  }

  const handleEditExpense = (expense) => {
    const isCustom = !CATEGORIES.some(c => c.key === expense.category)
    setForm({
      category: isCustom ? '__custom' : expense.category,
      customCategory: isCustom ? expense.category : '',
      description: expense.description || '',
      amount: expense.amount.toString(),
      paid: expense.paid || false,
      notes: expense.notes || '',
    })
    setEditingExpense(expense.id)
    setShowAddModal(true)
  }

  const handleDeleteExpense = async (expenseId) => {
    if (!confirm('למחוק הוצאה זו?')) return
    await supabase.from('expenses').delete().eq('id', expenseId)
    fetchData()
  }

  const handleTogglePaid = async (expense) => {
    await supabase.from('expenses').update({ paid: !expense.paid }).eq('id', expense.id)
    setExpenses(expenses.map(e => e.id === expense.id ? { ...e, paid: !e.paid } : e))
  }

  const handleSetGiftAmount = async (guestId) => {
    const amount = parseFloat(giftAmountInput) || 0
    await supabase.from('guests').update({ gift_amount: amount }).eq('id', guestId)
    setGuests(guests.map(g => g.id === guestId ? { ...g, gift_amount: amount } : g))
    setEditingGiftAmount(null)
    setGiftAmountInput('')
  }

  const handleImportExcel = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    try {
      const parsed = await parseExpensesExcel(file)

      // Deduplicate: skip rows that already exist (same description + amount)
      const existingSet = new Set(
        expenses.map(ex => `${(ex.description || '').trim().toLowerCase()}|${Number(ex.amount)}`)
      )

      const newExpenses = parsed.filter(p =>
        !existingSet.has(`${p.description.trim().toLowerCase()}|${p.amount}`)
      )

      if (newExpenses.length === 0) {
        setImportResult({ added: 0, skipped: parsed.length, total: parsed.length })
        setTimeout(() => setImportResult(null), 4000)
        return
      }

      const toInsert = newExpenses.map(ex => ({
        event_id: id,
        category: ex.category,
        description: ex.description,
        amount: ex.amount,
        paid: false,
      }))

      const { error } = await supabase.from('expenses').insert(toInsert)
      if (error) throw error

      setImportResult({ added: newExpenses.length, skipped: parsed.length - newExpenses.length, total: parsed.length })
      setTimeout(() => setImportResult(null), 5000)
      fetchData()
    } catch (err) {
      alert(err.message || 'שגיאה בטעינת הקובץ')
    }
  }

  if (loading) return <LoadingSpinner />
  if (!event) return <p className="text-center text-gray-500 mt-8">אירוע לא נמצא</p>

  // Calculations
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const totalPaid = expenses.filter(e => e.paid).reduce((sum, e) => sum + Number(e.amount), 0)
  const guestsWithGifts = guests.filter(g => (g.gift_amount && g.gift_amount > 0) || g.gift_description)
  const totalIncome = guests.reduce((sum, g) => sum + (Number(g.gift_amount) || 0), 0)
  const balance = totalIncome - totalExpenses

  // Pie chart data — aggregate by category
  const categoryTotals = {}
  expenses.forEach(e => {
    if (!categoryTotals[e.category]) categoryTotals[e.category] = 0
    categoryTotals[e.category] += Number(e.amount)
  })
  const pieData = Object.entries(categoryTotals)
    .filter(([, val]) => val > 0)
    .map(([cat, val]) => ({
      label: getCategoryInfo(cat).label,
      value: val,
      color: getCategoryInfo(cat).color,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/events" className="hover:text-gold-600">אירועים</Link>
        <span>/</span>
        <Link to={`/events/${id}`} className="hover:text-gold-600">{event.name}</Link>
        <span>/</span>
        <span className="text-gray-800">הוצאות והכנסות</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-800">💰 הוצאות והכנסות</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard label="סה״כ הוצאות" value={`${totalExpenses.toLocaleString('he-IL')} ₪`} icon="💸" color="red" />
        <StatsCard label="שולם" value={`${totalPaid.toLocaleString('he-IL')} ₪`} icon="✅" color="gold" />
        <StatsCard label="סה״כ הכנסות" value={`${totalIncome.toLocaleString('he-IL')} ₪`} icon="🎁" color="green" />
        <StatsCard
          label={balance >= 0 ? 'רווח' : 'הפסד'}
          value={`${Math.abs(balance).toLocaleString('he-IL')} ₪`}
          icon={balance >= 0 ? '📈' : '📉'}
          color={balance >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Pie Chart */}
      {pieData.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">📊 הוצאות לפי קטגוריה</h2>
          <PieChart data={pieData} />
        </Card>
      )}

      {/* Expenses Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">📋 הוצאות ({expenses.length})</h2>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => excelInputRef.current?.click()}>
              📄 טען מאקסל
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setShowAddModal(true) }}>
              + הוסף הוצאה
            </Button>
          </div>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportExcel}
            className="hidden"
          />
        </div>

        {importResult && (
          <div className={`text-sm px-4 py-2 rounded-lg mb-4 ${importResult.added > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {importResult.added > 0
              ? `✅ נטענו ${importResult.added} הוצאות חדשות${importResult.skipped > 0 ? ` (${importResult.skipped} כפילויות דולגו)` : ''}`
              : `⚠️ כל ${importResult.total} ההוצאות כבר קיימות — לא נוספו כפילויות`}
          </div>
        )}

        {expenses.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-4xl mb-3">💸</p>
            <p className="text-gray-500">עדיין לא הוספת הוצאות</p>
            <Button className="mt-4" onClick={() => { resetForm(); setShowAddModal(true) }}>
              + הוסף הוצאה ראשונה
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">קטגוריה</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">תיאור</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">סכום</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">שולם</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">הערות</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => {
                  const catInfo = getCategoryInfo(expense.category)
                  return (
                    <tr key={expense.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: catInfo.color }} />
                          <span className="text-gray-800">{catInfo.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-2 text-gray-600">{expense.description || '—'}</td>
                      <td className="py-3 px-2 font-medium text-gray-800">{Number(expense.amount).toLocaleString('he-IL')} ₪</td>
                      <td className="py-3 px-2">
                        <button
                          onClick={() => handleTogglePaid(expense)}
                          className={`cursor-pointer text-lg ${expense.paid ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}
                          title={expense.paid ? 'שולם — לחץ לביטול' : 'לא שולם — לחץ לסימון'}
                        >
                          {expense.paid ? '✅' : '⬜'}
                        </button>
                      </td>
                      <td className="py-3 px-2 text-gray-400 text-xs max-w-32 truncate">{expense.notes || ''}</td>
                      <td className="py-3 px-2">
                        <div className="flex gap-1">
                          <button onClick={() => handleEditExpense(expense)} className="text-gray-400 hover:text-gold-600 cursor-pointer" title="ערוך">✏️</button>
                          <button onClick={() => handleDeleteExpense(expense.id)} className="text-gray-400 hover:text-red-500 cursor-pointer" title="מחק">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-gray-50 font-medium">
                  <td className="py-3 px-2 text-gray-700">סה״כ</td>
                  <td></td>
                  <td className="py-3 px-2 text-gray-800">{totalExpenses.toLocaleString('he-IL')} ₪</td>
                  <td className="py-3 px-2 text-green-600 text-xs">{totalPaid.toLocaleString('he-IL')} ₪ שולם</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Income / Gifts Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            🎁 הכנסות — מתנות ({guestsWithGifts.length})
          </h2>
          {guestsWithGifts.length > 0 && (
            <Button size="sm" onClick={handleOpenThankYouModal}>
              💌 שלח הודעות תודה
            </Button>
          )}
        </div>

        {guestsWithGifts.length === 0 && totalIncome === 0 ? (
          <p className="text-center text-gray-400 py-6">עדיין לא נרשמו מתנות. רשום סכומים ליד כל אורח.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">שם אורח</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">סטטוס</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">סכום (₪)</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">תיאור</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">תודה</th>
                </tr>
              </thead>
              <tbody>
                {guestsWithGifts.map((guest) => (
                  <tr key={guest.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-3 px-2 font-medium text-gray-800">{guest.name}</td>
                    <td className="py-3 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        guest.rsvp_status === 'attending' ? 'bg-green-100 text-green-700' :
                        guest.rsvp_status === 'not_attending' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {guest.rsvp_status === 'attending' ? 'מגיע' : guest.rsvp_status === 'not_attending' ? 'לא מגיע' : 'ממתין'}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      {editingGiftAmount === guest.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={giftAmountInput}
                            onChange={(e) => setGiftAmountInput(e.target.value)}
                            className="w-20 px-2 py-0.5 border border-gray-300 rounded text-sm text-center"
                            min="0"
                            placeholder="0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSetGiftAmount(guest.id)
                              if (e.key === 'Escape') { setEditingGiftAmount(null); setGiftAmountInput('') }
                            }}
                          />
                          <span className="text-xs text-gray-400">₪</span>
                          <button onClick={() => handleSetGiftAmount(guest.id)} className="text-green-500 cursor-pointer text-xs">✓</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingGiftAmount(guest.id); setGiftAmountInput((guest.gift_amount || 0).toString()) }}
                          className={`cursor-pointer text-sm font-medium ${guest.gift_amount > 0 ? 'text-green-600' : 'text-gray-400 hover:text-gold-600'}`}
                        >
                          {guest.gift_amount > 0 ? `${Number(guest.gift_amount).toLocaleString('he-IL')} ₪` : '—'}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2 text-gray-500 text-xs">{guest.gift_description || ''}</td>
                    <td className="py-3 px-2">
                      {thankYouSent[guest.id] ? (
                        <span className="text-xs text-green-600" title={`נשלח ב-${new Date(thankYouSent[guest.id]).toLocaleDateString('he-IL')}`}>✅ נשלח</span>
                      ) : (
                        <button
                          onClick={() => handleSendSingleThankYou(guest)}
                          className="text-xs text-gold-600 hover:text-gold-700 cursor-pointer underline underline-offset-2"
                          title="שלח הודעת תודה"
                        >
                          💌 שלח
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {totalIncome > 0 && (
                  <tr className="bg-green-50 font-medium">
                    <td className="py-3 px-2 text-green-700">סה״כ הכנסות</td>
                    <td></td>
                    <td className="py-3 px-2 text-green-700">{totalIncome.toLocaleString('he-IL')} ₪</td>
                    <td></td>
                    <td className="py-3 px-2 text-xs text-green-600">
                      {Object.keys(thankYouSent).length} נשלחו
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Thank You Modal */}
      <Modal
        isOpen={showThankYouModal}
        onClose={() => { if (!isSendingThankYou) { setShowThankYouModal(false); setThankYouProgress(null) } }}
        title="💌 שליחת הודעות תודה"
      >
        <div className="space-y-4" dir="rtl">
          {/* Template editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">נסח את ההודעה:</p>
              <span className="text-xs text-gray-400">השתמש ב-{'{שם}'} לשם פרטי, {'{שם_מלא}'} לשם מלא</span>
            </div>
            <textarea
              value={thankYouTemplate}
              onChange={(e) => setThankYouTemplate(e.target.value)}
              disabled={isSendingThankYou}
              rows={10}
              className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm leading-relaxed resize-y font-light"
              placeholder="כתוב כאן את הודעת התודה שלך..."
              dir="rtl"
            />
          </div>

          {/* Stats */}
          {!thankYouProgress && (
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-gray-50 rounded-lg py-3">
                <p className="text-2xl font-semibold text-gray-800">{guestsWithGifts.length}</p>
                <p className="text-xs text-gray-500 mt-0.5">סה״כ משלמים</p>
              </div>
              <div className="bg-green-50 rounded-lg py-3">
                <p className="text-2xl font-semibold text-green-700">{Object.keys(thankYouSent).length}</p>
                <p className="text-xs text-gray-500 mt-0.5">כבר נשלחו</p>
              </div>
              <div className="bg-amber-50 rounded-lg py-3">
                <p className="text-2xl font-semibold text-amber-700">
                  {guestsWithGifts.filter(g => !thankYouSent[g.id]).length}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">ממתינים לשליחה</p>
              </div>
            </div>
          )}

          {/* Progress */}
          {thankYouProgress && (
            <div className="space-y-3">
              {thankYouWaitInfo ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <p className="font-medium">⏸ ממתין לחלון שליחה</p>
                  <p className="text-xs mt-1">{thankYouWaitInfo.reason}</p>
                  {thankYouWaitInfo.until && (
                    <p className="text-xs mt-1">ימשיך ב: <span className="font-medium">{new Date(thankYouWaitInfo.until).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span></p>
                  )}
                  <p className="text-lg font-semibold text-amber-700 mt-2 tabular-nums">
                    {Math.floor(thankYouCountdown / 60).toString().padStart(2, '0')}:{(thankYouCountdown % 60).toString().padStart(2, '0')}
                  </p>
                </div>
              ) : isSendingThankYou && thankYouProgress.currentName ? (
                <p className="text-sm text-gray-600">שולח ל: <span className="font-medium">{thankYouProgress.currentName}</span></p>
              ) : null}

              <div className="flex justify-between text-sm text-gray-600">
                <span>
                  {!isSendingThankYou ? 'השליחה הסתיימה' :
                   thankYouProgress.nextDelay > 0
                     ? `המתנה ${Math.floor(thankYouProgress.nextDelay / 60)}:${String(thankYouProgress.nextDelay % 60).padStart(2,'0')} לפני ההודעה הבאה`
                     : 'שולח...'}
                </span>
                <span>{thankYouProgress.current} / {thankYouProgress.total}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(thankYouProgress.current / thankYouProgress.total) * 100}%` }}
                />
              </div>
              {thankYouProgress.errors.length > 0 && (
                <div className="bg-red-50 rounded-lg p-3 text-xs text-red-600 space-y-0.5">
                  {thankYouProgress.errors.map((e, i) => <p key={i}>⚠️ {e}</p>)}
                </div>
              )}
              {!isSendingThankYou && (
                <p className="text-sm text-green-700 font-medium text-center">
                  ✅ נשלחו {thankYouProgress.current - thankYouProgress.errors.length} הודעות בהצלחה
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            {!isSendingThankYou && !thankYouProgress && (
              <>
                <Button variant="secondary" onClick={() => setShowThankYouModal(false)}>ביטול</Button>
                {Object.keys(thankYouSent).length > 0 && guestsWithGifts.filter(g => !thankYouSent[g.id]).length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => handleSendBulkThankYou(guestsWithGifts.filter(g => !thankYouSent[g.id]))}
                  >
                    שלח רק לחדשים ({guestsWithGifts.filter(g => !thankYouSent[g.id]).length})
                  </Button>
                )}
                <Button onClick={() => handleSendBulkThankYou(guestsWithGifts)}>
                  שלח לכולם ({guestsWithGifts.length})
                </Button>
              </>
            )}
            {isSendingThankYou && (
              <Button variant="secondary" onClick={() => { stopSendingRef.current = true }}>
                עצור שליחה
              </Button>
            )}
            {!isSendingThankYou && thankYouProgress && (
              <Button onClick={() => { setShowThankYouModal(false); setThankYouProgress(null) }}>סגור</Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Add/Edit Expense Modal */}
      <Modal isOpen={showAddModal} onClose={() => { setShowAddModal(false); resetForm() }} title={editingExpense ? 'עריכת הוצאה' : 'הוספת הוצאה'}>
        <form onSubmit={handleSaveExpense} className="space-y-4" dir="rtl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">קטגוריה</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm"
            >
              {CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
              <option value="__custom">אחר (מותאם אישית)</option>
            </select>
          </div>

          {form.category === '__custom' && (
            <Input
              label="שם קטגוריה"
              placeholder="הקלד שם קטגוריה"
              value={form.customCategory}
              onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
              required
            />
          )}

          <Input
            label="תיאור"
            placeholder="למשל: חבילת צילום 5 שעות"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <Input
            label="סכום (₪)"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="paid"
              checked={form.paid}
              onChange={(e) => setForm({ ...form, paid: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-gold-500 focus:ring-gold-400"
            />
            <label htmlFor="paid" className="text-sm text-gray-700">שולם</label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערות</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm resize-y"
              placeholder="הערות נוספות..."
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => { setShowAddModal(false); resetForm() }}>ביטול</Button>
            <Button type="submit">{editingExpense ? 'שמור' : 'הוסף'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
