# ROTR Quiz Generator — Official Test Mode + Groups/Subgroups

## Implementation status (as of 2026-05-05)

### ✅ Done — code in place

- **Migration** [`supabase/migrations/0001_official_tests.sql`](supabase/migrations/0001_official_tests.sql) — 6 tables (`groups`, `subgroups`, `user_memberships`, `admin_grants`, `tests`, `test_results`), helper SQL functions (`is_global_admin`, `is_group_admin`, `is_subgroup_admin`), cleanup triggers for admin grants when groups/subgroups are deleted, RLS policies on all 6 tables, global-admin membership override, column-level protection for `tests.password_hash` / `tests.question_ids`, **`UNIQUE (test_id, user_id)`** on `test_results`.
- **Edge Functions** under [`supabase/functions/`](supabase/functions/):
  - `_shared/` — `cors.ts`, `questions.ts` (loads bank from `QUESTIONS_URL`), `jwt.ts` (HS256), `password.ts` (bcrypt), `email.ts` (Resend), `auth.ts` (`requireAuth` / `requireGlobalAdmin`).
  - `admin-create-test/index.ts` — global-admin only; bcrypts password; inserts into `tests`.
  - `start-test/index.ts` — auth required; pre-flight 409 if already taken; bcrypt verify password; strips `correct_answer`; shuffles per taker; signs 2 h JWT.
  - `submit-test/index.ts` — auth required; verifies token; re-checks 409; scores authoritatively; snapshots group/subgroup; inserts into `test_results`; attempts Resend email; returns `email_sent`; UNIQUE constraint = final hard gate.
  - `lookup-user-by-email/index.ts` — global or group admin only; resolves email → user_id via service role.
  - `resolve-user-emails/index.ts` — global or group admin only; batch-resolves admin grant UUIDs → emails for admin lists.
- **Frontend** [`index.html`](index.html) — header mode switcher `[Quiz] [Test]` + role-gated `Admin` link + membership chip; new panels `#join-panel` (forced after first sign-in for non-admin members; admins can bootstrap groups first), `#test-select-panel` (with "Already taken — XX%" badges), `#test-quiz-panel` (no per-question feedback, prev/next nav), `#test-result-panel`, `#admin-panel` (sections gated by role: groups + tests for global admin, subgroups for group admins, results table + CSV export for subgroup admins). All wired through `loadMyContext`, `joinSubgroup`, `startOfficialTest`, `submitTest`, `adminCreateTest`, `adminCreateGroup/Subgroup`, `adminAdd*Admin` (via `lookup-user-by-email`), admin email display (via `resolve-user-emails`), `renderAdminResults`, `adminExportResultsCSV`. Quiz mode untouched.
- **Runbook** [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) — step-by-step deployment instructions.
- **Tooling** — Supabase CLI v2.98.1 installed at `~/.local/bin/supabase`; `supabase init` already run (`supabase/config.toml` present).
- **Validation** — HTML parses; inline JS (~51 KB) parses cleanly under Node; migration has 62 DDL/grant statements.

### ⏳ Left to do — interactive / requires user secrets

These require a browser, your Supabase password, or a Resend account. I cannot complete them autonomously.

**You run these:**
1. ✅ `supabase login` — completed locally.
2. ✅ `supabase link --project-ref nwthpkhzmrmrsdbybcis` — completed locally.
3. ✅ Migration applied manually via Supabase SQL Editor (`0001_official_tests.sql`).
4. ✅ **Supabase dashboard / SQL Editor** → user `app_metadata` set to `{ "role": "global_admin" }`; sign out / sign in in the app to refresh the JWT.
5. ✅ **Resend** (resend.com) — API key set in Supabase secrets; temporary sender set to `onboarding@resend.dev` for limited tests.
6. ✅ **GitHub Pages** URL verified: `https://natgu5171.github.io/rotr-quiz/rotr_questions.json`.

Deployment prerequisites are now complete:
- migration applied manually via SQL Editor,
- Edge Functions deployed,
- `FUNCTION_JWT_SECRET` generated and set,
- `QUESTIONS_URL` set to the verified GitHub Pages JSON URL,
- `RESEND_API_KEY` set,
- `RESEND_FROM_ADDRESS` set to temporary `onboarding@resend.dev`,
- global admin metadata applied.

### 🧪 After deployment

Walk the verification checklist (sections 1–16 below) end-to-end. If anything fails, share the error and I'll diagnose.

