import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startGithubStub } from "./github-stub.js";

/**
 * End-to-end verification of the auth backend without a real GitHub OAuth App.
 *
 *   npm run verify:auth        (from apps/api, Postgres must be running)
 *
 * Boots the stubbed GitHub OAuth server + the real Express app, then drives
 * the whole flow: state/PKCE -> callback -> upsert -> encrypted token ->
 * session cookie -> protected routes -> onboarding transitions -> sliding
 * renewal -> logout -> rate limiting -> ciphertext round-trip.
 */

// Load apps/api/.env regardless of the directory this is invoked from.
for (const file of [".env", "apps/api/.env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // fall through to the process environment
  }
}

const API_PORT = 4400;
const STUB_PORT = 4100;
const WEB_URL = "http://localhost:4300";
const PROFILE_AVATAR = "https://avatars.githubusercontent.com/u/1001?v=4";
const SESSION_TTL_MS = 720 * 60 * 60 * 1000; // matches SESSION_TTL_HOURS=720

let passed = 0;
function ok(condition: unknown, label: string): asserts condition {
  assert.ok(condition, `FAIL: ${label}`);
  passed += 1;
  console.log(`  ok - ${label}`);
}

type Jar = Map<string, string>;

function storeCookies(jar: Jar, response: Response): void {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const cleared =
      value === "" ||
      /expires=Thu, 01 Jan 1970/i.test(line) ||
      /max-age=0/i.test(line);
    if (cleared) jar.delete(name);
    else jar.set(name, value);
  }
}

