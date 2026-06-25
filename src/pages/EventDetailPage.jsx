import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseGuestExcel } from '../lib/excelParser'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import StatsCard from '../components/ui/StatsCard'

export default function EventDetailPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [guestForm, setGuestForm] = useState({ name: '', phone: '' })
  const [editForm, setEditForm] = useState({})
  const [uploading, setUploading] = useState(false)
  const [importCount, setImportCount] = useState(null)
  const [editingTable, setEditingTable] = useState(null)
  const [tableInput, setTableInput] = useState('')
  const [deleteAllStep, setDeleteAllStep] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [blessings, setBlessings] = useState([])
  const [editingChildren, setEditingChildren] = useState(null)
  const [childrenInput, setChildrenInput] = useState('')
  const [editingGift, setEditingGift] = useState(null)
  const [giftInput, setGiftInput] = useState('')
  const [editingName, setEditingName] = useState(null)
  const [nameInput, setNameInput] = useState('')
  const [showEventDayModal, setShowEventDayModal] = useState(false)
  const [eventDayCopied, setEventDayCopied] = useState(false)
  const fileInputRef = useRef(null)
  const excelInputRef = useRef(null)

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    const [eventRes, guestsRes, blessingsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('guests').select('*').eq('event_id', id).order('created_at'),
      supabase.from('blessings').select('*, guests(name)').eq('event_id', id).order('created_at'),
    ])
    setEvent(eventRes.data)
    setGuests(guestsRes.data || [])
    setBlessings(blessingsRes.data || [])
    setLoading(false)
  }

  const toLocalDatetimeString = (isoStr) => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const openEditModal = () => {
    setEditForm({
      name: event.name || '',
      event_date: toLocalDatetimeString(event.event_date),
      location: event.location || '',
      location_url: event.location_url || '',
      bit_link: event.bit_link || '',
      blessing_email: event.blessing_email || '',
    })
    setShowEditModal(true)
  }

  const isValidUrl = (url) => {
    if (!url) return true // empty is ok
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  }

  const handleEditEvent = async (e) => {
    e.preventDefault()

    // Validate URLs
    if (editForm.location_url && !isValidUrl(editForm.location_url)) {
      alert('קישור המיקום אינו תקין. הקישור צריך להתחיל ב-https://')
      return
    }
    if (editForm.bit_link && !isValidUrl(editForm.bit_link)) {
      alert('קישור BIT אינו תקין. הקישור צריך להתחיל ב-https://')
      return
    }

    const { error } = await supabase
      .from('events')
      .update({
        name: editForm.name.trim(),
        event_date: new Date(editForm.event_date).toISOString(),
        location: editForm.location?.trim() || '',
        location_url: editForm.location_url?.trim() || null,
        bit_link: editForm.bit_link?.trim() || null,
        blessing_email: editForm.blessing_email?.trim() || null,
      })
      .eq('id', id)

    if (error) {
      console.error('Event update error:', error)
      alert('שגיאה בעדכון האירוע. נסה שוב.')
      return
    }
    setEvent({ ...event, ...editForm })
    setShowEditModal(false)
  }

  const handleUploadInvitation = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // File size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      alert('הקובץ גדול מדי. גודל מקסימלי: 10MB')
      e.target.value = ''
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('יש להעלות קובץ תמונה בלבד (JPG, PNG, וכו\')')
      e.target.value = ''
      return
    }

    setUploading(true)

    try {
      const ext = file.name.split('.').pop()
      const path = `${id}/invitation.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('invitations')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('invitations')
        .getPublicUrl(path)

      await supabase
        .from('events')
        .update({ invitation_url: urlData.publicUrl })
        .eq('id', id)

      setEvent({ ...event, invitation_url: urlData.publicUrl })
    } catch (err) {
      console.error('Invitation upload error:', err)
      alert('שגיאה בהעלאת ההזמנה. ודא שהקובץ תקין ונסה שוב.')
    } finally {
      setUploading(false)
    }
  }

  const handleImportExcel = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // File size limit: 5MB
    if (file.size > 5 * 1024 * 1024) {
      alert('הקובץ גדול מדי. גודל מקסימלי: 5MB')
      e.target.value = ''
      return
    }

    try {
      const parsed = await parseGuestExcel(file)
      const toInsert = parsed.map((g) => ({
        event_id: id,
        name: g.name,
        phone: g.phone,
        rsvp_status: 'pending',
        num_guests: 1,
        rsvp_token: crypto.randomUUID(),
      }))

      const { error } = await supabase.from('guests').insert(toInsert)
      if (error) throw error

      setImportCount(parsed.length)
      setTimeout(() => setImportCount(null), 3000)
      fetchData()
    } catch (err) {
      console.error('Excel import error:', err)
      alert(err.message?.includes('מוזמנים') || err.message?.includes('קובץ') ? err.message : 'שגיאה בטעינת הקובץ. ודא שהקובץ בפורמט אקסל תקין.')
    }

    e.target.value = ''
  }

  const handleAddGuest = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('guests').insert([{
      event_id: id,
      name: guestForm.name,
      phone: guestForm.phone,
      rsvp_status: 'pending',
      num_guests: 1,
      rsvp_token: crypto.randomUUID(),
    }])

    if (error) {
      console.error('Add guest error:', error)
      alert('שגיאה בהוספת מוזמן. נסה שוב.')
      return
    }

    setShowAddModal(false)
    setGuestForm({ name: '', phone: '' })
    fetchData()
  }

  const handleDeleteGuest = async (guestId) => {
    if (!confirm('למחוק מוזמן?')) return
    await supabase.from('guests').delete().eq('id', guestId)
    fetchData()
  }

  const handleDeleteAllGuests = async () => {
    if (deleteAllStep < 2) return
    setDeleting(true)
    try {
      const guestIds = guests.map((g) => g.id)
      if (guestIds.length > 0) {
        await supabase.from('messages').delete().in('guest_id', guestIds)
      }
      await supabase.from('guests').delete().eq('event_id', id)
      setDeleteAllStep(0)
      fetchData()
    } catch (err) {
      console.error('Delete all guests error:', err)
      alert('שגיאה במחיקה. נסה שוב.')
    } finally {
      setDeleting(false)
    }
  }

  const handleSetTable = async (guestId) => {
    const num = tableInput === '' ? null : parseInt(tableInput)
    await supabase
      .from('guests')
      .update({ table_number: num })
      .eq('id', guestId)

    setGuests(guests.map((g) => g.id === guestId ? { ...g, table_number: num } : g))
    setEditingTable(null)
    setTableInput('')
  }

  const handleSetName = async (guestId) => {
    const trimmed = nameInput.trim()
    if (!trimmed) return
    await supabase.from('guests').update({ name: trimmed }).eq('id', guestId)
    setGuests(guests.map((g) => g.id === guestId ? { ...g, name: trimmed } : g))
    setEditingName(null)
    setNameInput('')
  }

  const handleSetChildren = async (guestId) => {
    const num = childrenInput === '' ? 0 : parseInt(childrenInput)
    await supabase.from('guests').update({ num_children: num }).eq('id', guestId)
    setGuests(guests.map((g) => g.id === guestId ? { ...g, num_children: num } : g))
    setEditingChildren(null)
    setChildrenInput('')
  }

  const handleSetGift = async (guestId) => {
    // giftInput format: "amount|description" or just "amount"
    const parts = giftInput.split('|')
    const amount = parseFloat(parts[0]) || 0
    const desc = (parts[1] || '').trim() || null
    await supabase.from('guests').update({ gift_amount: amount, gift_description: desc }).eq('id', guestId)
    setGuests(guests.map((g) => g.id === guestId ? { ...g, gift_amount: amount, gift_description: desc } : g))
    setEditingGift(null)
    setGiftInput('')
  }

  if (loading) return <LoadingSpinner />
  if (!event) return <p className="text-center text-gray-500 mt-8">אירוע לא נמצא</p>

  const filtered = filter === 'all'
    ? guests
    : guests.filter((g) => g.rsvp_status === filter)

  const attendingGuests = guests.filter((g) => g.rsvp_status === 'attending')
  const totalGuests = attendingGuests.reduce((sum, g) => sum + (g.num_guests || 1), 0)
  const totalChildren = attendingGuests.reduce((sum, g) => sum + (g.num_children || 0), 0)
  const totalAdults = totalGuests - totalChildren

  const stats = {
    total: guests.length,
    attending: attendingGuests.length,
    notAttending: guests.filter((g) => g.rsvp_status === 'not_attending').length,
    pending: guests.filter((g) => g.rsvp_status === 'pending').length,
    totalGuests,
    totalAdults,
    totalChildren,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/events" className="hover:text-gold-600">אירועים</Link>
        <span>/</span>
        <span className="text-gray-800">{event.name}</span>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">{event.name}</h1>
            <button
              onClick={openEditModal}
              className="text-gray-400 hover:text-gold-600 cursor-pointer"
              title="ערוך אירוע"
            >
              ✏️
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <span>📅 {new Date(event.event_date).toLocaleDateString('he-IL')} {new Date(event.event_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
            {event.location && <span>📍 {event.location}</span>}
            {event.location_url && (
              <a href={event.location_url} target="_blank" rel="noopener noreferrer" className="text-gold-600 hover:underline">
                🗺️ מיקום ב-Google Maps
              </a>
            )}
            {event.bit_link && (
              <a href={event.bit_link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                💳 קישור BIT
              </a>
            )}
          </div>
          <div className="flex gap-2">
            <Link to={`/events/${id}/seating`}>
              <Button variant="secondary" size="sm">🪑 סידור שולחנות</Button>
            </Link>
            <Link to={`/events/${id}/finances`}>
              <Button variant="secondary" size="sm">💰 הוצאות והכנסות</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => setShowEventDayModal(true)}>
              📋 הודעת יום האירוע
            </Button>
          </div>
        </div>

        <Card className="w-full md:w-64 text-center">
          {event.invitation_url ? (
            <div>
              <img
                src={event.invitation_url}
                alt="הזמנה"
                className="w-full rounded-lg mb-2"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                החלף הזמנה
              </Button>
            </div>
          ) : (
            <div>
              <p className="text-gray-400 mb-2">לא הועלתה הזמנה</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'מעלה...' : '📷 העלה תמונת הזמנה'}
              </Button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUploadInvitation}
            className="hidden"
          />
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <StatsCard label="סה״כ מוזמנים" value={stats.total} icon="👥" color="blue" />
        <StatsCard label="מגיעים" value={stats.attending} icon="✅" color="green" />
        <StatsCard label="לא מגיעים" value={stats.notAttending} icon="❌" color="red" />
        <StatsCard label="ממתינים" value={stats.pending} icon="⏳" color="gold" />
        <StatsCard label="סה״כ אורחים" value={stats.totalGuests} icon="🎯" color="blue" />
        <StatsCard label="מבוגרים" value={stats.totalAdults} icon="🧑" color="blue" />
        <StatsCard label="ילדים" value={stats.totalChildren} icon="👶" color="gold" />
      </div>

      <Card>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-800">רשימת מוזמנים</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => excelInputRef.current?.click()}>
              📄 טען מאקסל
            </Button>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              + הוסף מוזמן
            </Button>
            {guests.length > 0 && (
              <Button variant="danger" size="sm" onClick={() => setDeleteAllStep(1)}>
                🗑️ מחק הכל
              </Button>
            )}
          </div>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportExcel}
            className="hidden"
          />
        </div>

        {importCount && (
          <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg mb-4">
            ✅ נטענו {importCount} מוזמנים בהצלחה!
          </div>
        )}

        <div className="flex gap-2 mb-4">
          {[
            { key: 'all', label: 'הכל' },
            { key: 'attending', label: 'מגיעים' },
            { key: 'not_attending', label: 'לא מגיעים' },
            { key: 'pending', label: 'ממתינים' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded-full text-sm cursor-pointer transition-colors ${
                filter === f.key
                  ? 'bg-gold-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-6">אין מוזמנים להצגה</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">שם</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">טלפון</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">סטטוס</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">אורחים</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">ילדים</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">שולחן</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">מתנה</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium">תזכורות</th>
                  <th className="text-right py-3 px-2 text-gray-500 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((guest) => (
                  <tr key={guest.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-3 px-2 font-medium text-gray-800">
                      {editingName === guest.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            className="w-36 px-1 py-0.5 border border-gold-300 rounded text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSetName(guest.id)
                              if (e.key === 'Escape') { setEditingName(null); setNameInput('') }
                            }}
                          />
                          <button onClick={() => handleSetName(guest.id)} className="text-green-500 cursor-pointer text-xs">✓</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingName(guest.id); setNameInput(guest.name) }}
                          className="hover:text-gold-600 cursor-pointer text-right w-full"
                          title="לחץ לעריכת שם"
                        >
                          {guest.name}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2 text-gray-600 dir-ltr">{guest.phone}</td>
                    <td className="py-3 px-2"><Badge status={guest.rsvp_status} /></td>
                    <td className="py-3 px-2 text-gray-600">{guest.num_guests}</td>
                    <td className="py-3 px-2">
                      {guest.rsvp_status === 'attending' && (guest.num_guests > 1 || guest.num_children > 0) ? (
                        editingChildren === guest.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={childrenInput}
                              onChange={(e) => setChildrenInput(e.target.value)}
                              className="w-14 px-1 py-0.5 border border-gray-300 rounded text-center text-sm"
                              min="0"
                              max={guest.num_guests - 1}
                              placeholder="0"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSetChildren(guest.id)
                                if (e.key === 'Escape') { setEditingChildren(null); setChildrenInput('') }
                              }}
                            />
                            <button onClick={() => handleSetChildren(guest.id)} className="text-green-500 cursor-pointer text-xs">✓</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingChildren(guest.id); setChildrenInput((guest.num_children || 0).toString()) }}
                            className="text-gray-400 hover:text-gold-600 cursor-pointer text-sm"
                            title="לחץ לעריכת מספר ילדים"
                          >
                            {guest.num_children > 0 ? `👶 ${guest.num_children}` : '—'}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {guest.rsvp_status !== 'attending' ? (
                        <span className="text-gray-300 text-sm">—</span>
                      ) : editingTable === guest.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={tableInput}
                            onChange={(e) => setTableInput(e.target.value)}
                            className="w-14 px-1 py-0.5 border border-gray-300 rounded text-center text-sm"
                            min="1"
                            placeholder="#"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSetTable(guest.id)
                              if (e.key === 'Escape') { setEditingTable(null); setTableInput('') }
                            }}
                          />
                          <button onClick={() => handleSetTable(guest.id)} className="text-green-500 cursor-pointer text-xs">✓</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingTable(guest.id); setTableInput(guest.table_number?.toString() || '') }}
                          className="text-gray-400 hover:text-gold-600 cursor-pointer text-sm"
                        >
                          {guest.table_number ? `#${guest.table_number}` : '—'}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {editingGift === guest.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={giftInput.split('|')[0] || ''}
                            onChange={(e) => {
                              const desc = giftInput.split('|')[1] || ''
                              setGiftInput(`${e.target.value}|${desc}`)
                            }}
                            className="w-16 px-1 py-0.5 border border-gray-300 rounded text-sm text-center"
                            placeholder="₪"
                            min="0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSetGift(guest.id)
                              if (e.key === 'Escape') { setEditingGift(null); setGiftInput('') }
                            }}
                          />
                          <input
                            type="text"
                            value={giftInput.split('|')[1] || ''}
                            onChange={(e) => {
                              const amount = giftInput.split('|')[0] || '0'
                              setGiftInput(`${amount}|${e.target.value}`)
                            }}
                            className="w-20 px-1 py-0.5 border border-gray-300 rounded text-sm"
                            placeholder="תיאור"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSetGift(guest.id)
                              if (e.key === 'Escape') { setEditingGift(null); setGiftInput('') }
                            }}
                          />
                          <button onClick={() => handleSetGift(guest.id)} className="text-green-500 cursor-pointer text-xs">✓</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingGift(guest.id); setGiftInput(`${guest.gift_amount || 0}|${guest.gift_description || ''}`) }}
                          className={`cursor-pointer text-sm ${(guest.gift_amount > 0 || guest.gift_description) ? 'text-green-600' : 'text-gray-400 hover:text-gold-600'}`}
                          title="לחץ לרישום מתנה"
                        >
                          {guest.gift_amount > 0
                            ? `🎁 ${Number(guest.gift_amount).toLocaleString('he-IL')}₪${guest.gift_description ? ` (${guest.gift_description})` : ''}`
                            : guest.gift_description
                              ? `🎁 ${guest.gift_description}`
                              : '—'}
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-center">{guest.reminder_count || 0}</td>
                    <td className="py-3 px-2">
                      <button
                        onClick={() => handleDeleteGuest(guest.id)}
                        className="text-gray-400 hover:text-red-500 cursor-pointer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {blessings.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            💛 ברכות שהתקבלו ({blessings.length})
          </h2>
          {event.blessing_email && (
            <p className="text-sm text-gray-500 mb-4">
              {event.blessing_email_sent_at
                ? `✅ נשלחו למייל ${event.blessing_email} בתאריך ${new Date(event.blessing_email_sent_at).toLocaleDateString('he-IL')}`
                : `📧 יישלחו אוטומטית ל-${event.blessing_email} לאחר האירוע`}
            </p>
          )}
          {!event.blessing_email && (
            <p className="text-sm text-amber-600 mb-4">
              💡 הגדר מייל בעריכת האירוע כדי לקבל את הברכות למייל אוטומטית
            </p>
          )}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {blessings.map((b) => (
              <div key={b.id} className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-amber-900">{b.guests?.name || 'אורח'}</span>
                  <span className="text-xs text-amber-600">
                    {new Date(b.created_at).toLocaleDateString('he-IL')}{' '}
                    {new Date(b.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-gray-700 whitespace-pre-line text-sm">{b.message}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="הוסף מוזמן">
        <form onSubmit={handleAddGuest} className="space-y-4">
          <Input
            label="שם"
            placeholder="שם מלא"
            value={guestForm.name}
            onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })}
            required
          />
          <Input
            label="טלפון"
            placeholder="050-1234567"
            value={guestForm.phone}
            onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })}
            required
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>ביטול</Button>
            <Button type="submit">הוסף</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleteAllStep > 0} onClose={() => setDeleteAllStep(0)} title="⚠️ מחיקת כל המוזמנים">
        <div className="space-y-4" dir="rtl">
          {deleteAllStep === 1 && (
            <>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700 font-medium">
                  אתה עומד למחוק את כל {guests.length} המוזמנים מהאירוע הזה!
                </p>
                <p className="text-red-600 text-sm mt-2">
                  פעולה זו תמחק גם את כל ההודעות שנשלחו וכל נתוני האישורים.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setDeleteAllStep(0)}>ביטול</Button>
                <Button variant="danger" onClick={() => setDeleteAllStep(2)}>כן, אני רוצה למחוק</Button>
              </div>
            </>
          )}
          {deleteAllStep === 2 && (
            <>
              <div className="bg-red-100 border-2 border-red-400 rounded-lg p-4">
                <p className="text-red-800 font-bold text-lg text-center">
                  ⚠️ אישור סופי ⚠️
                </p>
                <p className="text-red-700 text-center mt-2">
                  האם אתה בטוח לחלוטין? אין אפשרות לשחזר את הנתונים!
                </p>
                <p className="text-red-600 text-sm text-center mt-1">
                  {guests.length} מוזמנים יימחקו לצמיתות.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setDeleteAllStep(0)}>ביטול, אל תמחק</Button>
                <Button variant="danger" onClick={handleDeleteAllGuests} disabled={deleting}>
                  {deleting ? 'מוחק...' : '🗑️ מחק סופית'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal isOpen={showEventDayModal} onClose={() => { setShowEventDayModal(false); setEventDayCopied(false) }} title="📋 הודעת יום האירוע">
        {(() => {
          const dateStr = new Date(event.event_date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          const timeStr = new Date(event.event_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          const lines = [
            `שלום 😊`,
            ``,
            `מזכירים לכם – היום מתקיים ${event.name}!`,
            ``,
            `📅 ${dateStr}`,
            `⏰ ${timeStr}`,
            event.location ? `📍 ${event.location}` : null,
            event.location_url ? `🗺️ ניווט: ${event.location_url}` : null,
            event.bit_link ? `💳 מתנה ב-BIT: ${event.bit_link}` : null,
            ``,
            `מחכים לראותכם! 🎉`,
          ].filter(l => l !== null)
          const message = lines.join('\n')

          const handleCopy = () => {
            navigator.clipboard.writeText(message).then(() => {
              setEventDayCopied(true)
              setTimeout(() => setEventDayCopied(false), 2500)
            })
          }

          return (
            <div className="space-y-4" dir="rtl">
              <p className="text-sm text-gray-500">העתיקי את ההודעה הבאה ושלחי אותה דרך רשימת התפוצה בוואטסאפ:</p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed font-mono select-all">
                {message}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { setShowEventDayModal(false); setEventDayCopied(false) }}>סגור</Button>
                <Button onClick={handleCopy}>
                  {eventDayCopied ? '✅ הועתק!' : '📋 העתק הודעה'}
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="עריכת אירוע">
        <form onSubmit={handleEditEvent} className="space-y-4">
          <Input
            label="שם האירוע"
            value={editForm.name || ''}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            required
          />
          <Input
            label="תאריך ושעה"
            type="datetime-local"
            value={editForm.event_date || ''}
            onChange={(e) => setEditForm({ ...editForm, event_date: e.target.value })}
            required
          />
          <Input
            label="מיקום"
            placeholder="למשל: אולמי הגן, ראשון לציון"
            value={editForm.location || ''}
            onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
          />
          <Input
            label="קישור למיקום (Google Maps)"
            placeholder="הדבק קישור מ-Google Maps"
            value={editForm.location_url || ''}
            onChange={(e) => setEditForm({ ...editForm, location_url: e.target.value })}
          />
          <Input
            label="קישור לתשלום BIT"
            placeholder="הדבק קישור BIT"
            value={editForm.bit_link || ''}
            onChange={(e) => setEditForm({ ...editForm, bit_link: e.target.value })}
          />
          <Input
            label="מייל לקבלת ברכות (יישלחו 4 שעות אחרי האירוע)"
            placeholder="your@email.com"
            type="email"
            value={editForm.blessing_email || ''}
            onChange={(e) => setEditForm({ ...editForm, blessing_email: e.target.value })}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>ביטול</Button>
            <Button type="submit">שמור</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
