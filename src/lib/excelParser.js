import * as XLSX from 'xlsx'

const MAX_GUESTS_IMPORT = 5000
const MAX_NAME_LENGTH = 100
const MAX_PHONE_LENGTH = 20

export const parseGuestExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

        const guests = []
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length < 2) continue

          let name = String(row[0] || '').trim().slice(0, MAX_NAME_LENGTH)
          let phone = String(row[1] || '').trim().slice(0, MAX_PHONE_LENGTH)

          if (!name || !phone) continue
          if (i === 0 && isHeaderRow(name, phone)) continue

          // Basic phone validation — must contain at least 7 digits
          const digits = phone.replace(/\D/g, '')
          if (digits.length < 7 || digits.length > 15) continue

          phone = normalizePhone(phone)
          guests.push({ name, phone })

          if (guests.length >= MAX_GUESTS_IMPORT) {
            break
          }
        }

        if (guests.length === 0) {
          reject(new Error('לא נמצאו מוזמנים בקובץ. ודא שיש עמודות שם וטלפון.'))
          return
        }

        if (guests.length >= MAX_GUESTS_IMPORT) {
          resolve(guests) // Still resolve, but capped
        }

        resolve(guests)
      } catch {
        reject(new Error('שגיאה בקריאת הקובץ. ודא שזה קובץ אקסל תקין.'))
      }
    }

    reader.onerror = () => reject(new Error('שגיאה בטעינת הקובץ'))
    reader.readAsArrayBuffer(file)
  })
}

const normalizePhone = (phone) => {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
  // אם המספר מתחיל ב-972 — כבר בפורמט בינלאומי
  if (cleaned.startsWith('972')) return cleaned
  if (cleaned.startsWith('+972')) return cleaned.slice(1)
  // אם המספר ישראלי ללא 0 בהתחלה (למשל 546838789)
  if (/^[5][0-9]{8}$/.test(cleaned)) return '0' + cleaned
  // אם מתחיל ב-0 — בסדר
  return cleaned
}

const isHeaderRow = (name, phone) => {
  const headers = ['שם', 'name', 'טלפון', 'phone', 'נייד', 'tel', 'שם מלא']
  return headers.some(
    (h) => name.toLowerCase().includes(h) || phone.toLowerCase().includes(h)
  )
}

/**
 * Parse expenses from Excel/Google Sheets export.
 * Expected columns: A=description, B=category, C=budget, D=cost, E=date, F=paid_by
 * Returns array of { description, category, amount }
 */
export const parseExpensesExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

        const expenses = []
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length < 3) continue

          const description = String(row[0] || '').trim()
          const category = String(row[1] || '').trim()
          // Column D (index 3) = actual cost; fallback to Column C (index 2) = budget
          const costRaw = row[3] !== undefined && row[3] !== null && row[3] !== '' ? row[3] : row[2]
          const amount = parseFloat(String(costRaw).replace(/[^\d.\-]/g, ''))

          if (!description) continue
          // Skip header row
          if (i === 0 && isExpenseHeaderRow(description, category)) continue
          // Skip placeholder rows (xxx, empty amounts)
          if (isNaN(amount) || amount <= 0) continue
          // Skip total/summary rows
          if (description.includes('סה"כ') || description.includes('סהכ') || !category) continue

          expenses.push({ description, category: mapCategory(category), amount })
        }

        if (expenses.length === 0) {
          reject(new Error('לא נמצאו הוצאות בקובץ. ודא שיש עמודות: תיאור, קטגוריה, סכום.'))
          return
        }

        resolve(expenses)
      } catch {
        reject(new Error('שגיאה בקריאת הקובץ. ודא שזה קובץ אקסל תקין.'))
      }
    }

    reader.onerror = () => reject(new Error('שגיאה בטעינת הקובץ'))
    reader.readAsArrayBuffer(file)
  })
}

const isExpenseHeaderRow = (desc, cat) => {
  const headers = ['פרטי', 'הוצאות', 'תיאור', 'קטגוריה', 'category', 'description', 'תקציב']
  return headers.some(h => desc.toLowerCase().includes(h) || cat.toLowerCase().includes(h))
}

/** Map Hebrew category names from Google Sheets to our category keys */
const mapCategory = (hebrewCat) => {
  const map = {
    'פרטי המקום': 'venue',
    'אולם': 'venue',
    'מקום': 'venue',
    'אוכל': 'catering',
    'קייטרינג': 'catering',
    'פעילויות': 'other',
    'בידור': 'dj',
    'dj': 'dj',
    'מוזיקה': 'dj',
    'צילום': 'photo',
    'עיצוב': 'design',
    'פרחים': 'design',
    'הזמנות': 'print',
    'דפוס': 'print',
    'ביגוד': 'dress',
    'שמלה': 'dress',
    'חליפה': 'dress',
    'תכשיטים': 'jewelry',
    'אביזרים': 'jewelry',
    'הסעות': 'transport',
    'מתנות': 'favors',
    'שונות': 'other',
  }
  const lower = hebrewCat.toLowerCase().trim()
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val
  }
  return hebrewCat // Return as custom category if no match
}
