import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { checkConnection } from '../lib/whatsapp'
import {
  getSafetyLevel, setSafetyLevel as saveSafetyLevel,
  getSafetyConfig, setCustomLimits, clearCustomLimits, getPresets,
  isWarmupEnabled, setWarmupEnabled, getWarmupDay,
  getWeeklyBudgetInfo,
} from '../lib/antiBlock'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

const LEVEL_LABELS = {
  conservative: { label: '🛡️ שמרני', desc: 'הכי בטוח — מתאים למספר חדש או אחרי חסימה' },
  moderate: { label: '⚖️ מאוזן', desc: 'איזון בין מהירות לבטיחות (מומלץ)' },
  aggressive: { label: '🚀 אגרסיבי', desc: 'מהיר יותר — מתאים למספר ותיק עם היסטוריה טובה' },
}

// All localStorage key names — stored in 3 places for redundancy
const LS_KEYS = {
  instanceId:   ['greenapi_instance_id',   '_bk1_greenapi_instance_id',   '_bk2_greenapi_instance_id'],
  apiToken:     ['greenapi_api_token',      '_bk1_greenapi_api_token',      '_bk2_greenapi_api_token'],
  siteUrl:      ['site_base_url',           '_bk1_site_base_url',           '_bk2_site_base_url'],
  resendApiKey: ['resend_api_key',          '_bk1_resend_api_key',          '_bk2_resend_api_key'],
}

function lsGet(keys) {
  for (const k of keys) {
    const v = localStorage.getItem(k)
    if (v) return v
  }
  return ''
}

function lsSet(keys, value) {
  keys.forEach(k => {
    try { localStorage.setItem(k, value) } catch {}
  })
}

function lsClear(keys) {
  keys.forEach(k => { try { localStorage.removeItem(k) } catch {} })
}

