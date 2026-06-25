# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build to dist/
npm run preview      # Preview production build locally
npm run lint         # ESLint
npx netlify deploy --prod --dir=dist  # Deploy to Netlify
```

## Architecture

**Hebrew RTL event invitation management app** — manages events, guest lists, WhatsApp invitations, RSVP responses, blessings, and reminders. Single-user app with client-side password auth.

### Stack
- **Frontend:** React 19 + Vite 8, plain JSX (no TypeScript), Tailwind CSS v4 (using `@import "tailwindcss"` + `@theme` in index.css)
- **Backend:** Supabase (Postgres DB + Storage + pg_cron for scheduled tasks)
- **WhatsApp:** Green API (green-api.com) for sending messages/images
- **Email:** Resend API for automated blessing emails (called from pg_cron via pg_net)
- **Hosting:** Netlify with SPA redirect (`netlify.toml`)

### Key Architectural Patterns

**No global state management** — each page fetches its own data with `useState` + `useEffect`. Supabase client is a singleton in `src/lib/supabase.js`.

**Credentials storage** — Green API instance ID and API token are stored in `localStorage` (not in `.env`). Resend API key is stored in `app_config` Supabase table.

**Auth** — Client-side only. `LoginPage.jsx` hashes password with SHA-256 and compares against credentials set in Setup Wizard (stored in `localStorage`). Session stored in `localStorage` as `crm_auth` with 7-day expiry. Brute-force protection (5 attempts, 15-min lockout).

**Setup Wizard** — First-run experience at `/setup`. Guides the user through Supabase connection, DB schema, admin credentials, and Green API configuration. Sets `setup_complete=true` in localStorage when done.

**Public vs protected routes** — RSVP (`/rsvp/:token`), blessing (`/blessing/:token`), and RSVP preview (`/rsvp/preview/:eventId`) are public. Everything else is wrapped in `ProtectedRoutes`.

### Anti-Block System (`src/lib/antiBlock.js`)
Rate-limiting layer to prevent WhatsApp account bans. Three safety presets (conservative/moderate/aggressive) with hard limits (max 200/day, 30/hour, 60s min delay). Features:
- Daily/hourly counters in localStorage, synced to `sending_sessions` Supabase table
- Progressive delays that increase as quotas approach limits
- Safe sending hours enforcement
- Message variation (greeting swaps, synonym rotation, punctuation changes)
- Dual-tab sending lock
- Warmup mode for new numbers (gradual quota increase over 5 days)
- Batch planning across multiple days when message count exceeds daily quota

Both `SendPage` and `RemindersPage` share this system — counters are global across both pages.

### WhatsApp Sending (`src/lib/whatsapp.js`)
Two main functions: `sendMessage` (text only) and `sendImage` (image + caption). Phone numbers are normalized to `972XXXXXXXXX@c.us` format. URL shortening via is.gd for RSVP links.

### Supabase Schema
See `schema.sql` in the project root for the full schema.

**Tables:** `events`, `guests`, `messages`, `blessings`, `sending_sessions`, `app_config`, `expenses`

Key relationships:
- `guests.event_id` → `events.id`
- `guests.rsvp_token` — unique token for public RSVP/blessing links
- `blessings.guest_id` → `guests.id`, `blessings.event_id` → `events.id`

**Storage:** `invitations` bucket for event invitation images (public access)

**Server-side:** `send_blessings_emails()` PL/pgSQL function runs hourly via pg_cron. Sends collected blessings via Resend API (pg_net HTTP) to `events.blessing_email` 4 hours after event ends.

### Sending Flow (SendPage / RemindersPage)
1. Select event → choose recipients → template with placeholders (`{שם}`, `{קישור_אישור}`, etc.)
2. Before loop: `syncCountersFromSupabase()`, check `canSendNow()`
3. Per message: `applyMessageVariation()` → `sendImage()` or `sendMessage()` → `incrementCounters()` + `recordSend()`
4. Delay between messages: `calculateDelay()` (progressive, with jitter)
5. Pending reminders send invitation image; confirmed reminders send text only

### Excel Import (`src/lib/excelParser.js`)
Reads `.xlsx` files via `xlsx` library. Expects column A = name, column B = phone. Auto-detects and skips header rows. Max 5000 guests per import.

## Conventions

- All UI text and error messages in **Hebrew**
- RTL layout: `dir="rtl"` on body, Tailwind gradients use `from-X to-Y` (visually right-to-left)
- Custom gold color palette defined in `src/index.css` under `@theme` (gold-50 through gold-900)