async function request(
  jar: Jar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (jar.size > 0) {
    headers.set(
      "cookie",
      [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
  });
  storeCookies(jar, response);
  return response;
}

function location(response: Response): string {
  const value = response.headers.get("location");
  assert.ok(value, "expected a Location header");
  return value;
}

function setCookie(response: Response, name: string): string | null {
  for (const line of response.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line;
  }
  return null;
}

async function main() {
  console.log("starting GitHub stub and API");
  const stub = await startGithubStub(STUB_PORT);
  const api = `http://localhost:${API_PORT}`;

  // Must be set before src/config/env.ts is loaded (dynamic import below).
  process.env.NODE_ENV = "development";
  process.env.API_URL = api;
  process.env.WEB_URL = WEB_URL;
  process.env.GITHUB_AUTHORIZE_URL = `${stub.url}/login/oauth/authorize`;
  process.env.GITHUB_TOKEN_URL = `${stub.url}/login/oauth/access_token`;
  process.env.GITHUB_API_URL = stub.url;

  const [{ app }, { prisma }, sessionLib] = await Promise.all([
    import("../src/app.js"),
    import("@kairo/db"),
    import("../src/lib/session.js"),
  ]);

  // Start from a clean slate so the run is repeatable (cascade removes
  // the user's sessions and GitHub connection).
  await prisma.user.deleteMany({ where: { githubId: "1001" } });

  const server = app.listen(API_PORT);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const address = server.address() as AddressInfo;
  assert.equal(address.port, API_PORT);

  try {
    // 1. Unauthenticated access is rejected
    console.log("\n1. unauthenticated requests");
    const anonymous = new Map<string, string>();
    const me = await request(anonymous, `${api}/auth/me`);
    ok(me.status === 401, "GET /auth/me returns 401 without a session");
    const protectedBefore = await request(anonymous, `${api}/protected`);
    ok(protectedBefore.status === 401, "GET /protected returns 401 without a session");

    // 2. Starting the flow
    console.log("\n2. GET /auth/github");
    const jar = new Map<string, string>();
    const start = await request(jar, `${api}/auth/github`);
    ok(start.status === 302, "redirects (302) to GitHub");
    ok(
      start.headers.get("location")?.startsWith(`${stub.url}/login/oauth/authorize`) ===
        true,
      "points at the GitHub authorize endpoint",
    );

    const authorize = new URL(location(start));
    ok(
      authorize.searchParams.get("client_id") === process.env.GITHUB_CLIENT_ID,
      "client_id is sent",
    );
    ok(
      authorize.searchParams.get("scope") === "read:user user:email repo",
      "scopes are read:user user:email repo",
    );
    ok(
      authorize.searchParams.get("redirect_uri") === `${api}/auth/github/callback`,
      "redirect_uri is {API_URL}/auth/github/callback",
    );
    ok((authorize.searchParams.get("state") ?? "").length >= 32, "state is unguessable");
    ok(
      (authorize.searchParams.get("code_challenge") ?? "").length === 43,
      "PKCE code_challenge is 43 chars",
    );
    ok(
      authorize.searchParams.get("code_challenge_method") === "S256",
      "PKCE method is S256",
    );

    const oauthCookie = setCookie(start, "kairo_oauth");
    ok(oauthCookie !== null, "state + verifier stored in a cookie");
    ok(/HttpOnly/i.test(oauthCookie ?? ""), "oauth cookie is HttpOnly");
    ok(/SameSite=Lax/i.test(oauthCookie ?? ""), "oauth cookie is SameSite=Lax");
    ok(/Max-Age=600/i.test(oauthCookie ?? ""), "oauth cookie is short-lived (10 min)");

    // 3. Callback protections
    console.log("\n3. callback validation");
    const badState = await request(
      jar,
      `${api}/auth/github/callback?code=nope&state=forged`,
    );
    ok(badState.status === 302, "forged state redirects");
    ok(
      location(badState) === `${WEB_URL}/login?error=state_mismatch`,
      "forged state lands on /login?error=state_mismatch",
    );
    ok(setCookie(badState, "kairo_oauth") !== null, "oauth cookie is cleared");

    const noCookie = await request(
      new Map<string, string>(),
      `${api}/auth/github/callback?code=nope&state=whatever`,
    );
    ok(
      noCookie.status === 302 && location(noCookie).includes("state_mismatch"),
      "missing oauth cookie is treated as state_mismatch",
    );

    // 4. Full happy path
    console.log("\n4. full OAuth round trip");
    const fresh = await request(jar, `${api}/auth/github`);
    const toStub = await request(jar, location(fresh));
    ok(toStub.status === 302, "stub authorize redirects back with a code");
    const callbackUrl = location(toStub);
    ok(
      callbackUrl.startsWith(`${api}/auth/github/callback`),
      "GitHub redirects to our callback",
    );

    const callback = await request(jar, callbackUrl);
    ok(callback.status === 302, "callback redirects");
    ok(location(callback) === `${WEB_URL}/onboarding`, "new user goes to /onboarding");
    const sessionCookie = setCookie(callback, "kairo_session");
    ok(sessionCookie !== null, "session cookie set");
    ok(/HttpOnly/i.test(sessionCookie ?? ""), "session cookie is HttpOnly");
    ok(/SameSite=Lax/i.test(sessionCookie ?? ""), "session cookie is SameSite=Lax");
    ok(
      !/Secure/i.test(sessionCookie ?? ""),
      "session cookie is not Secure in development",
    );

    const meAfter = await request(jar, `${api}/auth/me`);
    ok(meAfter.status === 200, "GET /auth/me with session returns 200");
    const body = (await meAfter.json()) as { user: Record<string, unknown> };
    ok(body.user.username === "octo-dev", "profile upserted (username)");
    ok(body.user.avatarUrl === PROFILE_AVATAR, "avatar stored");
    ok(body.user.email === "octo@kairo.dev", "primary verified email stored");
    ok(body.user.onboardingStep === "WELCOME", "onboarding starts at WELCOME");

    const protectedRoute = await request(jar, `${api}/protected`);
    ok(protectedRoute.status === 200, "GET /protected returns 200 when authenticated");
    const protectedBody = (await protectedRoute.json()) as {
      ok: boolean;
      scopes: string | null;
    };
    ok(protectedBody.ok === true, "protected route reports ok");
    ok(
      protectedBody.scopes === "read:user user:email repo",
      "granted scopes reported",
    );

    // 5. Onboarding transitions
    console.log("\n5. onboarding transitions");
    const patch = (step: string) =>
      request(jar, `${api}/auth/onboarding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step }),
      });

    const skip = await patch("DONE");
    ok(skip.status === 400, "skipping steps is rejected (400)");

    const welcome = await patch("WELCOME");
    ok(welcome.status === 200, "re-submitting the current step is a no-op (200)");
    const profile = await patch("PROFILE");
    ok(profile.status === 200, "WELCOME -> PROFILE accepted");
    const backwards = await patch("WELCOME");
    ok(backwards.status === 400, "moving backwards is rejected (400)");
    const permissions = await patch("PERMISSIONS");
    ok(permissions.status === 200, "PROFILE -> PERMISSIONS accepted");
    const lastStep = await patch("DONE");
    ok(lastStep.status === 200, "PERMISSIONS -> DONE accepted");
    const lastBody = (await lastStep.json()) as { user: { onboardingStep: string } };
    ok(lastBody.user.onboardingStep === "DONE", "onboarding reached DONE");

    // 6. Stored token: encrypted + round-trips
    console.log("\n6. GithubConnection token encryption");
    const { encryptionKey } = await import("../src/config/env.js");
    const { decryptSecret } = await import("../src/lib/crypto.js");

    const connection = await prisma.githubConnection.findFirst();
    ok(connection !== null, "github connection stored");
    ok(
      connection!.accessTokenEncrypted !== stub.accessToken,
      "access token is not stored in plaintext",
    );
    ok(connection!.scopes === "read:user user:email repo", "scopes stored");
    const roundTripped = decryptSecret(connection!.accessTokenEncrypted, encryptionKey);
    ok(roundTripped === stub.accessToken, "AES-256-GCM round-trip recovers the token");

    // 7. Sliding renewal
    console.log("\n7. sliding session renewal");
    const ttlMs = SESSION_TTL_MS;
    const user = await prisma.user.findUniqueOrThrow({
      where: { githubId: "1001" },
    });
    const oldSession = await prisma.session.findFirstOrThrow({
      where: { userId: user.id },
    });
    const staleExpiry = new Date(Date.now() + ttlMs - 20 * 60 * 1000);
    await prisma.session.update({
      where: { id: oldSession.id },
      data: { expiresAt: staleExpiry },
    });

    ok(
      sessionLib.shouldRenewSession(staleExpiry) === true,
      "stale session is renew-eligible",
    );
    ok(
      sessionLib.shouldRenewSession(new Date(Date.now() + ttlMs)) === false,
      "fresh session is not renewed",
    );

    const renewed = await request(jar, `${api}/auth/me`);
    ok(renewed.status === 200, "still authenticated while renewing");
    const renewedCookie = setCookie(renewed, "kairo_session");
    ok(renewedCookie !== null, "session cookie re-issued on renewal");
    const rowAfterRenew = await prisma.session.findUniqueOrThrow({
      where: { id: oldSession.id },
    });
    ok(
      rowAfterRenew.expiresAt.getTime() > staleExpiry.getTime(),
      "DB expiry slid forward",
    );
    ok(
      rowAfterRenew.expiresAt.getTime() >= Date.now() + ttlMs - 60_000,
      "DB expiry restored to a full TTL",
    );

    // 8. Second login lands on the dashboard
    console.log("\n8. returning user");
    const secondStart = await request(jar, `${api}/auth/github`);
    const secondToStub = await request(jar, location(secondStart));
    const secondCallback = await request(jar, location(secondToStub));
    ok(
      location(secondCallback) === `${WEB_URL}/dashboard`,
      "completed onboarding goes to /dashboard",
    );

    // 9. Logout
    console.log("\n9. logout");
    const sessionsBefore = await prisma.session.count({
      where: { userId: user.id },
    });
    ok(sessionsBefore === 2, "two sessions exist (one per login)");
    const logout = await request(jar, `${api}/auth/logout`, { method: "POST" });
    ok(logout.status === 200, "POST /auth/logout returns 200");
    const sessionsAfter = await prisma.session.count({ where: { userId: user.id } });
    ok(sessionsAfter === 1, "only the current session was deleted");
    const meAfterLogout = await request(jar, `${api}/auth/me`);
    ok(meAfterLogout.status === 401, "session is dead after logout");

    // 10. Rate limiting
    console.log("\n10. rate limiting");
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      const response = await request(new Map<string, string>(), `${api}/auth/github`);
      statuses.push(response.status);
      if (response.status === 429) break;
    }
    ok(statuses.includes(429), "GET /auth/github is rate limited (429)");

    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    server.close();
    await stub.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\nVERIFICATION FAILED:", err);
  process.exitCode = 1;
});
