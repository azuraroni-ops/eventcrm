import { supabase } from './supabase'

// ===== Safety Level Presets =====
// Post-ban v2: calibrated per Green API recommendations + WhatsApp tightened policy
// Key additions: CheckWhatsApp, SendTyping, 5-day warmup, typing simulation
// Green API docs: max 1 msg/min, max 8 hours/day mailing, max 200/day
// Weekly rolling budget replaces rigid "3 consecutive days" rule
const PRESETS = {
  conservative: {
    dailyLimit: 40,
    hourlyLimit: 8,
    minDelay: 75,          // 1:15 min — well above 1 msg/min
    maxDelay: 150,
    safeStartHour: 10,
    safeStartMinute: 0,
    safeEndHour: 18,       // 8 hours window (10:00-18:00)
    safeEndMinute: 0,
    weeklyLimit: 120,      // 7-day rolling budget (~30/day * 4 sending days)
    typingDelay: true,     // Send "typing..." before messages
    checkNumbers: true,     // Verify numbers exist on WhatsApp first
    typingMinSec: 5,        // Min typing simulation seconds
    typingMaxSec: 15,       // Max typing simulation seconds
  },
  moderate: {
    dailyLimit: 60,
    hourlyLimit: 12,
    minDelay: 65,          // 1:05 min — above 1 msg/min
    maxDelay: 110,
    safeStartHour: 9,
    safeStartMinute: 30,
    safeEndHour: 17,       // 7.5 hours window (9:30-17:00)
    safeEndMinute: 30,
    weeklyLimit: 200,      // 7-day rolling budget (~50/day * 4 sending days)
    typingDelay: true,
    checkNumbers: true,
    typingMinSec: 3,
    typingMaxSec: 10,
  },
  aggressive: {
    dailyLimit: 80,
    hourlyLimit: 15,
    minDelay: 60,          // 1:00 min — exactly 1 msg/min minimum
    maxDelay: 80,
    safeStartHour: 9,
    safeStartMinute: 0,
    safeEndHour: 17,       // 8 hours window (9:00-17:00)
    safeEndMinute: 0,
    weeklyLimit: 300,      // 7-day rolling budget (~60/day * 5 sending days)
    typingDelay: true,
    checkNumbers: true,
    typingMinSec: 2,
    typingMaxSec: 7,
  },
}

// Hard minimums that cannot be overridden
// Green API: max 200/day, min 60s between messages (1 msg/min rule)
const HARD_LIMITS = {
  maxDailyLimit: 100,
  maxHourlyLimit: 18,
  minDelayFloor: 60,       // 1 message per minute — Green API strict recommendation
}

// ===== Configuration =====

export function getSafetyLevel() {
  return localStorage.getItem('ab_safety_level') || 'moderate'
}

export function setSafetyLevel(level) {
  if (PRESETS[level]) {
    localStorage.setItem('ab_safety_level', level)
  }
}

export function getSafetyConfig() {
  const level = getSafetyLevel()
  const preset = PRESETS[level] || PRESETS.moderate

  let custom = null
  try {
    const stored = localStorage.getItem('ab_custom_limits')
    if (stored) custom = JSON.parse(stored)
  } catch {}

  const config = custom ? { ...preset, ...custom } : { ...preset }

  // Enforce hard limits
  config.dailyLimit = Math.min(config.dailyLimit, HARD_LIMITS.maxDailyLimit)
  config.hourlyLimit = Math.min(config.hourlyLimit, HARD_LIMITS.maxHourlyLimit)
  config.minDelay = Math.max(config.minDelay, HARD_LIMITS.minDelayFloor)
  config.maxDelay = Math.max(config.maxDelay, config.minDelay + 5)

  // Apply warmup multiplier
  const warmupMult = getWarmupMultiplier()
  if (warmupMult < 1) {
    config.dailyLimit = Math.max(5, Math.floor(config.dailyLimit * warmupMult))
    config.hourlyLimit = Math.max(3, Math.floor(config.hourlyLimit * warmupMult))
  }

  return config
}

export function setCustomLimits(limits) {
  localStorage.setItem('ab_custom_limits', JSON.stringify(limits))
}

