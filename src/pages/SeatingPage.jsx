import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function SeatingPage() {
  const { id } = useParams()
  const [event, setEvent] = useState(null)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [numTables, setNumTables] = useState(0)
  const [defaultSeats, setDefaultSeats] = useState(12)
  const [tableSeats, setTableSeats] = useState({})
  const [assigningGuest, setAssigningGuest] = useState(null)
  const [editingDefault, setEditingDefault] = useState(false)
  const [editingTableNum, setEditingTableNum] = useState(null)
  const [editingTableVal, setEditingTableVal] = useState('')

  const storageKey = `seating_config_${id}`

  useEffect(() => {
    fetchData()
    const onFocus = () => fetchData()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [id])

  const saveToStorage = (newDefault, newTableSeats, newNumTables) => {
    localStorage.setItem(storageKey, JSON.stringify({ defaultSeats: newDefault, tableSeats: newTableSeats, numTables: newNumTables }))
  }

  const getSeatsForTable = (tableNum) => tableSeats[tableNum] ?? defaultSeats

  const fetchData = async () => {
    const [eventRes, guestsRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('guests').select('*').eq('event_id', id).eq('rsvp_status', 'attending').order('name'),
    ])
    setEvent(eventRes.data)
    const g = guestsRes.data || []
    setGuests(g)
    const maxTableFromDB = Math.max(0, ...g.map((x) => x.table_number || 0))

    let savedDefault = 12
    let savedTableSeats = {}
    let savedNumTables = 0
    const saved = localStorage.getItem(`seating_config_${id}`)
    if (saved) {
      try {
        const config = JSON.parse(saved)
        if (config.defaultSeats) savedDefault = config.defaultSeats
        if (config.tableSeats) savedTableSeats = config.tableSeats
        if (config.numTables) savedNumTables = config.numTables
      } catch {}
    }

    setDefaultSeats(savedDefault)
    setTableSeats(savedTableSeats)
    setNumTables(Math.max(maxTableFromDB, savedNumTables))
    setLoading(false)
  }

  const handleAssign = async (guestId, tableNum) => {
    const num = tableNum === 0 ? null : tableNum
    await supabase.from('guests').update({ table_number: num }).eq('id', guestId)
    setGuests(guests.map((g) => g.id === guestId ? { ...g, table_number: num } : g))
    setAssigningGuest(null)
  }

  const addTable = () => {
    const newNum = numTables + 1
    setNumTables(newNum)
    saveToStorage(defaultSeats, tableSeats, newNum)
  }

  const removeTable = async () => {
    if (numTables <= 0) return
    const guestsAtTable = guests.filter((g) => g.table_number === numTables)
    if (guestsAtTable.length > 0) {
      if (!confirm(`שולחן ${numTables} מכיל ${guestsAtTable.length} אורחים. הם יוחזרו לרשימת הלא משובצים. להסיר?`)) return
      for (const g of guestsAtTable) {
        await handleAssign(g.id, 0)
      }
    }
    const newTableSeats = { ...tableSeats }
    delete newTableSeats[numTables]
    const newNum = numTables - 1
    setTableSeats(newTableSeats)
    setNumTables(newNum)
    saveToStorage(defaultSeats, newTableSeats, newNum)
  }

  const handleDefaultSeatsChange = (val) => {
    const seats = Math.max(1, parseInt(val) || 1)
    setDefaultSeats(seats)
    saveToStorage(seats, tableSeats, numTables)
    setEditingDefault(false)
  }

  const startEditTableSeats = (tableNum) => {
    setEditingTableNum(tableNum)
    setEditingTableVal(String(getSeatsForTable(tableNum)))
  }

  const confirmEditTableSeats = (tableNum) => {
    const seats = Math.max(1, parseInt(editingTableVal) || 1)
    const newTableSeats = { ...tableSeats, [tableNum]: seats }
    setTableSeats(newTableSeats)
    saveToStorage(defaultSeats, newTableSeats, numTables)
    setEditingTableNum(null)
    setEditingTableVal('')
  }

  if (loading) return <LoadingSpinner />
  if (!event) return <p className="text-center text-gray-500 mt-8">אירוע לא נמצא</p>

  const unassigned = guests.filter((g) => !g.table_number)
  const tables = Array.from({ length: numTables }, (_, i) => ({
    number: i + 1,
    guests: guests.filter((g) => g.table_number === i + 1),
  }))

  const totalAttendees = guests.reduce((sum, g) => sum + (g.num_guests || 1), 0)
  const totalChildren = guests.reduce((sum, g) => sum + (g.num_children || 0), 0)
  const totalAdults = totalAttendees - totalChildren
  const assignedCount = guests.filter((g) => g.table_number).reduce((sum, g) => sum + (g.num_guests || 1), 0)
  const totalCapacity = tables.reduce((sum, t) => sum + getSeatsForTable(t.number), 0)

  const splitName = (name) => {
    const parts = (name || '').trim().split(/\s+/)
    if (parts.length === 1) return { firstName: parts[0], lastName: '' }
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
  }

  const printReport = () => {
    const assignedGuests = guests
      .filter((g) => g.table_number)
      .map((g) => ({ ...g, ...splitName(g.name) }))
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'he') || a.firstName.localeCompare(b.firstName, 'he'))

    const tablesWithSpace = tables
      .map((t) => {
        const seats = getSeatsForTable(t.number)
        const occupied = t.guests.reduce((sum, g) => sum + (g.num_guests || 1), 0)
        return { number: t.number, seats, occupied, free: seats - occupied }
      })
      .filter((t) => t.free > 0)
      .sort((a, b) => a.number - b.number)

    const dateStr = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' })

    const rows = assignedGuests.map((g, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td>${g.lastName}</td>
        <td>${g.firstName}</td>
        <td class="table-num">${g.table_number}</td>
      </tr>
    `).join('')

    const freeTablesHtml = tablesWithSpace.length === 0
      ? '<p class="no-free">כל השולחנות מלאים</p>'
      : tablesWithSpace.map((t) => `<span class="free-table">שולחן ${t.number} — ${t.free} מקום${t.free > 1 ? 'ות' : ''} פנוי${t.free > 1 ? 'ים' : ''}</span>`).join('')

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>דוח סידור שולחנות — ${event.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; direction: rtl; padding: 20px 30px; color: #1a1a1a; font-size: 13px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 12px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #5c3d11; color: white; }
    th { padding: 8px 12px; text-align: right; font-weight: 600; font-size: 12px; }
    td { padding: 6px 12px; border-bottom: 1px solid #e5e7eb; }
    tr.even { background: #fafaf8; }
    tr.odd { background: #fff; }
    .table-num { font-weight: 700; color: #5c3d11; text-align: center; }
    th:last-child { text-align: center; }
    .section-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 10px; border-top: 2px solid #d4a843; padding-top: 10px; }
    .free-tables { display: flex; flex-wrap: wrap; gap: 8px; }
    .free-table { background: #fef3c7; border: 1px solid #d4a843; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; color: #92400e; }
    .no-free { color: #6b7280; font-size: 12px; }
    .stats { font-size: 11px; color: #6b7280; margin-bottom: 16px; }
    @media print {
      body { padding: 10px 20px; }
      @page { margin: 1.5cm; size: A4 portrait; }
    }
  </style>
</head>
<body>
  <h1>דוח סידור שולחנות — ${event.name}</h1>
  <p class="subtitle">${dateStr} | ${assignedGuests.length} משובצים מתוך ${guests.length} מאשרים | ${numTables} שולחנות</p>
  <table>
    <thead>
      <tr><th>שם משפחה</th><th>שם פרטי</th><th>שולחן</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="section-title">שולחנות עם מקומות פנויים (לאורחים שהגיעו ואינם ברשימה)</p>
  <div class="free-tables">${freeTablesHtml}</div>
  <script>window.onload = () => { window.print() }<\/script>
</body>
</html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/events" className="hover:text-gold-600">אירועים</Link>
        <span>/</span>
        <Link to={`/events/${id}`} className="hover:text-gold-600">{event.name}</Link>
        <span>/</span>
        <span className="text-gray-800">סידור שולחנות</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-800">🪑 סידור שולחנות</h1>
            <button
              onClick={fetchData}
              className="text-gray-400 hover:text-gold-600 cursor-pointer text-sm transition-colors"
              title="רענן נתונים"
            >
              🔄
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {guests.length} מאשרים ({totalAttendees} אורחים: {totalAdults} מבוגרים + {totalChildren} ילדים) | {numTables} שולחנות | {unassigned.length} לא משובצים
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {editingDefault ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">ברירת מחדל:</span>
              <input
                type="number"
                defaultValue={defaultSeats}
                autoFocus
                onBlur={(e) => handleDefaultSeatsChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDefaultSeatsChange(e.target.value) }}
                className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                min="1"
                max="30"
              />
              <span className="text-xs text-gray-400">מקומות</span>
            </div>
          ) : (
            <button
              onClick={() => setEditingDefault(true)}
              className="text-xs text-gray-400 hover:text-gold-600 cursor-pointer border border-gray-200 rounded px-2 py-1"
              title="ברירת מחדל למספר מקומות בשולחן חדש"
            >
              ⚙️ ברירת מחדל: {defaultSeats} מקומות
            </button>
          )}
          {guests.filter((g) => g.table_number).length > 0 && (
            <button
              onClick={printReport}
              className="text-xs text-gray-500 hover:text-gold-700 cursor-pointer border border-gray-200 hover:border-gold-300 rounded px-2 py-1 transition-colors"
              title="הדפס דוח לאולם"
            >
              🖨️ הדפס דוח
            </button>
          )}
          <Button variant="secondary" size="sm" onClick={removeTable} disabled={numTables === 0}>
            − הסר שולחן
          </Button>
          <Button size="sm" onClick={addTable}>
            + הוסף שולחן
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {numTables > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap gap-4 text-sm">
          <span className="text-blue-800">📊 קיבולת: {totalCapacity} מקומות ({numTables} שולחנות)</span>
          <span className="text-blue-800">👥 משובצים: {assignedCount}/{totalAttendees}</span>
          <span className={totalAttendees > totalCapacity ? 'text-red-600 font-medium' : 'text-green-600'}>
            {totalAttendees > totalCapacity
              ? `⚠️ חסרים ${totalAttendees - totalCapacity} מקומות`
              : `✅ פנויים ${totalCapacity - totalAttendees} מקומות`}
          </span>
        </div>
      )}

      {unassigned.length > 0 && (
        <Card>
          <h3 className="font-semibold text-gray-800 mb-3">לא משובצים ({unassigned.length} — {unassigned.reduce((s, g) => s + (g.num_guests || 1), 0)} אורחים)</h3>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((guest) => (
              <div key={guest.id} className="relative">
                <button
                  onClick={() => setAssigningGuest(assigningGuest === guest.id ? null : guest.id)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gold-100 rounded-lg text-sm cursor-pointer transition-colors border border-gray-200"
                >
                  {guest.name}
                  {guest.num_guests > 1 && <span className="text-xs text-gray-400 mr-1">+{guest.num_guests - 1}</span>}
                  {guest.num_children > 0 && <span className="text-xs text-blue-400 mr-1">👶{guest.num_children}</span>}
                </button>
                {assigningGuest === guest.id && numTables > 0 && (
                  <div className="absolute top-full mt-1 right-0 bg-white shadow-lg rounded-lg border border-gray-200 z-10 p-2 min-w-36">
                    <p className="text-xs text-gray-500 mb-1 px-1">שבץ לשולחן:</p>
                    {Array.from({ length: numTables }, (_, i) => {
                      const tNum = i + 1
                      const seats = getSeatsForTable(tNum)
                      const tableGuestCount = guests.filter((g) => g.table_number === tNum).reduce((s, g) => s + (g.num_guests || 1), 0)
                      const isFull = tableGuestCount >= seats
                      return (
                        <button
                          key={tNum}
                          onClick={() => handleAssign(guest.id, tNum)}
                          className={`block w-full text-right px-3 py-1.5 text-sm rounded cursor-pointer ${isFull ? 'text-red-400 hover:bg-red-50' : 'hover:bg-gold-50'}`}
                        >
                          שולחן {tNum} ({tableGuestCount}/{seats}){isFull && ' ⚠️'}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {numTables === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🪑</p>
            <p className="text-gray-500 mb-4">עדיין לא הוספת שולחנות</p>
            <Button onClick={addTable}>+ הוסף שולחן ראשון</Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => {
            const seats = getSeatsForTable(table.number)
            const guestCount = table.guests.reduce((sum, g) => sum + (g.num_guests || 1), 0)
            const childCount = table.guests.reduce((sum, g) => sum + (g.num_children || 0), 0)
            const isFull = guestCount >= seats
            const isOver = guestCount > seats
            const isEditingThis = editingTableNum === table.number
            return (
              <div
                key={table.number}
                className={`relative bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${isOver ? 'border-red-300' : isFull ? 'border-green-300' : 'border-gold-200'}`}
              >
                <div className={`px-4 py-2 flex items-center justify-between ${isOver ? 'bg-gradient-to-l from-red-400 to-red-500' : 'bg-gradient-to-l from-gold-400 to-gold-500'}`}>
                  <span className="font-bold text-white">שולחן {table.number}</span>
                  <span className="text-xs text-white/80">
                    {guestCount}/{seats}
                    {childCount > 0 && ` (👶${childCount})`}
                  </span>
                </div>

                <div className="px-4 pt-3 pb-1 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-400">גודל שולחן:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { const newSeats = Math.max(1, seats - 1); const ns = { ...tableSeats, [table.number]: newSeats }; setTableSeats(ns); saveToStorage(defaultSeats, ns, numTables) }}
                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-bold cursor-pointer flex items-center justify-center leading-none"
                    >−</button>
                    {isEditingThis ? (
                      <input
                        type="number"
                        value={editingTableVal}
                        autoFocus
                        onChange={(e) => setEditingTableVal(e.target.value)}
                        onBlur={() => confirmEditTableSeats(table.number)}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmEditTableSeats(table.number) }}
                        className="w-10 px-1 py-0.5 border border-gold-300 rounded text-center text-sm"
                        min="1"
                        max="30"
                      />
                    ) : (
                      <button
                        onClick={() => startEditTableSeats(table.number)}
                        className="w-10 text-center text-sm font-semibold text-gray-700 hover:text-gold-600 cursor-pointer"
                        title="לחץ להקליד מספר"
                      >{seats}</button>
                    )}
                    <button
                      onClick={() => { const newSeats = Math.min(30, seats + 1); const ns = { ...tableSeats, [table.number]: newSeats }; setTableSeats(ns); saveToStorage(defaultSeats, ns, numTables) }}
                      className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-bold cursor-pointer flex items-center justify-center leading-none"
                    >+</button>
                    <span className="text-xs text-gray-400 mr-1">מקומות</span>
                  </div>
                </div>

                <div className="p-4">
                  {table.guests.length === 0 ? (
                    <p className="text-center text-gray-300 text-sm py-4">שולחן ריק</p>
                  ) : (
                    <div className="space-y-1.5">
                      {table.guests.map((guest) => (
                        <div
                          key={guest.id}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50 group"
                        >
                          <span className="text-sm text-gray-800">
                            {guest.name}
                            {guest.num_guests > 1 && (
                              <span className="text-xs text-gray-400 mr-1">({guest.num_guests})</span>
                            )}
                            {guest.num_children > 0 && (
                              <span className="text-xs text-blue-400 mr-1">👶{guest.num_children}</span>
                            )}
                          </span>
                          <button
                            onClick={() => handleAssign(guest.id, 0)}
                            className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 cursor-pointer text-xs transition-opacity"
                            title="הסר מהשולחן"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-center pb-4">
                  <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center ${isOver ? 'border-red-200 bg-red-50' : isFull ? 'border-green-200 bg-green-50' : 'border-gold-200 bg-gold-50'}`}>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${isOver ? 'text-red-600' : isFull ? 'text-green-600' : 'text-gold-600'}`}>{table.number}</p>
                      <p className={`text-xs ${isOver ? 'text-red-400' : isFull ? 'text-green-400' : 'text-gold-400'}`}>{guestCount}/{seats}</p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