### 📌 Known minor limitation

None currently tracked in the local implementation. The previous UUID-only admin-list display for users who had never taken a test is now handled by the `resolve-user-emails` Edge Function, with the old result-snapshot fallback retained if the function is not deployed yet.

---

## Context

The current app at `index.html` is a static site (deployed on GitHub Pages) with Supabase auth + a `quiz_results` table. The instructor wants to issue **official tests**: frozen quizzes (X questions chosen from the 1030‑question bank), named, password-protected. Test takers select a test, enter the password, take it, and receive an "official" email with their score and a Pass (≥90 %) / Fail (<90 %) verdict.

Layered on top: a **3-level admin hierarchy** for organisations.
- **Global admin** (the user) — manages tests, manages groups, manages subgroups, names group admins.
- **Group admin** — manages subgroups inside their assigned group(s) and names the subgroup admins of those subgroups.
- **Subgroup admin** — read-only: views and exports (CSV) the results produced by members of their subgroup.
- **Members** — regular users who join exactly one subgroup, then take tests as authenticated takers.

Quiz mode (existing) must remain unchanged. All UI and emails in **English only**.

Decisions confirmed with the user:
- Global admin: `app_metadata.role = 'global_admin'`, set manually in the Supabase dashboard. Group/subgroup admins are nominated **from inside the app** (by the level above), via the admin page.
- A member belongs to exactly **one** subgroup at a time (can be changed).
- **Sign-in is mandatory to take a test** so every result is tied to a subgroup.
- Subgroup admin sees a flat list of results + an **Export CSV** button (no in-app filters).
- **One attempt per user per test, with the attempt starting on submit** — enforced by a `UNIQUE (test_id, user_id)` constraint on `test_results`, plus a pre-flight check in `start-test` and "Already taken" UI state for already-submitted tests. A user who starts a test but never submits has not consumed their attempt.
- Membership selection is **forced right after first sign-in for non-admin members** (Option A) — not embedded in the sign-up form; changeable later via "Leave / Change group" in the header. Admins can sign in without a subgroup so the first global admin can bootstrap groups/subgroups.
- Global admin can force a membership reassignment when needed. Normal flow remains user self-join; admin intervention is an exception path, not a routine workflow.
- During the test: **no per-question feedback** (more "official").
- Email sending: **Resend** via Supabase Edge Function. Email delivery is best-effort after the official result is recorded; if Resend fails, the submission still succeeds and the UI tells the taker that the result was recorded but email delivery failed.
- Question order: **randomised per taker** (same X questions for everyone, individual order).
- The question bank is treated as stable for this deployment; no separate bank-versioning layer is required unless the bank starts changing later.

---

## Architecture

```
                 ┌────────────────────────────────────────┐
                 │ index.html (static, single file)       │
                 │  ─ Quiz mode (unchanged)               │
                 │  ─ Test mode (new)                     │
                 │  ─ Join subgroup (new, members)        │
                 │  ─ Admin page, role-gated (new)        │
                 │      • global_admin section            │
                 │      • group_admin section             │
                 │      • subgroup_admin section          │
                 └─────────────┬──────────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────┐
        │ Supabase                                         │
        │  Tables (new): groups, subgroups,                │
        │                user_memberships, admin_grants,   │
        │                tests, test_results               │
        │  Auth + app_metadata.role = 'global_admin'       │
        │  RLS enforces the 3-level hierarchy              │
        │  Edge Functions:                                 │
        │     admin-create-test    (global admin only)     │
        │     start-test           (auth required)         │
        │     submit-test          (auth required)         │
        └─────────────────────────┬────────────────────────┘
                                  │
                                  ▼
                            Resend API
                    (sends "official" result email)
```

Authoritative scoring + emailing happens **server-side** in Edge Functions. The client never sees `correct_answer` for test questions, never holds a password hash, and cannot tamper with role checks (RLS + JWT-claim checks server-side).

---

## Data model (Supabase, new tables)

