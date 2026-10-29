# Authentication (Stage 3 + 4)

Kairo signs users in with GitHub's OAuth 2.0 authorization-code flow, using
**PKCE (S256) + `state`**, server-side sessions in Postgres, and an
AES-256-GCM encrypted copy of the GitHub access token.

> GitHub is **not** an OpenID Connect provider: there is no discovery document
> and no `id_token` / `sub` claim. The flow is therefore implemented with plain
> HTTPS calls (no `openid-client`), the profile and email come from GitHub's
> REST API, and every endpoint is configured manually.

---

## 1. Create the GitHub OAuth App

1. Sign in to GitHub, then open
   **[Settings → Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers)**
   (use **New OAuth App**, not *Register a new application* for a GitHub App —
   Kairo uses the classic OAuth App web flow).
2. Fill in the form exactly:

   | Field | Development value |
   | --- | --- |
   | **Application name** | `Kairo (local)` |
   | **Homepage URL** | `http://localhost:3000` |
   | **Authorization callback URL** | `http://localhost:4000/auth/github/callback` |

   The callback URL **must** match `{API_URL}/auth/github/callback` exactly —
   scheme, host, port and path. GitHub rejects the token exchange otherwise.
3. Click **Register application**.
4. On the app's page, copy the **Client ID**.
5. Click **Generate a new client secret** and copy the **Client Secret**
   immediately (it is shown only once).

For production, either update the same app's *Homepage URL* and *Authorization
callback URL* to your live domains, or register a second OAuth App (classic
OAuth Apps allow a single callback URL).

---

## 2. Environment variables

### `apps/api/.env`

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | no | API port, default `4000`. |
| `NODE_ENV` | no | `development` / `production`. `production` turns on `Secure` cookies. |
| `WEB_URL` | no | Web origin, default `http://localhost:3000`. CORS origin (with credentials) + post-login redirect target. |
| `API_URL` | no | Public base URL of the API, default `http://localhost:4000`. Builds the callback URL and the `redirect_uri` sent to GitHub. |
| `DATABASE_URL` | **yes** | `postgresql://user:pass@host:5432/kairo?schema=public` |
| `GITHUB_CLIENT_ID` | **yes** | Client ID from the OAuth App. |
| `GITHUB_CLIENT_SECRET` | **yes** | Client secret from the OAuth App. |
| `TOKEN_ENCRYPTION_KEY` | **yes** | Base64 of **exactly 32 bytes** — AES-256 key for the stored GitHub token. |
| `SESSION_SECRET` | **yes** | ≥ 32 chars. HMAC key used to hash session tokens before they are stored. |
| `SESSION_TTL_HOURS` | no | Session lifetime, default `720` (30 days). |
| `SESSION_RENEW_INTERVAL_MINUTES` | no | Minimum gap between sliding renewals, default `15`. |
| `GITHUB_AUTHORIZE_URL` | no | Default `https://github.com/login/oauth/authorize`. |
| `GITHUB_TOKEN_URL` | no | Default `https://github.com/login/oauth/access_token`. |
| `GITHUB_API_URL` | no | Default `https://api.github.com`. |

The last three exist because GitHub has no discovery document. Override them
for GitHub Enterprise (`https://github.company.com/login/oauth/...`) or for the
local test stub — never for normal github.com use.

Generate the two secrets:

```sh
node -e "console.log('TOKEN_ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('SESSION_SECRET='+require('crypto').randomBytes(32).toString('base64'))"
```

> Keep `TOKEN_ENCRYPTION_KEY` stable: rotating it makes existing
> `GithubConnection` rows undecryptable.

### `packages/db/.env`

```sh
DATABASE_URL="postgresql://kairo:kairo_dev_secret@localhost:5432/kairo?schema=public"
```

Used by the Prisma CLI (`db:migrate`, `db:generate`).

### `apps/web/.env.local`

