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
The demo buyers from `supabase/seed_demo.sql` (e.g. `maria.reyes@mednotes.test`) use the password `DemoBuyer#2026`.

### Passwords

Buyers who sign up with their email choose their own password; Supabase stores only a salted hash, so nobody
(including the publisher) can read it. Forgotten passwords are reset by email (**Forgot password?**).
Google/Facebook buyers have no password until they add one under **Account → Add a password**; changing a password
asks for the current one first.

## How the rules are enforced

| Rule | Where |
|---|---|
| Files are never downloadable | No storage read policy on `files`; bytes only come from the `read-file` edge function, encrypted per chunk for the reader's session key |
| Only confirmed buyers (or admins) on a registered device can open a file | `read-file` checks the purchase, `device_ok()` and suspension on every chunk |
| 1 computer + 1 phone, swaps per 30 days, admin overrides | `register_device` / `swap_device` / `remove_device` RPCs (`effective_limits()` is internal only) |
| Receipts are sequential (`OR-000001`…) | `confirm_purchase()` locks `settings` and increments `receipt_next` |
| Buyers can only edit their name, avatar and preferences | `guard_profile_update` trigger (allowlist of columns) |
| Buyers can't fake a confirmation | `purchases_insert` policy: pending only, no receipt, decider, date or admin note |
| Admin emails are private | `admin_allowlist` table, admins only |
| Uploads are limited | proofs ≤ 10 MB images/PDF; covers, payment QRs and branding ≤ 5 MB images |
| Proofs of payment are private | `proofs` bucket, readable by the buyer and admins only |
| Offline copies stay in the app | AES-GCM in the app's private storage; Android backup and device transfer are off |

The publisher's watermark (Admin → Restrictions: off, app only, or app & website; app only by default) is drawn into
PDF pages and images and laid over every other page; right-click, save/print shortcuts and DevTools are blocked in the browser and screenshots are blocked in the Android
app (`FLAG_SECURE`). These discourage copying, but nothing can stop a determined person with a second camera.

## Admin

- **Receipts**: every issued receipt (search, view, print) and the receipt design with a live sample.
- **Appearance**: a site editor showing the real sign-in, sign-up, library, file, checkout, my files, devices and
  account pages in a live preview (computer or phone size). Click any text in the preview to rewrite it; colours,
  logo, background, font and corner roundness are on the second tab. Saved wording lives in `settings.theme.copy`
  (keys in `src/lib/siteText.ts`) and reaches open copies of the website and app right away.
- **Restrictions**: device limits, watermark (where it shows, text, sample page), screenshot blocking, offline saving.

## Reader

PDFs, slides, e-books, Word and Excel files open in one reader with zoom (buttons, `+`/`-`, Ctrl + wheel), page
jump, page colour (light, sepia, dark) and full screen. **Notes** opens a side panel for typed notes (with a button
that marks the current page, slide or video time) and a sketch pad; **Draw** puts a pen, highlighter and eraser on PDF
pages, images and slides. Notes and drawings are saved per buyer per file in `reader_notes` (only that buyer can read
them) and kept on the device too, so they work offline in the app.

## GCash payments

1. In GCash, open **QR → Generate QR / My QR** and save the image (or screenshot it).
2. In MedNotes go to **Admin → Settings → GCash → Upload QR**.
3. If the image is a QR Ph code, Settings shows **"QR Ph · amount filled in automatically"**. Every checkout then shows a fresh QR with that file's exact price built in: the app sets QR Ph tag 54 and recomputes the CRC (`src/lib/qrph.ts`, tests in `scripts/qrph.test.mjs`). Otherwise buyers see your image and type the amount.

Buyers on a laptop scan the QR with their phone. On a phone they tap **Save QR**, then in GCash use **Pay QR → Upload QR**; the Android app also has **Open GCash**. Whether GCash pre-fills the amount from a *personal* QR depends on GCash, so check it once with your own QR. Payments are still confirmed by hand in **Admin → Payments**.

## Social sign-in (Google, Facebook)

The buttons appear automatically for each provider switched on in Supabase. Step-by-step setup with this project's exact URLs: [docs/oauth-setup.md](docs/oauth-setup.md).

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

**GitHub Actions** (`.github/workflows/android.yml`) builds the APK on every push to `main` (download it from the run's artifacts). To publish a release with the APK attached:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The build reads the project URL and public anon key from the committed `.env.production`. The anon key is public by design and is protected by row-level security, so no secrets are needed. Optional repository secrets:

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | override `.env.production` (e.g. a staging project) |
| `MEDNOTES_KEYSTORE_BASE64` | `base64 -w0 release.jks`, for a signed release APK |
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
