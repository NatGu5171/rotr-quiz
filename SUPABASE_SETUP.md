# Supabase setup — Official Test Mode

End-to-end runbook to bring up the Test mode + groups/subgroups feature.

## 0. Prerequisites

- The Supabase project already exists (URL + anon key are hard-coded in `index.html`).
- Supabase CLI installed: `brew install supabase/tap/supabase`.
- A Resend account: <https://resend.com> → API key + a verified sender (or use `onboarding@resend.dev` for testing — only sends to the address you signed up with).

```bash
cd "RoR generator"
supabase login
supabase link --project-ref nwthpkhzmrmrsdbybcis
```

## 1. Apply the migration

Either via the CLI:
```bash
supabase db push
```
…or by pasting `supabase/migrations/0001_official_tests.sql` into the SQL editor in the Supabase dashboard.

Verify in the Table Editor:
- `groups`, `subgroups`, `user_memberships`, `admin_grants`, `tests`, `test_results` exist.
- RLS is **enabled** on all six.

## 2. Set the global admin

In **Authentication → Users**, open your account (`nathanael.guyomard@gmail.com`) and edit `app_metadata`:

```json
{ "role": "global_admin" }
```

Sign out + sign in again so the JWT is reissued with the new claim. The `Admin` link will then appear in the header.

## 3. Set Edge Function secrets

```bash
# 32+ chars, used to sign the test session token
supabase secrets set FUNCTION_JWT_SECRET="$(openssl rand -hex 32)"

# Resend
supabase secrets set RESEND_API_KEY="re_xxx_your_key"
supabase secrets set RESEND_FROM_ADDRESS="Rules of the Road <results@yourdomain.com>"
# (or: "onboarding@resend.dev" while testing)

# Where the Edge Functions fetch the question bank from
supabase secrets set QUESTIONS_URL="https://rotrquiz.com/rotr_questions.json"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do not set them.

## 4. Deploy the Edge Functions

```bash
supabase functions deploy admin-create-test
supabase functions deploy start-test
supabase functions deploy submit-test
supabase functions deploy lookup-user-by-email
supabase functions deploy resolve-user-emails
```

Quick smoke test (each should reply with a 4xx, not a 5xx):
```bash
curl -i https://nwthpkhzmrmrsdbybcis.functions.supabase.co/start-test \
  -H 'content-type: application/json' \
  -d '{}'
```

## 5. Auth email delivery (custom SMTP via Resend)

Supabase's built-in SMTP is limited to ~2 signup emails per hour, which trips `email rate limit exceeded` as soon as several users register. Route Auth emails through Resend instead.

### 5.1 Domain in Resend

- `rotrquiz.com` is registered at Cloudflare and added to Resend in region **us-east-1**.
- DNS records (DKIM, SPF, MX, DMARC) live in Cloudflare DNS — see Resend → Domains → `rotrquiz.com` → Records for the canonical values.
- To re-verify after any DNS change: Resend domain page → **Verify DNS Records**.

### 5.2 API key

A dedicated Resend API key named `supabase-auth-smtp` (Sending access only, scoped to `rotrquiz.com`) is used **exclusively** for Supabase Auth. It is **not** the same key as `RESEND_API_KEY` stored in `supabase secrets` (which is used by the Edge Functions for results emails). Rotate them independently.

### 5.3 Supabase SMTP settings

Dashboard → **Authentication** → **Email**:

| Field | Value |
|---|---|
| Sender email | `no-reply@rotrquiz.com` |
| Sender name | `ROTR Quiz` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the `supabase-auth-smtp` API key |

### 5.4 Custom domain (rotrquiz.com)

The site is served from `https://rotrquiz.com` (apex), with `www.rotrquiz.com` redirecting to the apex. Hosted on GitHub Pages, DNS via Cloudflare.

**DNS records in Cloudflare** (proxy: **DNS only** / gray cloud — required for GitHub's Let's Encrypt cert provisioning):

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `natgu5171.github.io` |

**GitHub Pages config**: Settings → Pages → Custom domain `rotrquiz.com`, Enforce HTTPS enabled. GitHub auto-commits a `CNAME` file at the repo root.

### 5.5 URL Configuration

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://rotrquiz.com/`
- **Redirect URLs** (allowlist):
  - `https://rotrquiz.com/**`
  - `http://localhost:8000/**` (local testing)
  - `http://127.0.0.1:8000/**` (local testing)

### 5.6 emailRedirectTo (defensive)

Supabase strips the path from Site URL when building the `redirect_to` parameter of confirmation links — only the origin survives. With `rotrquiz.com` (no path on the apex), this is moot in production, but [index.html](index.html) still passes `emailRedirectTo` explicitly on `signUp` so the same code keeps working on local dev (`http://localhost:8000/some/path`) and on any future deploy that does have a path:

```js
options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
```

## 6. End-to-end checks

Walk through the verification list in `OFFICIAL_TEST_MODE_PLAN.md` (sections 1–16).

## Operations cheatsheet

- **Reset a user's attempt** (so they can retake a test): in the SQL editor,
  ```sql
  delete from test_results where test_id = '...' and user_id = '...';
  ```
- **Promote a user to global admin**: edit `app_metadata.role` in the Users dashboard.
- **Re-import the question bank in a function**: bump the function (or restart by redeploying any of them) — the bank is fetched at cold start from `QUESTIONS_URL` and cached in module memory.
- **Rotate the Auth SMTP key**: create a new key in Resend (Sending access, scoped to `rotrquiz.com`), paste it into Supabase Auth → Email → Password, then delete the old key in Resend.
- **Auth email rate limits**: Supabase Auth has its own throttle (Authentication → Rate Limits → "Rate limit for sending emails", default 2/h). Raise this when you expect a registration surge — Resend itself allows 100 emails/day on the free plan and 3 000/month, so Supabase is the bottleneck.
