# Turning on Google and Facebook sign-in

The app already supports both; they only need OAuth apps from Google and Meta. Once a provider is switched on in Supabase, its button appears on the sign-in and sign-up pages by itself (web and APK). No rebuild needed.

Values used below:

| What | Value |
|---|---|
| Supabase callback URL (paste into Google and Facebook) | `https://jjaxqfhvswdjjydzqvud.supabase.co/auth/v1/callback` |
| Android app deep link (Supabase redirect allow-list) | `com.mednotes.elibrary://auth-callback` |
| Supabase dashboard | https://supabase.com/dashboard/project/jjaxqfhvswdjjydzqvud |
| Web app (home page) | https://unknowndevice077.github.io/MedNotes-E-Library/ |
| Privacy policy URL | https://unknowndevice077.github.io/MedNotes-E-Library/privacy |
| User data deletion URL | https://unknowndevice077.github.io/MedNotes-E-Library/data-deletion |
| App domain (Google "Authorized domains") | `unknowndevice077.github.io` |

Before registering: set your real support email in **Admin → Settings → Store → Support email**. It is shown on the privacy and data-deletion pages that Google and Meta review.

## 1. Google

1. Go to https://console.cloud.google.com/ and create a project (e.g. "MedNotes").
2. **APIs & Services → OAuth consent screen**: User type **External**. App name *MedNotes E-Library*, support email, and your app's home page and privacy policy links. Scopes: keep the defaults (`email`, `profile`, `openid`). Then **Publish app** (basic scopes don't need Google verification).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://jjaxqfhvswdjjydzqvud.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. Supabase dashboard → **Authentication → Sign In / Providers → Google** → enable, paste both, Save.

## 2. Facebook

1. Go to https://developers.facebook.com/apps → **Create app** → use case **Authenticate and request data from users with Facebook Login**.
2. **Facebook Login → Settings** → Valid OAuth Redirect URIs: `https://jjaxqfhvswdjjydzqvud.supabase.co/auth/v1/callback`
3. **App settings → Basic**: add a Privacy Policy URL and a User data deletion URL (Facebook requires both before the app can go Live), then copy the **App ID** and **App secret**.
4. **Use cases → Facebook Login → Permissions**: make sure `email` is added.
5. Switch the app from **Development** to **Live** (top bar). In Development mode only people with a role on the app can sign in.
6. Supabase dashboard → **Authentication → Sign In / Providers → Facebook** → enable, paste App ID + App secret, Save.

## 3. Supabase redirect settings (once)

Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://unknowndevice077.github.io/MedNotes-E-Library/`
- **Redirect URLs**: add
  - `https://unknowndevice077.github.io/MedNotes-E-Library/**` (the web app)
  - `com.mednotes.elibrary://auth-callback` (the Android app)

## Check

Open the sign-in page: the Google / Facebook buttons should appear. In the Android app, signing in opens the browser and returns to the app through the deep link.
