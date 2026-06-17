# Deploying to pinnavel.com (Vercel + Neon Postgres)

This is a **full-stack Next.js app** (server components, API routes, server-side
auth, a Postgres database). It **cannot** run on GitHub Pages (static only) — it
needs a Node host. This guide uses **Vercel** (runs Next.js natively) + **Neon**
(serverless Postgres).

The code is production-ready; the steps below require *your* accounts and a DNS
change, so they're yours to do. Nothing here is destructive to pinnavel.com until
the final DNS step.

---

## 1. Create the database (Neon)

1. Sign up at https://neon.tech and create a project (any region near your users).
2. Copy the **pooled** connection string. It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`

## 2. Create the Vercel project

1. At https://vercel.com, **Import** the GitHub repo (`business_website_1a`).
2. Framework preset: **Next.js** (auto-detected). Build command stays `npm run build`
   (it runs `prisma generate && next build`).
3. Add **Environment Variables** (Production + Preview):
   - `DATABASE_URL` → your Neon pooled string from step 1
   - `ADMIN_EMAILS` → comma-separated admin emails (e.g. `you@pinnavel.com`)
   - `SIGNUP_INVITE_CODE` → a secret code to allow invited signups, **or leave unset**
     to keep signup fully closed (accounts created via the CLI — step 4).
   - `GOOGLE_AUTH_CLIENT_ID` / `GOOGLE_AUTH_CLIENT_SECRET` / `GOOGLE_AUTH_REDIRECT_URI` →
     enable "Sign in with Google" (see *Sign in with Google* below); leave unset to hide the button.
   - `ENCRYPTION_KEY` → 32+ random characters; encrypts stored OAuth tokens and signs the login CSRF state.
   - `RESEND_API_KEY` / `EMAIL_FROM` → send the "forgot password" reset email (see *Forgot-password
     email* below); leave both unset and reset links are only logged server-side (no email sent).
4. Deploy. You'll get a `https://<project>.vercel.app` URL.

## 3. Push the schema to the database (one time)

From your machine, with the Neon URL:

```bash
DATABASE_URL="postgresql://...neon...?sslmode=require" npx prisma db push
```

> Re-run this same command whenever `prisma/schema.prisma` changes. The admin
> board's task cards (title, description, contributor/creator initials, due date,
> category + ticket-size tags) add **nullable** columns to `AdminTask`, so the
> push is additive — existing tasks are preserved.

## 4. Create the first admin account

Signup is locked, so seed yourself directly (uses bcrypt + honors `ADMIN_EMAILS`):

```bash
DATABASE_URL="postgresql://...neon...?sslmode=require" \
  node scripts/create-user.mjs you@pinnavel.com 'a-strong-password' 'Your Name' --admin
```

## 5. Verify on the *.vercel.app URL (before touching DNS)

- Log in with the account from step 4.
- Check the Plan page, Connections, Settings, and the admin **Board** (`/admin`).
- Confirm `/signup` shows "invite only" (or accepts your invite code if you set one).

## 6. Cut pinnavel.com over to Vercel (the go-live step)

> pinnavel.com currently points at GitHub Pages. This step moves it to Vercel and
> **replaces the old business site.** Do it only after step 5 looks good.

1. **Vercel → Project → Settings → Domains:** add `pinnavel.com` and `www.pinnavel.com`.
   Vercel will show the exact DNS records to set.
2. **At your domain registrar**, replace the GitHub Pages records with Vercel's:
   - Apex `pinnavel.com`: remove the four `185.199.108–111.153` A records; add Vercel's
     A record `76.76.21.21` (use whatever Vercel shows).
   - `www`: change the CNAME from `jakobassistant1-lang.github.io` to `cname.vercel-dns.com`.
3. **Release the domain from GitHub Pages:** in the old Pages setup (the repo that served
   pinnavel.com), remove the custom domain so it doesn't claim `pinnavel.com`. *(Since this
   repo's code was replaced with the app, GitHub Pages for it is effectively retired.)*
4. Wait for DNS propagation + Vercel's automatic SSL (minutes to a couple hours).

---

## Sign in with Google (optional)

Adds a "Continue with Google" button to the student login/signup. Give it its **own**
OAuth client — separate from the Google *Calendar* client — so it only ever requests
basic profile info, which keeps it out of Google's verification process.

1. **Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application.**
2. **Authorized redirect URI:** `https://pinnavel.com/api/auth/google/callback`
   (add `http://localhost:3000/api/auth/google/callback` too for local dev).
3. **OAuth consent screen:** request only the `openid`, `email`, and `profile` scopes
   (all non-sensitive), set User type **External**, then **Publish to Production**.
   Because the scopes are non-sensitive this is effectively instant — **no Google
   verification review** is required (this is the key difference from the calendar
   integration, whose calendar scope is sensitive).
4. In Vercel, set `GOOGLE_AUTH_CLIENT_ID`, `GOOGLE_AUTH_CLIENT_SECRET`, and
   `GOOGLE_AUTH_REDIRECT_URI` (the exact callback URL from step 2). The button only
   appears once all three are present.

New Google sign-ins create a **passwordless** account and **auto-link** to any existing
account with the same verified email, so there are never duplicate accounts.

## Forgot-password email (Resend)

The "Forgot password?" flow emails a one-time reset link, sent via **Resend**.

1. Create an account at https://resend.com.
2. **Add your domain** (`pinnavel.com`) and add the **SPF** (TXT) + **DKIM** (CNAME/TXT)
   records Resend shows at your registrar; wait until it reads "Verified".
3. Create an **API key**.
4. In Vercel set `RESEND_API_KEY` (the key) and `EMAIL_FROM` (an address on the verified
   domain, e.g. `StudyPlan <noreply@pinnavel.com>`) — Production + Preview.
5. The reset-link base URL reuses `GOOGLE_AUTH_REDIRECT_URI`'s origin (falling back to the
   request origin), so no extra URL variable is needed.

Until both vars are set the flow still works end-to-end, but instead of sending, the reset
link is **logged to the server console** — so local dev and staging never need Resend.

## Local development

Local dev now also uses Postgres (the app no longer uses a SQLite file). Point a
Neon dev branch (or any Postgres) at `DATABASE_URL` in `.env`, then:

```bash
npm install
npm run db:push        # create tables
npm run create-user you@example.com 'password123' 'You' --admin
npm run dev
```

## Security notes

- **Passwords** are bcrypt-hashed (12 rounds). **Signup is invite-only / closed.**
- **Password reset** tokens are random (32 bytes), stored only as a **sha256 hash**,
  single-use, and expire after 1 hour; completing a reset invalidates the user's existing
  sessions. The request endpoint never reveals whether an email has an account.
- The **Canvas API token is still stored in plaintext** in the DB. That's acceptable
  for a trusted-team deploy; encrypt-at-rest (or per-user KMS) is the recommended next
  hardening step before broader exposure.
- Keep `DATABASE_URL`, `SIGNUP_INVITE_CODE`, and any tokens in Vercel env vars only —
  never commit them. `.env` is gitignored.
