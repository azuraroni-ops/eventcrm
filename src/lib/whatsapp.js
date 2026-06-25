const getCredentials = () => {
  const instanceId = localStorage.getItem('greenapi_instance_id') || ''
  const apiToken = localStorage.getItem('greenapi_api_token') || ''
  return { instanceId, apiToken }
}

export const getSiteBaseUrl = () => {
  const saved = localStorage.getItem('site_base_url')
  if (saved) return saved
  return window.location.origin
}

const baseUrl = (instanceId) =>
  `https://api.green-api.com/waInstance${instanceId}`

const formatPhone = (phone) => {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1)
  if (cleaned.startsWith('972')) {
    // כבר בפורמט בינלאומי
  } else if (cleaned.startsWith('0')) {
    cleaned = '972' + cleaned.slice(1)
  } else if (/^[5][0-9]{8}$/.test(cleaned)) {
    // מספר ישראלי ללא 0 בהתחלה (למשל 546838789)
    cleaned = '972' + cleaned
  }
  if (!cleaned.includes('@')) {
    cleaned = cleaned + '@c.us'
  }
  return cleaned
}

export const getRandomDelay = () => {
  return Math.floor(Math.random() * 30000) + 30000
}

export const isQuietHours = () => {
  const hour = new Date().getHours()
  const minutes = new Date().getMinutes()
  return hour >= 22 || hour < 7 || (hour === 7 && minutes < 30)
}

export const getNextSendTime = () => {
  const now = new Date()
  const next = new Date(now)
  if (now.getHours() >= 22) {
    next.setDate(next.getDate() + 1)
  }
  next.setHours(7, 30, 0, 0)
  return next
}

export const getEstimatedEndTime = (count) => {
  const avgDelayMs = 45000
  const totalMs = count * avgDelayMs
  return new Date(Date.now() + totalMs)
}

export const willCrossQuietHours = (count) => {
  const now = new Date()
  const hour = now.getHours()
  if (hour >= 22 || hour < 7 || (hour === 7 && now.getMinutes() < 30)) {
    return false
  }
  const endTime = getEstimatedEndTime(count)
  const tonight = new Date(now)
  tonight.setHours(22, 0, 0, 0)
  return endTime > tonight
}

const shortUrlCache = new Map()

export const shortenUrl = async (url) => {
  if (!url) return url
  if (shortUrlCache.has(url)) return shortUrlCache.get(url)

  try {
    const response = await fetch(
      `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`
    )
    if (!response.ok) throw new Error('shorten failed')
    const data = await response.json()
    if (data.shorturl) {
      shortUrlCache.set(url, data.shorturl)
      return data.shorturl
    }
    return url
  } catch {
    return url
  }
}

export const sendMessage = async (phone, message, typingTimeMs = 0) => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) {
    throw new Error('לא הוגדרו פרטי חיבור ל-WhatsApp. עבור להגדרות.')
  }

  const body = {
    chatId: formatPhone(phone),
    message,
  }
  // typingTime: shows "typing..." in recipient's chat before message arrives (1000-20000ms)
  if (typingTimeMs >= 1000 && typingTimeMs <= 20000) {
    body.typingTime = typingTimeMs
  }

  const response = await fetch(
    `${baseUrl(instanceId)}/sendMessage/${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    throw new Error('שליחת ההודעה נכשלה')
  }

  return response.json()
}

export const sendImage = async (phone, imageUrl, caption = '', typingTimeMs = 0) => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) {
    throw new Error('לא הוגדרו פרטי חיבור ל-WhatsApp. עבור להגדרות.')
  }

  const body = {
    chatId: formatPhone(phone),
    urlFile: imageUrl,
    fileName: 'invitation.jpg',
    caption,
  }
  // typingTime: shows "typing..." in recipient's chat before message arrives (1000-20000ms)
  if (typingTimeMs >= 1000 && typingTimeMs <= 20000) {
    body.typingTime = typingTimeMs
  }

  const response = await fetch(
    `${baseUrl(instanceId)}/sendFileByUrl/${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    throw new Error('שליחת התמונה נכשלה')
  }

  return response.json()
}

// Clear the outgoing message queue before starting a new sending session
// Prevents stale messages from being sent unexpectedly
export const clearMessagesQueue = async () => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) return

  try {
    await fetch(
      `${baseUrl(instanceId)}/clearMessagesQueue/${apiToken}`,
      { method: 'GET' }
    )
  } catch {
    // Non-critical — continue even if clearing fails
  }
}

// Check if a phone number exists on WhatsApp before sending
// Prevents sending to invalid numbers which triggers spam flags
export const checkWhatsApp = async (phone) => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) {
    throw new Error('לא הוגדרו פרטי חיבור ל-WhatsApp. עבור להגדרות.')
  }

  try {
    const response = await fetch(
      `${baseUrl(instanceId)}/checkWhatsapp/${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: parseInt(formatPhone(phone).replace('@c.us', '')),
        }),
      }
    )

    if (!response.ok) {
      // API error — assume number is valid to avoid blocking sends
      return { exists: true, checked: false }
    }

    const data = await response.json()
    return { exists: data.existsWhatsapp === true, checked: true }
  } catch {
    // Network error — assume valid
    return { exists: true, checked: false }
  }
}

// Send "typing..." indicator before a message to simulate human behavior
// WhatsApp may monitor this — accounts that send messages without typing look automated
export const sendTyping = async (phone) => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) return

  try {
    await fetch(
      `${baseUrl(instanceId)}/sendTyping/${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: formatPhone(phone),
        }),
      }
    )
  } catch {
    // Typing indicator failure is non-critical — don't block sending
  }
}

export const checkConnection = async () => {
  const { instanceId, apiToken } = getCredentials()
  if (!instanceId || !apiToken) {
    return { connected: false, message: 'פרטי חיבור חסרים' }
  }

  try {
    const response = await fetch(
      `${baseUrl(instanceId)}/getStateInstance/${apiToken}`
    )
    const data = await response.json()
    return {
      connected: data.stateInstance === 'authorized',
      message:
        data.stateInstance === 'authorized'
          ? 'מחובר'
          : 'לא מחובר - בדוק את ההגדרות',
    }
  } catch {
    return { connected: false, message: 'שגיאת חיבור' }
  }
}
