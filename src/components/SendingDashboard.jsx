import { useState, useEffect } from 'react'
import { getRemainingQuota, calculateHealthScore, planBatchSchedule, isWarmupEnabled, getWarmupDay, getSafetyConfig, getWeeklyBudgetInfo } from '../lib/antiBlock'
import Card from './ui/Card'

function ProgressBar({ used, limit, label }) {
  const ratio = limit > 0 ? used / limit : 0
  const percent = Math.min(100, Math.round(ratio * 100))
  const color = ratio < 0.6 ? 'bg-green-500' : ratio < 0.85 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-14 text-left">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-16 text-left">{used}/{limit}</span>
    </div>
  )
}

function HealthDot({ level }) {
  const colors = {
    safe: 'bg-green-500',
    caution: 'bg-amber-500',
    danger: 'bg-red-500',
  }
  const labels = {
    safe: 'בטוח',
    caution: 'זהירות',
    danger: 'סכנה',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium`}>
      <span className={`w-2.5 h-2.5 rounded-full ${colors[level]} animate-pulse`} />
      {labels[level]}
    </span>
  )
}

function WaitCountdown({ until }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const update = () => {
      if (!until) return
      const diff = new Date(until).getTime() - Date.now()
      if (diff <= 0) { setTimeLeft('ממשיך בקרוב...'); return }
      const hours = Math.floor(diff / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setTimeLeft(hours > 0
        ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${mins}:${String(secs).padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [until])

  return <span className="text-2xl font-mono font-bold text-purple-700">{timeLeft}</span>
}

export default function SendingDashboard({ totalToSend, isSending, progress, nextDelay, waitInfo, onSettingsClick }) {
  const [quota, setQuota] = useState(null)
  const [health, setHealth] = useState(null)
  const [batchPlan, setBatchPlan] = useState(null)

  useEffect(() => {
    updateStatus()
    const interval = setInterval(updateStatus, 5000)
    return () => clearInterval(interval)
  }, [totalToSend, progress])

  const updateStatus = () => {
    setQuota(getRemainingQuota())
    setHealth(calculateHealthScore())
    if (totalToSend > 0) {
      setBatchPlan(planBatchSchedule(totalToSend))
    }
  }

  if (!quota || !health) return null

  const config = getSafetyConfig()
  const warmup = isWarmupEnabled()
  const warmupDay = getWarmupDay()

  return (
    <div className="space-y-3">
      {/* Warmup Banner */}
      {warmup && warmupDay <= 5 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-3">
          <span className="text-lg">🌱</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-800">מצב חימום — יום {warmupDay}/5</p>
            <p className="text-xs text-emerald-600">
              {warmupDay <= 1 ? 'לא לשלוח היום — רק קבלת הודעות' : `מגבלה יומית מופחתת: ${config.dailyLimit} הודעות`}
            </p>
          </div>
        </div>
      )}

      {/* Quota Card */}
      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">📊 מצב שליחה</span>
            <HealthDot level={health.level} />
          </div>
          {onSettingsClick && (
            <button onClick={onSettingsClick} className="text-xs text-gray-400 hover:text-gold-600 cursor-pointer">
              ⚙️ הגדרות
            </button>
          )}
        </div>

        <div className="space-y-2">
          <ProgressBar used={quota.daily.used} limit={quota.daily.limit} label="יומי" />
          <ProgressBar used={quota.hourly.used} limit={quota.hourly.limit} label="שעתי" />
        </div>

        {/* Health factors */}
        {health.level !== 'safe' && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {health.factors.filter(f => f.status !== 'good').map((f, i) => (
              <p key={i} className={`text-xs ${f.status === 'warning' ? 'text-amber-600' : 'text-red-600'}`}>
                {f.status === 'warning' ? '⚠️' : '🔴'} {f.factor}: {f.detail}
              </p>
            ))}
          </div>
        )}
        {/* Weekly budget info */}
        {(() => {
          const wb = getWeeklyBudgetInfo()
          const ratio = wb.limit > 0 ? wb.used / wb.limit : 0
          if (wb.used === 0) return null
          return (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500">תקציב שבועי</span>
                <span className={ratio >= 1 ? 'text-red-600 font-medium' : ratio >= 0.7 ? 'text-amber-600' : 'text-gray-500'}>
                  {wb.used}/{wb.limit}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ratio >= 1 ? 'bg-red-500' : ratio >= 0.7 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                />
              </div>
              {wb.restAdvice && (
                <p className="text-xs text-amber-600 mt-1">💤 {wb.restAdvice}</p>
              )}
            </div>
          )
        })()}
      </Card>

      {/* Batch Plan (when needs split) */}
      {batchPlan && batchPlan.needsSplit && !isSending && (
        <Card className="!p-4 border-2 border-amber-200 bg-amber-50/30">
          <p className="text-sm font-medium text-amber-800 mb-2">
            ⚠️ {totalToSend} הודעות חורגות מהמגבלה היומית ({config.dailyLimit})
          </p>
          <p className="text-xs text-gray-600 mb-3">תוכנית שליחה מומלצת:</p>
          <div className="space-y-1">
            {batchPlan.batches.map((batch, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-gray-700">📅 {batch.label}</span>
                <span className="text-gray-500">{batch.count} הודעות (~{batch.estimatedMinutes} דקות)</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">סה"כ: {totalToSend} הודעות ב-{batchPlan.totalDays} ימים</p>
        </Card>
      )}

      {/* Waiting for next sending window */}
      {waitInfo && (
        <Card className="!p-4 bg-purple-50 border-2 border-purple-300">
          <div className="text-center space-y-3">
            <p className="text-lg">⏳</p>
            <p className="text-sm font-bold text-purple-800">{waitInfo.reason}</p>
            <p className="text-sm text-purple-600">
              {waitInfo.remaining} הודעות ממתינות — השליחה תמשיך אוטומטית
            </p>
            {waitInfo.until && <WaitCountdown until={waitInfo.until} />}
            <p className="text-xs text-gray-500 mt-1">
              השאר את הדף פתוח. השליחה תמשיך כשחלון השליחה ייפתח.
            </p>
          </div>
        </Card>
      )}

      {/* Sending Progress */}
      {isSending && progress && (
        <Card className="!p-4 bg-blue-50/30 border border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-800">
              📤 שולח... {progress.sent + progress.failed}/{progress.total}
            </span>
            {nextDelay > 0 && (
              <span className="text-xs text-blue-600">⏱️ הבא בעוד {nextDelay}s</span>
            )}
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(((progress.sent + progress.failed) / progress.total) * 100)}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs">
            <span className="text-green-600">✅ {progress.sent}</span>
            {progress.failed > 0 && <span className="text-red-600">❌ {progress.failed}</span>}
            <span className="text-gray-500">יומי: {quota.daily.used}/{quota.daily.limit}</span>
            <span className="text-gray-500">שעתי: {quota.hourly.used}/{quota.hourly.limit}</span>
          </div>
        </Card>
      )}
    </div>
  )
}