### `groups`
| col | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` UNIQUE NOT NULL | e.g. "LANTPAT Block 0" |
| `created_at` | `timestamptz` default `now()` | |

### `subgroups`
| col | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `group_id` | `uuid` references `groups` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | e.g. "Pennant 1" |
| `created_at` | `timestamptz` default `now()` | |
| UNIQUE (`group_id`, `name`) |

### `user_memberships`
| col | type | notes |
|---|---|---|
| `user_id` | `uuid` PK references `auth.users` ON DELETE CASCADE | one row per user |
| `subgroup_id` | `uuid` references `subgroups` ON DELETE SET NULL | NULL = not yet joined |
| `joined_at` | `timestamptz` default `now()` | |

### `admin_grants`
| col | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` references `auth.users` ON DELETE CASCADE | |
| `scope_type` | `text` CHECK in (`'group'`, `'subgroup'`) | |
| `scope_id` | `uuid` NOT NULL | references `groups.id` or `subgroups.id` depending on `scope_type` |
| `granted_by` | `uuid` references `auth.users` | |
| `created_at` | `timestamptz` default `now()` | |
| UNIQUE (`user_id`, `scope_type`, `scope_id`) |

A user can hold multiple grants (e.g. group admin of two groups). Global admin is **not** in this table — it lives in `app_metadata.role`.

### `tests`
| col | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` UNIQUE NOT NULL | shown to takers |
| `password_hash` | `text` NOT NULL | bcrypt; verified server-side |
| `scope` | `text[]` | snapshot of admin's selection |
| `rules` | `text[]` | snapshot of admin's selection |
| `question_ids` | `int[]` NOT NULL | frozen list |
| `created_by` | `uuid` references `auth.users` | global admin only |
| `created_at` | `timestamptz` default `now()` | |

### `test_results`
| col | type | notes |
|---|---|---|
| `id` | `uuid` PK | |
| `test_id` | `uuid` references `tests` ON DELETE CASCADE | |
| `test_name` | `text` | denormalised |
| `user_id` | `uuid` references `auth.users` | always set (sign-in required) |
| `taker_email` | `text` NOT NULL | recipient of the email |
| `subgroup_id` | `uuid` references `subgroups` ON DELETE SET NULL | snapshotted at submission time |
| `subgroup_name` | `text` | denormalised |
| `group_id` | `uuid` | snapshotted (parent of `subgroup_id` at submission) |
| `group_name` | `text` | denormalised |
| `correct` | `int` | |
| `total` | `int` | |
| `pct` | `numeric(5,2)` | |
| `passed` | `bool` | `pct >= 90` |
| `created_at` | `timestamptz` default `now()` | |
| UNIQUE (`test_id`, `user_id`) | | **enforces one attempt per user per test** |

Denormalising `subgroup_name`/`group_name` keeps historical results readable even if a subgroup is later renamed or deleted.

---

## RLS policies (summary)

Helper SQL functions (in migration):
```sql
create or replace function public.is_global_admin() returns boolean
  language sql stable as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'global_admin'
  $$;

create or replace function public.is_group_admin(g uuid) returns boolean
  language sql stable as $$
    select exists (
      select 1 from admin_grants
      where user_id = auth.uid() and scope_type = 'group' and scope_id = g
    ) or public.is_global_admin()
  $$;

create or replace function public.is_subgroup_admin(s uuid) returns boolean
  language sql stable as $$
    select exists (
      select 1 from admin_grants ag
      where ag.user_id = auth.uid()
        and ((ag.scope_type = 'subgroup' and ag.scope_id = s)
          or (ag.scope_type = 'group'
              and ag.scope_id = (select group_id from subgroups where id = s)))
    ) or public.is_global_admin()
  $$;
```

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `groups` | any authenticated user (so members can browse to join) | `is_global_admin()` |
| `subgroups` | any authenticated user | `is_group_admin(group_id)` |
| `user_memberships` | the user themselves; `is_subgroup_admin(subgroup_id)`; `is_group_admin(parent_group)`; global admin | the user themselves (own row); global admin can force insert/update/delete as an exception path |
| `admin_grants` | the grantee; global admin; group admins for grants in their group | global admin: any. Group admin: only `scope_type='subgroup'` rows whose `scope_id` is inside their group |
| `tests` | `select id, name`: any authenticated user. Other columns: only via service-role | global admin only (and Edge Function) |
| `test_results` | the user themselves; `is_subgroup_admin(subgroup_id)`; `is_group_admin(group_id)`; global admin | only Edge Function (service role) |

`password_hash` and `question_ids` of `tests` must never be sent to clients — Edge Functions read them with the service-role key (which bypasses RLS); the client only `select id, name`.

---

## Edge Functions

```
supabase/functions/
  _shared/
    questions.ts   ← fetches rotr_questions.json from QUESTIONS_URL
    jwt.ts         ← sign/verify HS256 with FUNCTION_JWT_SECRET
    password.ts    ← bcrypt (deno.land/x/bcrypt)
    email.ts       ← Resend POST + HTML template
    auth.ts        ← parse caller JWT (requireAuth, requireGlobalAdmin)
  admin-create-test/index.ts
  start-test/index.ts
  submit-test/index.ts
  lookup-user-by-email/index.ts
  resolve-user-emails/index.ts