export default function SettingsPage() {
  const [instanceId, setInstanceId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [status, setStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [saved, setSaved] = useState(false)

  const [safetyLevel, setSafetyLevelState] = useState('moderate')
  const [warmup, setWarmup] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [customDaily, setCustomDaily] = useState('')
  const [customHourly, setCustomHourly] = useState('')
  const [customMinDelay, setCustomMinDelay] = useState('')
  const [customMaxDelay, setCustomMaxDelay] = useState('')
  const [abSaved, setAbSaved] = useState(false)

  const [resendApiKey, setResendApiKey] = useState('')
  const [emailSaved, setEmailSaved] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)

  const importRef = useRef()

  useEffect(() => {
    // Load from localStorage (all backup keys)
    setInstanceId(lsGet(LS_KEYS.instanceId))
    setApiToken(lsGet(LS_KEYS.apiToken))
    setSiteUrl(lsGet(LS_KEYS.siteUrl))
    setResendApiKey(lsGet(LS_KEYS.resendApiKey))

    // Load anti-block settings
    setSafetyLevelState(getSafetyLevel())
    setWarmup(isWarmupEnabled())

    // Try Supabase too (best-effort — table might not exist yet)
    supabase.from('app_config').select('key,value')
      .in('key', ['greenapi_instance_id', 'greenapi_api_token', 'site_base_url', 'resend_api_key'])
      .then(({ data, error }) => {
        if (error || !data?.length) return
        const cfg = Object.fromEntries(data.map(r => [r.key, r.value]))
        if (cfg.greenapi_instance_id) { setInstanceId(cfg.greenapi_instance_id); lsSet(LS_KEYS.instanceId, cfg.greenapi_instance_id) }
        if (cfg.greenapi_api_token)   { setApiToken(cfg.greenapi_api_token);   lsSet(LS_KEYS.apiToken,   cfg.greenapi_api_token) }
        if (cfg.site_base_url)        { setSiteUrl(cfg.site_base_url);          lsSet(LS_KEYS.siteUrl,    cfg.site_base_url) }
        if (cfg.resend_api_key)       { setResendApiKey(cfg.resend_api_key);    lsSet(LS_KEYS.resendApiKey, cfg.resend_api_key) }
      })

    try {
      const stored = localStorage.getItem('ab_custom_limits')
      if (stored) {
        const custom = JSON.parse(stored)
        if (custom.dailyLimit) setCustomDaily(String(custom.dailyLimit))
        if (custom.hourlyLimit) setCustomHourly(String(custom.hourlyLimit))
        if (custom.minDelay) setCustomMinDelay(String(custom.minDelay))
        if (custom.maxDelay) setCustomMaxDelay(String(custom.maxDelay))
      }
    } catch {}
  }, [])

  const persistAll = (id, token, url, resend) => {
    // Triple-write to localStorage
    lsSet(LS_KEYS.instanceId,   id)
    lsSet(LS_KEYS.apiToken,     token)
    lsSet(LS_KEYS.siteUrl,      url.replace(/\/+$/, ''))
    lsSet(LS_KEYS.resendApiKey, resend)

    // Best-effort Supabase (silently skipped if table doesn't exist)
    supabase.from('app_config').upsert([
      { key: 'greenapi_instance_id', value: id,     updated_at: new Date().toISOString() },
      { key: 'greenapi_api_token',   value: token,  updated_at: new Date().toISOString() },
      { key: 'site_base_url',        value: url,    updated_at: new Date().toISOString() },
      { key: 'resend_api_key',       value: resend, updated_at: new Date().toISOString() },
    ]).then(() => {}).catch(() => {})
  }

  const handleSave = () => {
    persistAll(instanceId, apiToken, siteUrl, resendApiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveResend = async () => {
    setEmailSaving(true)
    persistAll(instanceId, apiToken, siteUrl, resendApiKey)
    setEmailSaved(true)
    setTimeout(() => setEmailSaved(false), 2000)
    setEmailSaving(false)
  }

  const handleCheck = async () => {
    setChecking(true)
    const result = await checkConnection()
    setStatus(result)
    setChecking(false)
  }

  const exportSettings = () => {
    const settings = {
      greenapi_instance_id: instanceId,
      greenapi_api_token: apiToken,
      site_base_url: siteUrl,
      resend_api_key: resendApiKey,
      exported_at: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crm-settings-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importSettings = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const s = JSON.parse(ev.target.result)
        const id     = s.greenapi_instance_id || instanceId
        const token  = s.greenapi_api_token   || apiToken
        const url    = s.site_base_url        || siteUrl
        const resend = s.resend_api_key       || resendApiKey
        setInstanceId(id)
        setApiToken(token)
        setSiteUrl(url)
        setResendApiKey(resend)
        persistAll(id, token, url, resend)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch {
        alert('קובץ לא תקין — ודא שזה קובץ גיבוי של ההגדרות')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const missingCredentials = !instanceId || !apiToken

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">הגדרות</h1>

      {/* Backup/Restore Card */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">💾 גיבוי ושחזור הגדרות</h2>
        <p className="text-sm text-gray-500 mb-4">
          ייצא את כל המפתחות לקובץ JSON — כך תוכל לשחזר אותם בלחיצה אחת אם יאבדו.
          <span className="font-medium text-amber-600"> מומלץ לשמור קובץ גיבוי לאחר כל שינוי.</span>
        </p>
        <div className="flex gap-3">
          <Button onClick={exportSettings} disabled={missingCredentials}>
            📤 ייצא הגדרות (JSON)
          </Button>
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            📥 שחזר מקובץ
          </Button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importSettings} />
        </div>
        {missingCredentials && (
          <p className="text-xs text-amber-600 mt-2">⚠️ הכנס מפתחות Green API לפני ייצוא</p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">כתובת האתר</h2>
        <p className="text-sm text-gray-500 mb-4">
          הכתובת שתופיע בקישורי אישור הגעה וברכה בהודעות הוואטסאפ.
          <br />
          <span className="text-amber-600">חשוב!</span> השתמש בכתובת הפרודקשן (Netlify), לא localhost.
        </p>
        <Input
          label="כתובת האתר"
          placeholder="https://your-site.netlify.app"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
        />
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">חיבור WhatsApp (Green API)</h2>
        <p className="text-sm text-gray-500 mb-4">
          כדי לשלוח הזמנות בוואטסאפ, צריך חשבון ב-
          <a href="https://green-api.com" target="_blank" rel="noopener noreferrer" className="text-gold-600 hover:underline">Green API</a>.
          אחרי שנרשמת, העתק את ה-Instance ID וה-API Token מהדשבורד שלהם.
        </p>

        <div className="space-y-4">
          <Input
            label="Instance ID"
            placeholder="1234567890"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          />
          <Input
            label="API Token"
            placeholder="abcdefghijk..."
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            type="password"
          />

          <div className="flex gap-2">
            <Button onClick={handleSave}>💾 שמור</Button>
            <Button
              variant="secondary"
              onClick={handleCheck}
              disabled={checking || !instanceId || !apiToken}
            >
              {checking ? 'בודק...' : '🔍 בדוק חיבור'}
            </Button>
          </div>

          {saved && <p className="text-sm text-green-600">✅ ההגדרות נשמרו (localStorage × 3)</p>}

          {status && (
            <div className={`text-sm p-3 rounded-lg ${status.connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {status.connected ? '✅' : '❌'} {status.message}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">איך להירשם ל-Green API?</h2>
        <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
          <li>היכנס ל-<a href="https://green-api.com" target="_blank" rel="noopener noreferrer" className="text-gold-600 hover:underline">green-api.com</a></li>
          <li>צור חשבון חינם (יש תקופת ניסיון)</li>
          <li>צור Instance חדש וסרוק את קוד ה-QR עם הוואטסאפ שלך</li>
          <li>העתק את ה-Instance ID וה-API Token לכאן</li>
        </ol>
      </Card>

      {/* Email settings for blessings */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">📧 שליחת ברכות למייל (Resend)</h2>
        <p className="text-sm text-gray-500 mb-4">
          מפתח API מ-<a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-gold-600 hover:underline">Resend</a> לשליחת הברכות אוטומטית לאחר האירוע.
        </p>
        <div className="space-y-4">
          <Input
            label="Resend API Key"
            placeholder="re_xxxxxxxxx..."
            value={resendApiKey}
            onChange={(e) => setResendApiKey(e.target.value)}
            type="password"
          />
          <Button onClick={handleSaveResend} disabled={emailSaving || !resendApiKey}>
            {emailSaving ? 'שומר...' : '💾 שמור מפתח Resend'}
          </Button>
          {emailSaved && <p className="text-sm text-green-600">✅ מפתח Resend נשמר</p>}
          <div className="bg-blue-50 text-blue-700 text-xs p-3 rounded-lg space-y-1">
            <p className="font-medium">איך להשיג מפתח Resend:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>היכנס ל-<a href="https://resend.com/signup" target="_blank" rel="noopener noreferrer" className="underline">resend.com/signup</a></li>
              <li>צור חשבון חינם</li>
              <li>לך ל-API Keys ולחץ &quot;Create API Key&quot;</li>
              <li>העתק את המפתח (מוצג פעם אחת!) והדבק כאן</li>
              <li>לחץ שמור — ואז <strong>ייצא גיבוי</strong> מהכרטיס למעלה</li>
            </ol>
          </div>
        </div>
      </Card>

      {/* Anti-blocking settings */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">הגנה מפני חסימה</h2>
        <p className="text-sm text-gray-500 mb-4">
          הגדרות למניעת חסימת החשבון בזמן שליחת הודעות.
          המערכת מגבילה את הקצב וכמות ההודעות באופן אוטומטי.
        </p>

        <div className="space-y-3 mb-6">
          <p className="text-sm font-medium text-gray-700">רמת בטיחות:</p>
          <div className="grid gap-2">
            {Object.entries(LEVEL_LABELS).map(([key, { label, desc }]) => {
              const preset = getPresets()[key]
              return (
                <button
                  key={key}
                  onClick={() => {
                    setSafetyLevelState(key)
                    saveSafetyLevel(key)
                    clearCustomLimits()
                    setCustomDaily('')
                    setCustomHourly('')
                    setCustomMinDelay('')
                    setCustomMaxDelay('')
                    setAbSaved(true)
                    setTimeout(() => setAbSaved(false), 2000)
                  }}
                  className={`text-right p-3 rounded-lg border-2 transition-colors cursor-pointer ${
                    safetyLevel === key ? 'border-gold-400 bg-gold-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-800">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {preset.dailyLimit} יומי | {preset.hourlyLimit} שעתי | {preset.minDelay}-{preset.maxDelay} שניות | {preset.weeklyLimit} שבועי
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">מצב חימום מספר חדש</p>
              <p className="text-xs text-gray-500 mt-0.5">
                מגביל את כמות ההודעות בהדרגה ב-5 ימים הראשונים.
                מומלץ אחרי חסימה, מספר חדש, או אחרי הפסקה ארוכה.
              </p>
              {warmup && getWarmupDay() > 0 && (
                <p className="text-xs text-emerald-600 mt-1">
                  יום {getWarmupDay()}/5
                  {getWarmupDay() <= 1 && ' — לא לשלוח היום (רק קבלת הודעות)'}
                  {getWarmupDay() === 2 && ' — 15% קיבולת'}
                  {getWarmupDay() === 3 && ' — 30% קיבולת'}
                  {getWarmupDay() === 4 && ' — 55% קיבולת'}
                  {getWarmupDay() === 5 && ' — 80% קיבולת'}
                </p>
              )}
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={warmup}
                onChange={(e) => { setWarmup(e.target.checked); setWarmupEnabled(e.target.checked) }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
            </label>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-3">🔒 הגנות מתקדמות (לפי המלצות Green API)</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-green-50 rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-gray-700">⌨️ סימולציית הקלדה</p>
                <p className="text-xs text-gray-500">שולח "מקליד..." לפני כל הודעה כדי להיראות אנושי</p>
              </div>
              <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">פעיל תמיד</span>
            </div>
            <div className="flex items-center justify-between bg-green-50 rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-gray-700">🔍 בדיקת מספרים</p>
                <p className="text-xs text-gray-500">בודק שהמספר קיים בוואטסאפ לפני שליחה — מונע דגלים</p>
              </div>
              <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">פעיל תמיד</span>
            </div>
            <div className="flex items-center justify-between bg-blue-50 rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-gray-700">☕ הפסקות קפה</p>
                <p className="text-xs text-gray-500">הפסקה של 3-7 דקות כל 5-10 הודעות</p>
              </div>
              <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded">אוטומטי</span>
            </div>
            <div className="flex items-center justify-between bg-blue-50 rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-gray-700">🔀 וריאציית הודעות</p>
                <p className="text-xs text-gray-500">שינויים קטנים בכל הודעה — ברכות, אימוג'י, רווחים</p>
              </div>
              <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded">אוטומטי</span>
            </div>
            {(() => {
              const wb = getWeeklyBudgetInfo()
              const ratio = wb.limit > 0 ? wb.used / wb.limit : 0
              return (
                <div className={`flex items-center justify-between rounded-lg p-3 ${ratio >= 1 ? 'bg-red-50' : ratio >= 0.7 ? 'bg-amber-50' : 'bg-green-50'}`}>
                  <div>
                    <p className="text-sm font-medium text-gray-700">📅 תקציב שבועי מתגלגל</p>
                    <p className="text-xs text-gray-500">
                      {wb.used}/{wb.limit} הודעות ב-7 ימים אחרונים ({wb.activeDays} ימי שליחה)
                      {wb.restAdvice && ` — ${wb.restAdvice}`}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${ratio >= 1 ? 'text-red-700 bg-red-100' : ratio >= 0.7 ? 'text-amber-700 bg-amber-100' : 'text-green-700 bg-green-100'}`}>
                    {wb.remaining} נותרו
                  </span>
                </div>
              )
            })()}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
            {showAdvanced ? '▲ הסתר' : '▼ הגדרות מתקדמות'}
          </button>
          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-gray-400">
                ערכים מותאמים אישית יחליפו את ערכי ברירת המחדל של הרמה שנבחרה.
                <br />מגבלות מקסימום: 200 יומי, 30 שעתי, מינימום 15 שניות השהייה.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label="מגבלה יומית" type="number" placeholder={String(getPresets()[safetyLevel]?.dailyLimit || 150)} value={customDaily} onChange={(e) => setCustomDaily(e.target.value)} />
                <Input label="מגבלה שעתית" type="number" placeholder={String(getPresets()[safetyLevel]?.hourlyLimit || 25)} value={customHourly} onChange={(e) => setCustomHourly(e.target.value)} />
                <Input label="השהייה מינימלית (שניות)" type="number" placeholder={String(getPresets()[safetyLevel]?.minDelay || 25)} value={customMinDelay} onChange={(e) => setCustomMinDelay(e.target.value)} />
                <Input label="השהייה מקסימלית (שניות)" type="number" placeholder={String(getPresets()[safetyLevel]?.maxDelay || 50)} value={customMaxDelay} onChange={(e) => setCustomMaxDelay(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => {
                  const custom = {}
                  if (customDaily) custom.dailyLimit = parseInt(customDaily)
                  if (customHourly) custom.hourlyLimit = parseInt(customHourly)
                  if (customMinDelay) custom.minDelay = parseInt(customMinDelay)
                  if (customMaxDelay) custom.maxDelay = parseInt(customMaxDelay)
                  if (Object.keys(custom).length > 0) setCustomLimits(custom)
                  setAbSaved(true)
                  setTimeout(() => setAbSaved(false), 2000)
                }}>💾 שמור הגדרות מתקדמות</Button>
                <Button variant="secondary" size="sm" onClick={() => {
                  clearCustomLimits()
                  setCustomDaily(''); setCustomHourly(''); setCustomMinDelay(''); setCustomMaxDelay('')
                  setAbSaved(true)
                  setTimeout(() => setAbSaved(false), 2000)
                }}>איפוס לברירת מחדל</Button>
              </div>
            </div>
          )}
          {abSaved && <p className="text-sm text-green-600 mt-2">✅ הגדרות הגנה נשמרו</p>}
        </div>
      </Card>
    </div>
  )
}
