# ✨ EventCRM

מערכת ניהול אירועים עברית עם שליחת הזמנות WhatsApp, ניהול RSVP, ברכות, הוצאות והכנסות.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/azuraroni-ops/eventcrm)

---

## תכונות

- 📋 **ניהול אירועים** — צור אירועים, העלה הזמנה, נהל רשימת מוזמנים
- 📱 **שליחת WhatsApp** — שלח הזמנות עם תמונה דרך Green API, מערכת anti-block מובנית
- ✅ **RSVP** — קישור אישי לכל אורח, ניהול אישורי הגעה ומספר אורחים
- 💌 **ברכות** — אסוף ברכות מהאורחים, שלח במייל אוטומטי לאחר האירוע
- 🪑 **סידור שולחנות** — גרור-ושחרר עם מספרי שולחן
- 💰 **כספים** — מעקב הוצאות, רישום מתנות, ניתוח ממוצעים, שליחת הודעות תודה
- 📊 **דשבורד** — סטטיסטיקות בזמן אמת

## דרישות מקדימות

| שירות | מטרה | עלות |
|---|---|---|
| [Supabase](https://supabase.com) | מסד נתונים + אחסון קבצים | חינם |
| [Green API](https://green-api.com) | שליחת הודעות WhatsApp | חינם (Developer) |
| [Netlify](https://netlify.com) | אחסון האתר | חינם |
| [Resend](https://resend.com) | שליחת ברכות במייל | אופציונלי |

## התקנה מהירה

### אפשרות א׳ — Deploy to Netlify (הכי מהיר)

1. לחץ על כפתור **Deploy to Netlify** למעלה
2. חבר GitHub account
3. הוסף Environment Variables: `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY`
4. פתח את האתר — ה-Setup Wizard יופיע אוטומטית

### אפשרות ב׳ — התקנה מקומית

```bash
git clone https://github.com/azuraroni-ops/eventcrm.git
cd eventcrm
npm install
cp .env.example .env
# ערוך את .env עם פרטי Supabase
npm run dev
```

פתח `http://localhost:5173` — ה-Setup Wizard יופיע.

## הגדרת Supabase

1. צור פרויקט ב-[supabase.com](https://supabase.com)
2. Project Settings → API → העתק **Project URL** ו-**anon/public key**
3. SQL Editor → New query → הדבק את תוכן `schema.sql` → Run
4. Storage → New bucket → שם: `invitations` → Public: ✅

## הגדרת Green API

1. הירשם ב-[green-api.com](https://green-api.com) (חינם עד 50 הודעות/יום)
2. My Instances → צור Instance חדש
3. סרוק QR עם WhatsApp → Instance Authorized ✅
4. העתק **ID Instance** ו-**API TokenInstance**
5. הזן בשלב 5 של ה-Setup Wizard (או בדף הגדרות)

## מבנה הפרויקט

```
src/
├── pages/
│   ├── SetupPage.jsx       # Wizard הקמה ראשונית
│   ├── LoginPage.jsx       # התחברות
│   ├── DashboardPage.jsx   # דשבורד ראשי
│   ├── EventsPage.jsx      # רשימת אירועים
│   ├── SendPage.jsx        # שליחת הזמנות
│   ├── RemindersPage.jsx   # תזכורות
│   ├── RsvpPage.jsx        # דף RSVP ציבורי
│   ├── FinancesPage.jsx    # הוצאות והכנסות
│   └── SettingsPage.jsx    # הגדרות
├── lib/
│   ├── supabase.js         # Supabase client
│   ├── whatsapp.js         # Green API — שליחה
│   ├── antiBlock.js        # מניעת חסימת WhatsApp
│   └── excelParser.js      # ייבוא רשימות מ-Excel
└── components/ui/          # Button, Card, Modal, Input...
```

## Anti-Block System

מערכת מובנית למניעת חסימת WhatsApp:
- 3 רמות בטיחות: שמרנית / מתונה / אגרסיבית
- מגבלות יומיות / שעתיות / שבועיות
- שעות שליחה בטוחות (ניתן להגדרה)
- וריאציית הודעות אוטומטית
- נעילת שליחה כפולה (dual-tab lock)
- מצב Warmup לחשבונות חדשים

## License

MIT © 2024 — עשה בחופשיות שימוש, העתק, ושנה.