```

Required Supabase secrets (`supabase secrets set`):
- `FUNCTION_JWT_SECRET` — random 32-byte string.
- `RESEND_API_KEY` — from resend.com.
- `RESEND_FROM_ADDRESS` — `Rules of the Road <results@yourdomain>` (or `onboarding@resend.dev` while testing).
- `QUESTIONS_URL` — public URL of `rotr_questions.json`.
- `SUPABASE_SERVICE_ROLE_KEY` is automatically available.

### `POST /admin-create-test`
Body: `{ name, password, scope: string[], rules: string[], question_ids: number[] }`.
1. Verify caller JWT → `requireGlobalAdmin()` → 403 otherwise.
2. `bcrypt.hash(password)`.
3. Insert into `tests`. Return `{ id }`.

### `POST /start-test`
Body: `{ test_id, password }`. Auth required.
1. `select 1 from test_results where test_id = ? and user_id = caller`. If a submitted result exists → **409 "You have already taken this test."** No questions, no token.
2. `select * from tests where id = test_id` (service role).
3. `bcrypt.compare(password, password_hash)` → 401 on mismatch.
4. Resolve question payload from `question_ids`, **strip `correct_answer`**, `shuffle()`.
5. Sign JWT `{ test_id, user_id, exp: now + 2h }`.
6. Return `{ token, test_name, questions }`.

### `POST /submit-test`
Body: `{ token, answers: [{ id, choice|null }] }`. Auth required.
1. Verify+decode token; assert `user_id` matches the caller.
2. `select question_ids, name from tests`.
3. Lookup `user_memberships` → `subgroup_id`. Lookup `subgroups` → `group_id`. Snapshot the names.
4. Score authoritatively against the bundled bank (only IDs in `question_ids` count; nulls = wrong).
5. `pct`, `passed = pct >= 90`.
6. Insert into `test_results`. This is the point where the official attempt is consumed. The `UNIQUE (test_id, user_id)` constraint is the final hard gate against retakes — if it fires, return 409 without sending an email.
7. POST to Resend with the HTML below. If Resend fails, log the error but do not roll back the already-recorded result.
8. Return `{ correct, total, pct, passed, email_sent }`.

### `POST /lookup-user-by-email`
Body: `{ email }`. Auth required, caller must be global or group admin.
- Service-role lookup in `auth.users` → returns `{ id }` or 404.

### `POST /resolve-user-emails`
Body: `{ user_ids: string[] }`. Auth required, caller must be global or group admin.
- Service-role lookup in `auth.users` → returns `{ users: [{ id, email }] }`.

### Email template (English, "official" tone)

Subject: `[Rules of the Road] Test result — {test_name} — {PASSED|FAILED}`

```
<h2>Rules of the Road — Official Test Result</h2>
<p><strong>Test:</strong> {test_name}</p>
<p><strong>Group / Subgroup:</strong> {group_name} / {subgroup_name}</p>
<p><strong>Date:</strong> {YYYY-MM-DD HH:mm UTC}</p>
<p><strong>Score:</strong> {correct} / {total}  ({pct}%)</p>
<p style="font-size:1.4rem; color:{green|red}">
  <strong>STATUS: {PASSED ✓ | FAILED ✗}</strong>
</p>
<p>Pass mark: 90%.</p>
<hr>
<p style="font-size:0.8rem; color:#888">
  This is an automated message from the Rules of the Road test platform.
  This email was sent because this address is on file for the account that took the test.