export function clearCustomLimits() {
  localStorage.removeItem('ab_custom_limits')
}

export function getPresets() {
  return PRESETS
}

// ===== Warmup =====

export function isWarmupEnabled() {
  return localStorage.getItem('ab_warmup_enabled') === 'true'
}

export function setWarmupEnabled(enabled) {
  localStorage.setItem('ab_warmup_enabled', enabled ? 'true' : 'false')
  if (enabled && !localStorage.getItem('ab_warmup_start_date')) {
    localStorage.setItem('ab_warmup_start_date', new Date().toISOString())
  }
}

export function getWarmupDay() {
  if (!isWarmupEnabled()) return 0
  const start = localStorage.getItem('ab_warmup_start_date')
  if (!start) return 0
  const days = Math.floor((Date.now() - new Date(start).getTime()) / 86400000) + 1
  return days
}

// Warmup multiplier for a specific day number
function warmupMultiplierForDay(day) {
  if (day <= 1) return 0
  if (day <= 2) return 0.15
  if (day <= 3) return 0.30
  if (day <= 4) return 0.55
  if (day <= 5) return 0.80
  return 1
}

export function getWarmupMultiplier() {
  if (!isWarmupEnabled()) return 1
  return warmupMultiplierForDay(getWarmupDay())
}

export function getWarmupTotalDays() {
  return 5
}

// ===== Typing & Number Check Config =====

