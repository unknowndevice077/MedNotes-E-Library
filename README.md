# MedNotes E-Library

Medical notes, e-books, lectures and slides. Buyers preview the cover for free, pay by GCash / Maya / bank transfer, upload proof, and the publisher confirms the payment. That issues a numbered receipt and unlocks the file on the buyer's devices (1 computer + 1 phone by default, Netflix-style).

- **Web app** (desktop/laptop, runs in the browser, nothing to install): React + Vite.
- **Android app (APK)**: the same React app wrapped with Capacitor, plus offline saving (encrypted), screenshot blocking and one-time sign-in.
- **Backend**: Supabase (Postgres + Auth + Storage). All access rules live in the database (`supabase/migrations`).
- **Design**: Figma file `g0Tk1TPiZ1U9RTgdViUhoQ` (sources in `design/`).

## Run it locally

Needs Node 22, Docker Desktop running.

```bash
npm install
npm run db:start          # local Supabase in Docker: applies migrations + seed
npm run seed:storage      # uploads sample covers and files into local storage
cp .env.example .env.local   # then paste the anon key from `npm run db:status`
npm run dev               # http://localhost:5173
```

Local test accounts (seed only, they don't exist anywhere else):

| Role | Email | Password |
|---|---|---|
| Admin / publisher | `admin@mednotes.test` | `MedNotesAdmin#2026` |
| Client | `juan@mednotes.test` | `MedNotesReader#2026` |

`npm run seed:samples` regenerates the sample EPUB/PDF/DOCX/PPTX/XLSX/MP4 files (the MP4 needs ffmpeg on PATH).

## How the rules are enforced

| Rule | Where |
|---|---|
| Only confirmed buyers (or admins) can open a file | Storage RLS policy `files_read`: signed links are refused otherwise |
| 1 computer + 1 phone, swaps per 30 days, admin overrides | `register_device` / `swap_device` / `remove_device` RPCs and `effective_limits()` |
| Reader requires a registered device | `device_ok()` RPC checked before a signed link is created |
| Receipts are sequential (`OR-000001`…) | `confirm_purchase()` locks `settings` and increments `receipt_next` |
| Clients can't change roles / limits | `guard_profile_update` trigger |
| Proofs of payment are private | `proofs` bucket, readable by the buyer and admins only |

The watermark, disabled right-click and screenshot blocking (Android `FLAG_SECURE`) discourage copying, but nothing can stop a determined person with a second camera. That's why every view carries the buyer's email.

## Social sign-in (Google, Facebook)

1. **Google**: Google Cloud Console → OAuth client (Web). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Facebook**: Meta for Developers → app with Facebook Login. Valid OAuth redirect URI: the same Supabase callback URL.
3. Supabase dashboard → Authentication → Providers: paste the client ID and secret for each.
4. Authentication → URL Configuration: add your site URL (e.g. `https://mednotes.vercel.app`) and `com.mednotes.elibrary://auth-callback` (the Android app's deep link) to the redirect allow-list.

For local testing put the IDs/secrets in `supabase/.env` (see `supabase/config.toml`) and set `enabled = true`.

## Deploy

**Database.** Link your Supabase project and push the migrations:

```bash
npx supabase link --project-ref jjaxqfhvswdjjydzqvud
npx supabase db push
```

Then make your own account an admin (SQL editor): `update public.profiles set role = 'admin' where email = 'you@example.com';`
Don't run `seed.sql` in production; it only creates test accounts.

**Web.** Any static host (Vercel, Netlify, Cloudflare Pages). Build command `npm run build`, output `dist`, env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PLAY_STORE_URL`. Add an SPA rewrite so every path serves `index.html`.

## Android APK

**On this PC** (needs JDK 17 and the Android SDK; set `ANDROID_HOME`):

```bash
npm run apk:debug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The APK talks to whatever `VITE_SUPABASE_URL` was set at build time. A phone can't reach `127.0.0.1`, so build with your cloud project's URL and key.

**GitHub Actions** (`.github/workflows/android.yml`) builds on every push to `main` and on manual runs, then uploads the APKs as an artifact. Repository secrets:

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://jjaxqfhvswdjjydzqvud.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `MEDNOTES_KEYSTORE_BASE64` *(optional)* | `base64 -w0 release.jks`, for a signed release APK |
| `MEDNOTES_KEYSTORE_PASSWORD`, `MEDNOTES_KEY_ALIAS`, `MEDNOTES_KEY_PASSWORD` | keystore details |

Create a release keystore once and keep it safe; Google Play needs the same key for every update:

```bash
keytool -genkeypair -v -keystore release.jks -alias mednotes -keyalg RSA -keysize 2048 -validity 10000
```

## Project layout

```
src/            React app (pages/, admin/, components/, lib/)
supabase/       config, migrations (schema + RLS + RPCs), seed, sample files
android/        Capacitor Android project (deep link, FLAG_SECURE, icons)
scripts/        sample-file generator, storage seeder, icon generator
design/         logo, QR, background photos (see design/backgrounds/CREDITS.md)
```