</p>
```

---

## Frontend changes — `index.html`

Single file (931 lines today). All additions land here. New panels follow the existing show/hide pattern (`config-panel`, `quiz-panel`, `results-panel`, `history-panel`).

### 1. State
```
let currentMode  = 'quiz';            // 'quiz' | 'test'
let currentRole  = 'member';          // 'global_admin' | 'group_admin' | 'subgroup_admin' | 'member'
let myMembership = null;              // { subgroup_id, subgroup_name, group_id, group_name }
let myGrants     = [];                // [{ scope_type, scope_id, ... }]
```
Resolved at sign-in: read `app_metadata.role`, fetch `user_memberships`, fetch `admin_grants` for the current user.

### 2. Header / mode switcher
Two top-level buttons next to user info: `[Quiz] [Test]`. An additional `Admin` link is shown when the user has any admin grant or is global admin.

### 3. New panels (HTML + JS)

#### `#join-panel` (members)
Shown when a signed-in non-admin user has no `user_memberships` row, **and is mandatory after sign-up** (blocks every other panel until a selection is saved). Admins can bypass this so the first global admin can create groups/subgroups before joining one. Also reachable via a "Leave my group / Join a new group" link in the header for changes later.
- Group dropdown → Subgroup dropdown (subgroups list refreshes when group changes) → `Save`.
- Upserts `user_memberships` (one row per user; saving overwrites the previous subgroup).
- Header link wording: `Leave / Change group` → opens the same panel pre-filled with current selection; saving replaces the row.

Sign-up flow (Option A — confirmed):
1. User submits email + password in the existing auth modal.
2. After Supabase confirms the email + sign-in, `loadMyContext()` finds no membership for a non-admin member → `#join-panel` is forced.
3. Save → membership created → user lands on the default panel for their role (Quiz config for members).

#### `#test-select-panel`
- Requires sign-in. If anonymous → "Please sign in to take a test" + sign-in CTA.
- If signed-in but no membership → "Please join a subgroup before taking a test" + link to `#join-panel`.
- Otherwise: list of tests (`select id, name from tests` joined left with `test_results` filtered on `user_id = me`). Tests already taken are rendered greyed-out with a `Already taken — {pct}%` badge and the `Start test` button disabled. Email is the auth email (read-only).

#### `#test-quiz-panel`
- Re-uses the question rendering markup from `#quiz-panel`. **No per-question feedback.** "Next" always enabled (skipping = wrong). Last question becomes "Submit test".
- `testAnswers = [{ id, choice }]` accumulated locally.

#### `#test-result-panel`
- If `email_sent !== false`: "An email has been sent to {auth.email}."
- If `email_sent === false`: "Result recorded. Email delivery failed; contact the instructor."
- Score and status remain visible either way: `X/Y ({pct}%) — {PASSED|FAILED}`.

#### `#admin-panel` (role-gated, single panel with conditional sections)

Shown sections depend on `currentRole` + `myGrants`. All controls hit Supabase directly (RLS enforces); only test creation goes through the `admin-create-test` Edge Function.

- **Global admin only**:
  - "Groups" section: list + create + rename + delete groups.
  - "Group admins" sub-section per group: list + add (by member email) + remove.
  - "Tests" section: same controls as today's `#config-panel` (scope, rules, count) plus name + password + `Save test` + list of existing tests with `Delete`.
- **Group admin** (one section per group they administer):
  - "Subgroups" of that group: list + create + rename + delete.
  - "Subgroup admins" per subgroup: list + add (by member email) + remove.