// Returns how many seconds to show "typing..." before sending
// Randomized to look human: different delay each time
export function getTypingDelay() {
  const config = getSafetyConfig()
  if (!config.typingDelay) return 0
  const min = config.typingMinSec || 3
  const max = config.typingMaxSec || 9
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

// Whether to check numbers on WhatsApp before sending
export function shouldCheckNumbers() {
  const config = getSafetyConfig()
  return config.checkNumbers !== false
}

// ===== Counters =====

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function getCurrentHourKey() {
  const now = new Date()
  return `${now.toISOString().slice(0, 10)}T${String(now.getHours()).padStart(2, '0')}`
}

export function getDailyCount() {
  try {
    const stored = localStorage.getItem('ab_daily_count')
    if (!stored) return 0
    const data = JSON.parse(stored)
    if (data.date !== getTodayKey()) return 0
    return data.count || 0
  } catch {
    return 0
  }
}

export function getHourlyCount() {
  try {
    const stored = localStorage.getItem('ab_hourly_count')
    if (!stored) return 0
    const data = JSON.parse(stored)
    if (data.hour !== getCurrentHourKey()) return 0
    return data.count || 0
  } catch {
    return 0
  }
}

export function incrementCounters() {
  // Daily
  const todayKey = getTodayKey()
  const daily = getDailyCount()
  localStorage.setItem('ab_daily_count', JSON.stringify({ date: todayKey, count: daily + 1 }))

  // Hourly
  const hourKey = getCurrentHourKey()
  const hourly = getHourlyCount()
  localStorage.setItem('ab_hourly_count', JSON.stringify({ hour: hourKey, count: hourly + 1 }))

  // Track weekly rolling budget
  recordDailySend()
}

export async function syncCountersFromSupabase() {
  try {
    const today = getTodayKey()
    const { data } = await supabase
      .from('sending_sessions')
      .select('messages_sent')
      .eq('date', today)

    if (data && data.length > 0) {
      const totalToday = data.reduce((sum, row) => sum + (row.messages_sent || 0), 0)
      const currentLocal = getDailyCount()
      if (totalToday > currentLocal) {
        localStorage.setItem('ab_daily_count', JSON.stringify({ date: today, count: totalToday }))
      }
    }
  } catch {
    // Sync failure is non-critical — localStorage is the primary source
  }
}

export async function recordSend(campaignType) {
  try {
    const now = new Date()
    const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString()

    await supabase.from('sending_sessions').insert([{
      date: getTodayKey(),
      hour_bucket: hourBucket,
      messages_sent: 1,
      messages_failed: 0,
      campaign_type: campaignType,
    }])
  } catch {
    // Recording failure is non-critical
  }
}

export async function recordFail(campaignType) {
  try {
    const now = new Date()
    const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString()

    await supabase.from('sending_sessions').insert([{
      date: getTodayKey(),
      hour_bucket: hourBucket,
      messages_sent: 0,
      messages_failed: 1,
      campaign_type: campaignType,
    }])
  } catch {}
}

// ===== Weekly Rolling Budget =====
// Instead of rigid "3 consecutive days + 14 rest":
// - Track total messages in a 7-day rolling window
// - Warmup messages are EXEMPT (warmup has its own limits)
// - Soft recommendation for rest days based on sending pattern

function getWeeklyHistory() {
  try {
    const stored = localStorage.getItem('ab_weekly_history')
    if (!stored) return []
    return JSON.parse(stored)
  } catch { return [] }
}

function recordDailySend() {
  const today = getTodayKey()
  const history = getWeeklyHistory()

  const existing = history.find(h => h.date === today)
  if (existing) {
    existing.count++
  } else {
    history.push({ date: today, count: 1 })
  }

  // Keep only last 14 days
  const twoWeeksAgo = Date.now() - 14 * 86400000
  const recent = history.filter(h => new Date(h.date).getTime() >= twoWeeksAgo)
  localStorage.setItem('ab_weekly_history', JSON.stringify(recent))
}

export function getWeeklyCount() {
  const history = getWeeklyHistory()
  const weekAgo = Date.now() - 7 * 86400000
  return history
    .filter(h => new Date(h.date).getTime() >= weekAgo)
    .reduce((sum, h) => sum + h.count, 0)
}

export function getWeeklyBudgetInfo() {
  const config = getSafetyConfig()
  const weeklyLimit = config.weeklyLimit || 200
  const used = getWeeklyCount()
  const remaining = Math.max(0, weeklyLimit - used)

  // Count active sending days in the last 7 days
  const history = getWeeklyHistory()
  const weekAgo = Date.now() - 7 * 86400000
  const activeDays = history.filter(h =>
    new Date(h.date).getTime() >= weekAgo && h.count > 0
  ).length

  // Recommendation: after 3+ active days, suggest a rest day
  let restAdvice = null
  if (activeDays >= 4) {
    restAdvice = 'מומלץ מאוד יום מנוחה — שלחת 4+ ימים השבוע'
  } else if (activeDays >= 3 && used > weeklyLimit * 0.7) {
    restAdvice = 'מומלץ יום מנוחה — ניצלת מעל 70% מהתקציב השבועי'
  }

  return {
    used,
    limit: weeklyLimit,
    remaining,
    activeDays,
    restAdvice,
    exceeded: used >= weeklyLimit,
  }
}

// ===== Rate Limiting =====

export function canSendNow() {
  const config = getSafetyConfig()
  const daily = getDailyCount()
  const hourly = getHourlyCount()
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentTime = currentHour * 60 + currentMinute
  const safeStart = config.safeStartHour * 60 + (config.safeStartMinute || 0)
  const safeEnd = config.safeEndHour * 60 + (config.safeEndMinute || 0)

  // Check weekly rolling budget (warmup days exempt — they have their own limits)
  if (!isWarmupEnabled()) {
    const weeklyBudget = getWeeklyBudgetInfo()
    if (weeklyBudget.exceeded) {
      // Find when the oldest day in the window expires (7 days from oldest send)
      const history = getWeeklyHistory()
      const weekAgo = Date.now() - 7 * 86400000
      const oldestInWindow = history
        .filter(h => new Date(h.date).getTime() >= weekAgo)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
      const resetDate = oldestInWindow
        ? new Date(new Date(oldestInWindow.date).getTime() + 7 * 86400000)
        : new Date(Date.now() + 86400000)

      return {
        allowed: false,
        reason: `חרגת מהתקציב השבועי (${weeklyBudget.used}/${weeklyBudget.limit} ב-7 ימים)`,
        waitUntil: resetDate,
      }
    }
  }

  // Check safe hours
  if (currentTime < safeStart || currentTime >= safeEnd) {
    const nextStart = new Date(now)
    if (currentTime >= safeEnd) {
      nextStart.setDate(nextStart.getDate() + 1)
    }
    nextStart.setHours(config.safeStartHour, config.safeStartMinute || 0, 0, 0)
    return {
      allowed: false,
      reason: `מחוץ לשעות שליחה בטוחות (${String(config.safeStartHour).padStart(2, '0')}:${String(config.safeStartMinute || 0).padStart(2, '0')}-${String(config.safeEndHour).padStart(2, '0')}:${String(config.safeEndMinute || 0).padStart(2, '0')})`,
      waitUntil: nextStart,
    }
  }

  // Check daily limit
  if (daily >= config.dailyLimit) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(config.safeStartHour, config.safeStartMinute || 0, 0, 0)
    return {
      allowed: false,
      reason: `הגעת למגבלה היומית (${daily}/${config.dailyLimit})`,
      waitUntil: tomorrow,
    }
  }

  // Check hourly limit
  if (hourly >= config.hourlyLimit) {
    const nextHour = new Date(now)
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
    return {
      allowed: false,
      reason: `הגעת למגבלה השעתית (${hourly}/${config.hourlyLimit})`,
      waitUntil: nextHour,
    }
  }

  return { allowed: true, reason: null, waitUntil: null }
}