```sh
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## 3. Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /auth/github` | – | Generates `state` + PKCE verifier, stores both in a 10-minute `httpOnly` cookie, redirects to GitHub with scopes `read:user user:email repo`. Rate limited: 10 / 15 min / IP. |
| `GET /auth/github/callback` | – | Validates `state` against the cookie (constant-time), exchanges the code (with `code_verifier`), fetches `/user` + `/user/emails`, upserts `User`, stores the encrypted token in `GithubConnection`, creates a session, redirects to `/onboarding` (or `/dashboard` when `onboardingStep = DONE`). |
| `POST /auth/logout` | optional | Deletes the current session row and clears the cookie. |
| `POST /auth/refresh` | optional | Rotates the session token: invalidates the old token, issues a fresh 256-bit one, re-sets the cookie with a full TTL, responds `{ ok, expiresAt }`. Unknown tokens get a 401 **without** clearing the cookie (so a stale in-flight request right after rotation can't delete the fresh cookie); genuinely expired sessions are cleared. The web app calls it automatically on load, on tab focus, and every 6 h (`SessionRefresh`, throttled to one attempt / 5 min). |
| `GET /auth/me` | required | `{ user: { id, username, name, email, avatarUrl, onboardingStep } }` |
| `PATCH /auth/onboarding` | required | `{ step: "PROFILE" }` — validated with zod; only forward one-step transitions (`WELCOME → PROFILE → PERMISSIONS → DONE`, re-sending the current step is a no-op). |
| `GET /protected` | required | Test route that proves session auth works and reports the granted scopes. |

All `/auth/*` routes are rate limited (100 / 15 min / IP) in addition to the
stricter OAuth-start limit.

---

## 4. What is stored where

| Piece | Storage |
| --- | --- |
| Session token (random 256-bit) | Browser cookie `kairo_session` — `httpOnly`, `SameSite=Lax`, `Secure` in production. |
| SHA-256 HMAC of that token (keyed with `SESSION_SECRET`) | `sessions.tokenHash` (unique). The raw token is never persisted. |
| `state` + PKCE `code_verifier` | Cookie `kairo_oauth` — `httpOnly`, `SameSite=Lax`, 10-minute `Max-Age`, deleted in the callback. |
| GitHub access token | `github_connections.accessToken_encrypted`, AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>` (base64url), key from `TOKEN_ENCRYPTION_KEY`. |
| Session expiry | `sessions.expiresAt`; slides forward to a full TTL when a session older than `SESSION_RENEW_INTERVAL_MINUTES` is used, and resets on every `POST /auth/refresh`. |
| Rotated token | Same `sessions` row — `tokenHash` is overwritten with the HMAC of the new token (`rotateSession`); the old cookie stops matching immediately. |

### Post-login redirects (Next `proxy.ts`)

- no session → `/login`
- session, `onboardingStep !== DONE` → `/onboarding`
- session, `onboardingStep = DONE` → `/dashboard`
- signed-in user visiting `/login` is sent to `/onboarding` or `/dashboard`

The proxy's server-side `/auth/me` call may trigger a cookie renewal (sliding
renewal or rotation) — `fetchMe` reads the upstream `Set-Cookie` and forwards
it onto the Next response, otherwise the browser cookie would expire while the
DB row keeps getting renewed.

Login failures land on `/login?error=<code>` with `access_denied`,
`state_mismatch`, `github_error`.

---

## 5. Running and verifying

```sh
docker compose up -d                 # Postgres
npm install
npm run db:migrate -w @kairo/db      # applies packages/db/prisma/migrations

npm run dev                          # turbo: api (4000) + web (3000)
```

### Offline end-to-end check (no OAuth App needed)

`apps/api/scripts/github-stub.ts` is a tiny stand-in for GitHub that enforces
PKCE and single-use codes exactly like github.com does:

```sh
npm run verify:auth -w @kairo/api    # 57 assertions, boots stub + API in-process
npm run stub -w @kairo/api           # stub on :4100 for manual/browser testing
```

To point a real dev server at the stub:

```sh
# PowerShell
$env:GITHUB_AUTHORIZE_URL="http://localhost:4100/login/oauth/authorize"
$env:GITHUB_TOKEN_URL="http://localhost:4100/login/oauth/access_token"
$env:GITHUB_API_URL="http://localhost:4100"
npm run dev -w @kairo/api
```

Existing process environment variables always win over `.env`, so the overrides
above stick.

### With the real GitHub OAuth App

Fill `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in `apps/api/.env`, restart the
API, then open <http://localhost:3000/login> and click **Continue with GitHub**.