- **Subgroup admin** (one section per subgroup they administer):
  - Read-only table of `test_results` for that subgroup: date, member email, test name, score, status. Sorted desc by date.
  - `Export CSV` button (re-uses the existing CSV-build pattern from [index.html:895-917](index.html#L895-L917)).

A user with several grants (e.g. group admin of A and subgroup admin of B inside group C) sees all relevant sections stacked.

### 4. Refactors needed in existing code
- Extract the rules-grid build out of `initConfig()` [index.html:448-504](index.html#L448-L504) into `buildRulesGrid(containerEl, onChange)` so both `#config-panel` and the global-admin "Tests" section reuse it.
- Extract the question render block from `showQuestion()` into `renderQuestion(q, container, { showFeedback })`. Quiz mode passes `true`; test mode passes `false`.
- Reuse `getPool()` [index.html:610-616](index.html#L610-L616) to derive `question_ids` at test creation.
- Reuse `shuffle()` [index.html:919-925](index.html#L919-L925) and `escHtml()` [index.html:927-929](index.html#L927-L929).
- Reuse the existing Supabase client `db` and `currentUser` from [index.html:404-515](index.html#L404-L515).

### 5. New client functions
```
// membership
loadMyContext()           // fetches role, membership, grants on auth state change
joinSubgroup(group_id, subgroup_id)
// taker
loadTestList()
startTest(test_id, password)     // → start-test edge fn
submitTest()                     // → submit-test edge fn
// admin (global)
adminCreateGroup/Rename/Delete()
adminListGroupAdmins/Add/Remove()
adminCreateTest()                // → admin-create-test edge fn
adminListTests/Delete()
// admin (group)
adminCreateSubgroup/Rename/Delete()
adminListSubgroupAdmins/Add/Remove()
// admin (subgroup)
adminListSubgroupResults()       // SELECT, RLS enforces visibility
adminExportSubgroupResultsCSV()
```

"Add admin by email" uses the `lookup-user-by-email` Edge Function (service role), since the anon key cannot read `auth.users`.

---

## Files to modify / create

**Modified**
- `index.html` — mode switcher, join panel, test-select panel, test runtime panel, test result panel, admin panel with role-gated sections, refactored helpers (`buildRulesGrid`, `renderQuestion`).

**Created**
- `supabase/migrations/0001_official_tests.sql` — all new tables, helper SQL functions, RLS policies.
- `supabase/functions/_shared/questions.ts`
- `supabase/functions/_shared/jwt.ts`
- `supabase/functions/_shared/password.ts`
- `supabase/functions/_shared/email.ts`
- `supabase/functions/_shared/auth.ts` (`requireAuth`, `requireGlobalAdmin`)
- `supabase/functions/admin-create-test/index.ts`
- `supabase/functions/start-test/index.ts`
- `supabase/functions/submit-test/index.ts`
- `supabase/functions/lookup-user-by-email/index.ts`
- `supabase/functions/resolve-user-emails/index.ts`
- `SUPABASE_SETUP.md` — secrets, migration, `supabase functions deploy`, dashboard step to set `app_metadata.role = 'global_admin'`.

**Untouched**
`quiz_generator.html`, `start_quiz.py`, `start_quiz.applescript`, `extract_questions.py`, `rotr_questions.db`, `images/`, `README.md`, `GITHUB_PAGES_PLAN.md`.

---

## Pre-production hardening checklist

Run these before real use, ideally immediately after the first deployment:

1. **Secrets hygiene**
   - Confirm the real `FUNCTION_JWT_SECRET`, `RESEND_API_KEY`, and sender address are only in Supabase secrets / private notes.
   - Confirm the real `FUNCTION_JWT_SECRET` is not present in `OFFICIAL_TEST_MODE_PLAN.md`, `SUPABASE_SETUP.md`, shell history snippets, or committed files.
2. **Column exposure**
   - As an authenticated non-admin user, `select id, name, created_at from tests` succeeds.
   - As the same user, `select password_hash, question_ids from tests` fails.
   - `start-test` responses contain no `correct_answer`.
3. **Attempt semantics**
   - Start a test, close the browser before submitting, then start it again: allowed.
   - Submit once: result inserted, email attempted, test becomes "Already taken".
   - Call `start-test` after submit: 409.
   - Reuse a stale 2 h token after submit: 409, no second email.
4. **Membership override**
   - A normal user can self-join/change their subgroup.
   - A global admin can force insert/update/delete a `user_memberships` row for another user.
   - A group admin can view relevant memberships/results but cannot reassign memberships.
5. **Email transport**
   - With valid Resend secrets, the result email arrives and contains the right score, status, group, and subgroup; `submit-test` returns `email_sent: true`.
   - With invalid Resend secrets, the result remains recorded; `submit-test` returns `email_sent: false`; the UI says email delivery failed instead of claiming the email was sent.
6. **Failure clarity**
   - Missing `QUESTIONS_URL` or an unreachable question bank produces a clear Edge Function error.
   - Wrong test password returns 401.
   - Malformed requests return 4xx, not 5xx.

## Rollback plan

The safest rollback preserves existing quiz mode and removes only the new official-test surface:

1. Revert/deploy the previous `index.html` if the frontend blocks users.
2. If Edge Functions misbehave, redeploy the previous function versions or temporarily stop using the Test mode UI; quiz mode does not depend on them.
3. If the migration creates unexpected RLS friction, disable the new Test/Admin UI first, then adjust policies in SQL. Avoid dropping tables until exported results are backed up.
4. If a test must be reset for a single student, use the existing manual override:
   ```sql
   delete from test_results where test_id = '...' and user_id = '...';
   ```

---

## Verification

End-to-end checks, in order:

1. **Migration applied**: `select * from groups, subgroups, user_memberships, admin_grants, tests, test_results` succeed; helper SQL functions resolve.
2. **Global admin flag**: dashboard sets `app_metadata.role = 'global_admin'` on `nathanael.guyomard@gmail.com`. After re-sign-in, `Admin` link appears, "Groups" + "Tests" sections shown.
3. **Edge functions deployed**: `supabase functions deploy admin-create-test start-test submit-test lookup-user-by-email resolve-user-emails`. Each rejects unauth/malformed bodies with 4xx.
4. **Group + subgroup creation (global admin)**:
   - Create group `LANTPAT Block 0`, then subgroup `Pennant 1` under it. Confirm rows.
5. **Group admin nomination**:
   - Sign up a 2nd test user `groupadmin@x`.
   - As global admin, add `groupadmin@x` as group admin of `LANTPAT Block 0`. Sign in as `groupadmin@x` → only the "Subgroups" section for that group is visible; cannot create groups, cannot create tests.
6. **Subgroup admin nomination**:
   - As group admin, add `subadmin@x` as subgroup admin of `Pennant 1`. Sign in as `subadmin@x` → only the read-only results table + Export CSV is visible.
7. **Member join**:
   - Sign up `student@x`. `#join-panel` appears → pick `LANTPAT Block 0` / `Pennant 1` → saved.
   - As global admin, force-change `student@x` to another subgroup in `user_memberships` when needed; confirm the user sees the new membership after sign-out/sign-in or refresh.
8. **Test creation**:
   - As global admin, create test `Demo Test`, scope BOTH+INTERNATIONAL, all rules, 5 questions, password `abc123`. Verify `tests` row: 5 ids, hashed password.
9. **Taker happy path**:
   - As `student@x`, switch to Test mode → `Demo Test` listed. Enter password → 5 questions render, no feedback per question. Submit.
   - Result panel shows score; an email arrives at `student@x`'s inbox with the correct verdict and group/subgroup line.
10. **Subgroup admin sees result**:
    - Sign in as `subadmin@x` → the new submission is in the table. Click `Export CSV` → file downloads with the row.
11. **Cross-subgroup isolation**:
    - Create `Pennant 2` and `student2@x` in it. After `student2@x` submits, `subadmin@x` (admin of Pennant 1 only) does **not** see that row. Group admin of `LANTPAT Block 0` sees both.
12. **Cheating attempts**:
    - DevTools intercept of `start-test` response → no `correct_answer` field.
    - Tampering with `submit-test` body → server still scores authoritatively.
    - Authenticated non-admin fetch of `select password_hash, question_ids from tests` fails; client-visible test list only uses `id, name`.
13. **Quiz mode untouched**: existing config → quiz → results → history flow behaves identically; `quiz_results` writes still work.
14. **Pass/fail boundary**: 10-question test with 9/10 correct → email PASSED; 8/10 → FAILED.
15. **Single-attempt enforcement**:
    - Start `Demo Test`, close the tab before submitting, then start it again → allowed because the attempt starts on submit.
    - As `student@x`, after submitting `Demo Test` once, switch back to Test mode → `Demo Test` greyed out, `Start test` disabled, badge shows `Already taken — {pct}%`.
    - Force-call `start-test` from DevTools with the same `test_id` + correct password → 409 "You have already taken this test." No questions returned, no token issued.
    - Even if a stale 2 h token from the first attempt is reused, `submit-test` insert into `test_results` violates `UNIQUE (test_id, user_id)` → 409, no second email sent.
16. **Sign-up join flow (Option A)**:
    - Sign up a fresh non-admin user `newmidn@x` → after email confirmation + first sign-in, `#join-panel` is forced (cannot navigate to Quiz / Test until saved).
    - Pick `LANTPAT AY-26 Block 0` / `Pennant 2` → save → lands on Quiz config.
    - Click `Leave / Change group` in the header → `#join-panel` re-opens pre-filled → switch to `Pennant 3` → save → membership row updated, no duplicates.

---

## Out of scope

- Multi-subgroup membership (one subgroup per user, by decision).
- In-app result filters (export CSV instead, by decision).
- Anonymous test takers (sign-in required, by decision).
- Bulk import of members from a roster (manual self-join).
- Dashboard for global admin to browse all results across all groups (RLS allows it; UI not built unless requested).
- Admin override to reset a user's attempt on a given test (would be a manual `delete from test_results where ...` in the dashboard for now).