export function getRemainingQuota() {
  const config = getSafetyConfig()
  const daily = getDailyCount()
  const hourly = getHourlyCount()

  return {
    daily: { used: daily, limit: config.dailyLimit, remaining: Math.max(0, config.dailyLimit - daily) },
    hourly: { used: hourly, limit: config.hourlyLimit, remaining: Math.max(0, config.hourlyLimit - hourly) },
  }
}

// ===== Delay Calculator =====

export function calculateDelay(messageIndex, totalMessages) {
  const config = getSafetyConfig()
  const hourly = getHourlyCount()
  const hourlyRatio = hourly / config.hourlyLimit

  // Random "coffee break" every 5-10 messages: pause 3-7 minutes
  // Green API recommends making the pattern look very human
  const breakInterval = 5 + Math.floor(Math.random() * 6) // 5-10
  if (messageIndex > 0 && messageIndex % breakInterval === 0) {
    const breakSeconds = 180 + Math.floor(Math.random() * 240) // 3-7 min
    return breakSeconds * 1000
  }

  // Base random delay with wider range for unpredictability
  let baseDelay = config.minDelay + Math.random() * (config.maxDelay - config.minDelay)

  // Progressive: increase delay as we approach limits
  if (hourlyRatio > 0.75) {
    baseDelay *= 2.0
  } else if (hourlyRatio > 0.5) {
    baseDelay *= 1.5
  }

  // Human-like jitter: ±10 seconds
  const jitter = (Math.random() * 20) - 10
  baseDelay += jitter

  // Occasional extra-long delay (15% chance: add 20-60 seconds)
  // Mimics human pausing to do something else
  if (Math.random() < 0.15) {
    baseDelay += 20 + Math.random() * 40
  }

  // Enforce minimum
  baseDelay = Math.max(baseDelay, HARD_LIMITS.minDelayFloor)

  return Math.round(baseDelay * 1000) // return milliseconds
}

// ===== Batch Planning =====

