import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'

const STEPS = [
  { id: 1, title: 'ברוכים הבאים', icon: '✨' },
  { id: 2, title: 'חיבור Supabase', icon: '🗄️' },
  { id: 3, title: 'בניית מסד הנתונים', icon: '🏗️' },
  { id: 4, title: 'יצירת חשבון מנהל', icon: '🔐' },
  { id: 5, title: 'חיבור WhatsApp', icon: '📱' },
]

const sha256 = async (str) => {
  const data = new TextEncoder().encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function SetupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  // Step 2 — Supabase
  const [supaUrl, setSupaUrl] = useState('')
  const [supaKey, setSupaKey] = useState('')
  const [supaStatus, setSupaStatus] = useState(null) // null | 'testing' | 'ok' | 'error'
  const [supaError, setSupaError] = useState('')

  // Step 4 — Admin
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPassword2, setAdminPassword2] = useState('')
  const [adminError, setAdminError] = useState('')

  // Step 5 — WhatsApp
  const [instanceId, setInstanceId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [waStatus, setWaStatus] = useState(null)

  const testSupabase = async () => {
    setSupaStatus('testing')
    setSupaError('')
    try {
      const client = createClient(supaUrl.trim(), supaKey.trim())
      const { error } = await client.from('app_config').select('key').limit(1)
      if (error && error.code !== 'PGRST116') throw error
      localStorage.setItem('setup_supabase_url', supaUrl.trim())
      localStorage.setItem('setup_supabase_key', supaKey.trim())
      setSupaStatus('ok')
    } catch (e) {
      setSupaStatus('error')
      setSupaError(e.message || 'לא ניתן להתחבר — בדוק את ה-URL והמפתח')
    }
  }

  const handleAdminSave = async () => {
    setAdminError('')
    if (!adminEmail.includes('@')) return setAdminError('כתובת אימייל לא תקינה')
    if (adminPassword.length < 6) return setAdminError('הסיסמה חייבת להכיל לפחות 6 תווים')
    if (adminPassword !== adminPassword2) return setAdminError('הסיסמאות אינן תואמות')
    const hash = await sha256(adminPassword)
    localStorage.setItem('setup_admin_email', adminEmail.trim().toLowerCase())
    localStorage.setItem('setup_admin_hash', hash)
    setStep(5)
  }

  const testWhatsApp = async () => {
    setWaStatus('testing')
    try {
      const res = await fetch(
        `https://api.green-api.com/waInstance${instanceId.trim()}/getStateInstance/${apiToken.trim()}`
      )
      const data = await res.json()
      if (data.stateInstance === 'authorized') {
        localStorage.setItem('greenapi_instance_id', instanceId.trim())
        localStorage.setItem('greenapi_api_token', apiToken.trim())
        setWaStatus('ok')
      } else {
        setWaStatus('error')
      }
    } catch {
      setWaStatus('error')
    }
  }

  const finishSetup = () => {
    if (instanceId && apiToken) {
      localStorage.setItem('greenapi_instance_id', instanceId.trim())
      localStorage.setItem('greenapi_api_token', apiToken.trim())
    }
    localStorage.setItem('setup_complete', 'true')
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gold-50 to-amber-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gold-800 mb-1">✨ EventCRM</h1>
          <p className="text-gray-500 text-sm">הגדרה ראשונית — שלב {step} מתוך {STEPS.length}</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                step > s.id ? 'bg-green-500 text-white' :
                step === s.id ? 'bg-gold-500 text-white shadow-md' :
                'bg-gray-200 text-gray-400'
              }`}>
                {step > s.id ? '✓' : s.id}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 w-8 ${step > s.id ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8">

          {/* Step 1 — Welcome */}
          {step === 1 && (
            <div className="text-center space-y-6">
              <div className="text-6xl">🎉</div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-3">ברוכים הבאים ל-EventCRM</h2>
                <p className="text-gray-500 leading-relaxed">
                  מערכת ניהול אירועים עם שליחת הזמנות WhatsApp, ניהול RSVP, ברכות, הוצאות והכנסות.
                  <br />
                  ההגדרה תארך כ-5 דקות בלבד.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-right">
                {[
                  ['🗄️', 'Supabase', 'מסד נתונים בחינם'],
                  ['📱', 'Green API', 'שליחת WhatsApp'],
                  ['📧', 'Resend (אופציונלי)', 'שליחת ברכות במייל'],
                  ['☁️', 'Netlify (אופציונלי)', 'אחסון בחינם'],
                ].map(([icon, name, desc]) => (
                  <div key={name} className="bg-gray-50 rounded-xl p-3 flex gap-3 items-start">
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className="font-medium text-gray-800">{name}</p>
                      <p className="text-gray-400 text-xs">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep(2)} className="w-full bg-gold-500 hover:bg-gold-600 text-white font-medium py-3 rounded-xl transition-colors">
                בואו נתחיל →
              </button>
            </div>
          )}

          {/* Step 2 — Supabase */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">חיבור Supabase</h2>
                <p className="text-sm text-gray-500">
                  צור פרויקט חינמי ב-<a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-gold-600 underline">supabase.com</a>,
                  ואז העתק מ-Project Settings → API.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project URL</label>
                  <input
                    value={supaUrl}
                    onChange={e => setSupaUrl(e.target.value)}
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">anon / public key</label>
                  <input
                    value={supaKey}
                    onChange={e => setSupaKey(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              {supaStatus === 'ok' && (
                <div className="bg-green-50 text-green-700 rounded-lg px-4 py-2 text-sm">✅ החיבור הצליח!</div>
              )}
              {supaStatus === 'error' && (
                <div className="bg-red-50 text-red-600 rounded-lg px-4 py-2 text-sm">❌ {supaError}</div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                  ← חזור
                </button>
                <button
                  onClick={testSupabase}
                  disabled={!supaUrl || !supaKey || supaStatus === 'testing'}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  {supaStatus === 'testing' ? '⏳ בודק...' : '🔍 בדוק חיבור'}
                </button>
                <button
                  onClick={() => { if (!supaUrl || !supaKey) return; localStorage.setItem('setup_supabase_url', supaUrl.trim()); localStorage.setItem('setup_supabase_key', supaKey.trim()); setStep(3) }}
                  disabled={!supaUrl || !supaKey}
                  className="flex-1 bg-gold-500 hover:bg-gold-600 text-white font-medium py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
                >
                  {supaStatus === 'ok' ? 'המשך →' : 'דלג לשלב הבא →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Schema */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">בניית מסד הנתונים</h2>
                <p className="text-sm text-gray-500">
                  פתח את פרויקט Supabase שלך → <strong>SQL Editor</strong> → <strong>New query</strong>,
                  העתק את הקוד הבא והרץ אותו.
                </p>
              </div>

              <div className="bg-gray-900 rounded-xl p-4 text-xs font-mono text-green-300 overflow-auto max-h-64 text-left" dir="ltr">
                {`-- הרץ את schema.sql מהפרויקט, או הדבק את הקוד מ-schema.sql

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date timestamptz,
  location text, location_url text,
  invitation_url text, blessing_email text,
  blessing_email_sent_at timestamptz,
  bit_link text, created_at timestamptz default now()
);

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  name text not null, phone text,
  rsvp_status text default 'pending',
  num_guests int default 0, num_children int default 0,
  table_number text, rsvp_token uuid default gen_random_uuid() unique,
  rsvp_date timestamptz, reminder_count int default 0,
  gift_amount numeric default 0, gift_description text,
  blessing_text text, created_at timestamptz default now()
);
-- ... (ראה schema.sql לסכמה המלאה)`}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                <p className="font-medium mb-1">📦 Storage Bucket</p>
                <p>לאחר הרצת ה-SQL, צור bucket בשם <code className="bg-amber-100 px-1 rounded">invitations</code> (Public) ב-Storage.</p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">← חזור</button>
                <button onClick={() => setStep(4)} className="flex-1 bg-gold-500 hover:bg-gold-600 text-white font-medium py-2 rounded-xl text-sm">
                  הרצתי את ה-SQL — המשך →
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Admin */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">יצירת חשבון מנהל</h2>
                <p className="text-sm text-gray-500">אלה הפרטים שתשתמש בהם להתחברות למערכת.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">כתובת אימייל</label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">סיסמה</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="לפחות 6 תווים"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">אימות סיסמה</label>
                  <input
                    type="password"
                    value={adminPassword2}
                    onChange={e => setAdminPassword2(e.target.value)}
                    placeholder="הקלד שוב את הסיסמה"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm"
                  />
                </div>
              </div>

              {adminError && (
                <div className="bg-red-50 text-red-600 rounded-lg px-4 py-2 text-sm">❌ {adminError}</div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">← חזור</button>
                <button
                  onClick={handleAdminSave}
                  disabled={!adminEmail || !adminPassword || !adminPassword2}
                  className="flex-1 bg-gold-500 hover:bg-gold-600 text-white font-medium py-2 rounded-xl text-sm disabled:opacity-50"
                >
                  שמור והמשך →
                </button>
              </div>
            </div>
          )}

          {/* Step 5 — WhatsApp */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">חיבור WhatsApp (Green API)</h2>
                <p className="text-sm text-gray-500">
                  צור חשבון חינמי ב-<a href="https://green-api.com" target="_blank" rel="noopener noreferrer" className="text-gold-600 underline">green-api.com</a>,
                  סרוק QR ובאזור My Instances תמצא את הפרטים.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instance ID</label>
                  <input
                    value={instanceId}
                    onChange={e => setInstanceId(e.target.value)}
                    placeholder="1234567890"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Token</label>
                  <input
                    value={apiToken}
                    onChange={e => setApiToken(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none text-sm font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              {waStatus === 'ok' && (
                <div className="bg-green-50 text-green-700 rounded-lg px-4 py-2 text-sm">✅ WhatsApp מחובר!</div>
              )}
              {waStatus === 'error' && (
                <div className="bg-red-50 text-red-600 rounded-lg px-4 py-2 text-sm">❌ לא ניתן להתחבר — בדוק את הפרטים ואת ה-QR</div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                ניתן לדלג ולהגדיר מאוחר יותר בדף ההגדרות.
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(4)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">← חזור</button>
                {instanceId && apiToken && waStatus !== 'ok' && (
                  <button
                    onClick={testWhatsApp}
                    disabled={waStatus === 'testing'}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm"
                  >
                    {waStatus === 'testing' ? '⏳...' : '🔍 בדוק'}
                  </button>
                )}
                <button onClick={finishSetup} className="flex-1 bg-gold-500 hover:bg-gold-600 text-white font-medium py-2 rounded-xl text-sm">
                  {instanceId && apiToken ? 'סיים הגדרה →' : 'דלג — השלם מאוחר יותר →'}
                </button>
              </div>
            </div>
          )}

        </div>

        <p className="text-center text-xs text-gray-400 mt-4">EventCRM — Open Source MIT License</p>
      </div>
    </div>
  )
}