export function planBatchSchedule(totalMessages) {
  const config = getSafetyConfig()
  const dailyRemaining = config.dailyLimit - getDailyCount()
  const avgDelay = (config.minDelay + config.maxDelay) / 2

  if (totalMessages <= dailyRemaining) {
    return {
      totalDays: 1,
      batches: [{
        day: 1,
        label: 'היום',
        count: totalMessages,
        estimatedMinutes: Math.ceil((totalMessages * avgDelay) / 60),
      }],
      needsSplit: false,
    }
  }

  // Get base daily limit (before warmup reduction) for future day calculations
  const level = getSafetyLevel()
  const preset = PRESETS[level] || PRESETS.moderate
  const baseDailyLimit = Math.min(preset.dailyLimit, HARD_LIMITS.maxDailyLimit)
  const warmupDay = getWarmupDay()
  const warmupActive = isWarmupEnabled()

  const batches = []
  let remaining = totalMessages
  let day = 1

  // Today: use current remaining quota
  const todayCount = Math.min(remaining, Math.max(0, dailyRemaining))
  if (todayCount > 0) {
    batches.push({
      day, label: 'היום', count: todayCount,
      estimatedMinutes: Math.ceil((todayCount * avgDelay) / 60),
    })
    remaining -= todayCount
    day++
  }

  // Future days: account for warmup progression (limits increase daily)
  while (remaining > 0 && day <= 30) {
    let futureDayLimit = baseDailyLimit
    if (warmupActive) {
      const futureWarmupDay = warmupDay + (day - 1)
      const mult = warmupMultiplierForDay(futureWarmupDay)
      futureDayLimit = mult === 0 ? 0 : Math.max(5, Math.floor(baseDailyLimit * mult))
    }

    // Skip days where sending is not allowed (warmup day 1 = 0%)
    if (futureDayLimit === 0) { day++; continue }

    const dayCount = Math.min(remaining, futureDayLimit)
    batches.push({
      day,
      label: day === 2 && todayCount > 0 ? 'מחר' : `יום ${day}`,
      count: dayCount,
      estimatedMinutes: Math.ceil((dayCount * avgDelay) / 60),
    })
    remaining -= dayCount
    day++
  }

  return {
    totalDays: batches.length,
    batches,
    needsSplit: batches.length > 1,
  }
}

// ===== Health Score =====

export function calculateHealthScore() {
  const config = getSafetyConfig()
  const daily = getDailyCount()
  const hourly = getHourlyCount()

  const now = new Date()
  const currentTime = now.getHours() * 60 + now.getMinutes()
  const safeStart = config.safeStartHour * 60 + (config.safeStartMinute || 0)
  const safeEnd = config.safeEndHour * 60 + (config.safeEndMinute || 0)

  // Daily usage (30% weight)
  const dailyRatio = daily / config.dailyLimit
  const dailyScore = Math.max(0, 100 - dailyRatio * 100)

  // Hourly usage (25% weight)
  const hourlyRatio = hourly / config.hourlyLimit
  const hourlyScore = Math.max(0, 100 - hourlyRatio * 100)

  // Time of day (20% weight)
  const inSafeHours = currentTime >= safeStart && currentTime < safeEnd
  const timeScore = inSafeHours ? 100 : 0

  // Delay adequacy (25% weight)
  const delayScore = config.minDelay >= 25 ? 100 : config.minDelay >= 17 ? 70 : 40

  const totalScore = Math.round(
    dailyScore * 0.3 + hourlyScore * 0.25 + timeScore * 0.2 + delayScore * 0.25
  )

  let level = 'safe'
  if (totalScore < 40) level = 'danger'
  else if (totalScore < 70) level = 'caution'

  const factors = []

  if (dailyRatio < 0.6) factors.push({ factor: 'מכסה יומית', status: 'good', detail: `${daily}/${config.dailyLimit}` })
  else if (dailyRatio < 0.85) factors.push({ factor: 'מכסה יומית', status: 'warning', detail: `${daily}/${config.dailyLimit} - מתקרב למגבלה` })
  else factors.push({ factor: 'מכסה יומית', status: 'bad', detail: `${daily}/${config.dailyLimit} - קרוב למגבלה!` })

  if (hourlyRatio < 0.6) factors.push({ factor: 'מכסה שעתית', status: 'good', detail: `${hourly}/${config.hourlyLimit}` })
  else if (hourlyRatio < 0.85) factors.push({ factor: 'מכסה שעתית', status: 'warning', detail: `${hourly}/${config.hourlyLimit} - מתקרב` })
  else factors.push({ factor: 'מכסה שעתית', status: 'bad', detail: `${hourly}/${config.hourlyLimit} - קרוב!` })

  factors.push({ factor: 'שעות בטוחות', status: inSafeHours ? 'good' : 'bad', detail: inSafeHours ? 'בתוך חלון שליחה' : 'מחוץ לשעות בטוחות' })

  return { score: totalScore, level, factors }
}

// ===== Message Variation =====

const GREETINGS = ['שלום', 'היי', 'הי', 'שלום לך', 'הי שלום']
const SYNONYMS = [
  ['נשמח', 'שמחים'],
  ['מזמינים', 'מחכים'],
  ['נתראה', 'מחכים לך'],
  ['תודה', 'תודה רבה'],
  ['מגיע/ה', 'מגיעה/מגיע'],
  ['נשמח לדעת', 'חשוב לנו לדעת'],
  ['ממתינים', 'מצפים'],
  ['מתקרב', 'בקרוב'],
]

const EMOJI_SWAPS = {
  '🎉': ['🥳', '✨', '🎊'],
  '💛': ['❤️', '💜', '🧡'],
  '👋': ['✋', '🤗', '👏'],
  '🙏': ['💛', '❤️', '🤗'],
}

export function applyMessageVariation(message, guestIndex) {
  if (!message) return message

  let varied = message
  const seed = guestIndex || 0

  // Greeting variation
  for (const greeting of GREETINGS) {
    if (varied.startsWith(greeting + ' ') || varied.startsWith(greeting + '\n')) {
      const replacement = GREETINGS[seed % GREETINGS.length]
      varied = replacement + varied.slice(greeting.length)
      break
    }
  }

  // Synonym swapping — apply up to 2 swaps per message
  const swapCount = 1 + (seed % 2)
  for (let s = 0; s < swapCount; s++) {
    const pairIdx = (seed + s) % SYNONYMS.length
    const synonymPair = SYNONYMS[pairIdx]
    if (varied.includes(synonymPair[0])) {
      varied = varied.replace(synonymPair[0], synonymPair[1])
    }
  }

  // Emoji variation — swap some emojis based on seed
  for (const [original, alternatives] of Object.entries(EMOJI_SWAPS)) {
    if (varied.includes(original) && (seed + original.length) % 3 !== 0) {
      const replacement = alternatives[seed % alternatives.length]
      varied = varied.replace(original, replacement)
    }
  }

  // Punctuation variation
  if (seed % 4 === 0 && varied.endsWith('!')) {
    varied = varied.slice(0, -1) + '.'
  } else if (seed % 4 === 1 && varied.endsWith('.')) {
    varied = varied.slice(0, -1) + '!'
  } else if (seed % 4 === 2) {
    // Remove trailing emoji and re-add (shifts position slightly)
    varied = varied.replace(/([💛❤️🎉✨🙏])\s*$/, '') + ' ' + '💛✨🎉'[seed % 3]
  }

  // Invisible whitespace variation (zero-width spaces / thin spaces)
  if (seed % 3 === 0) {
    varied = varied.replace(/\n\n/g, '\n​\n') // zero-width space
  } else if (seed % 3 === 1) {
    varied = varied.replace(/\n\n/g, '\n \n') // thin space
  }

  // Occasional line break variation
  if (seed % 5 === 0) {
    varied = varied.replace(/\n\n/, '\n\n\n')
  }

  return varied
}

// ===== Sending Lock (prevent dual-tab sending) =====

export function acquireSendingLock() {
  const existing = localStorage.getItem('ab_sending_lock')
  if (existing) {
    const lockTime = parseInt(existing)
    if (Date.now() - lockTime < 120000) {
      return false // Another tab is sending (lock is < 2 min old)
    }
  }
  localStorage.setItem('ab_sending_lock', String(Date.now()))
  return true
}

export function refreshSendingLock() {
  localStorage.setItem('ab_sending_lock', String(Date.now()))
}

export function releaseSendingLock() {
  localStorage.removeItem('ab_sending_lock')
}

// ===== Pending Batch (resume) =====

export function savePendingBatch(data) {
  localStorage.setItem('ab_pending_batch', JSON.stringify({
    ...data,
    savedAt: new Date().toISOString(),
  }))
}

export function getPendingBatch() {
  try {
    const stored = localStorage.getItem('ab_pending_batch')
    if (!stored) return null
    const data = JSON.parse(stored)
    // Expire after 48 hours
    if (Date.now() - new Date(data.savedAt).getTime() > 48 * 60 * 60 * 1000) {
      localStorage.removeItem('ab_pending_batch')
      return null
    }
    return data
  } catch {
    return null
  }
}

export function clearPendingBatch() {
  localStorage.removeItem('ab_pending_batch')
}
