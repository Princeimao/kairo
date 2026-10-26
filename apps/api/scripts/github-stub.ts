import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

/**
 * Minimal stand-in for GitHub's OAuth + REST endpoints.
 *
 * Used to verify Kairo's auth flow without a real GitHub OAuth App:
 *  - enforces PKCE (S256) the same way github.com does
 *  - single-use authorization codes
 *  - Bearer-protected /user and /user/emails
 *
 * Run standalone:  npx tsx scripts/github-stub.ts   (STUB_PORT, default 4100)
 */

const ACCESS_TOKEN = `gho_stub_${randomBytes(16).toString("hex")}`;

const PROFILE = {
  id: 1001,
  login: "octo-dev",
  name: "Octo Dev",
  email: null as string | null,
  avatar_url: "https://avatars.githubusercontent.com/u/1001?v=4",
  html_url: "https://github.com/octo-dev",
};

const EMAILS = [
  { email: "octo.dev@gmail.com", primary: false, verified: true },
  { email: "octo@kairo.dev", primary: true, verified: true },
];

type PendingCode = {
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  scope: string;
  used: boolean;
};

const codes = new Map<string, PendingCode>();

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://localhost:${PORT}`);
}

let PORT = Number(process.env.STUB_PORT ?? 4100);

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = parseUrl(req);
  const path = url.pathname;

  if (path === "/login/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const codeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");
    const clientId = url.searchParams.get("client_id");
    const scope = url.searchParams.get("scope") ?? "";

    if (!redirectUri || !state || !codeChallenge || !clientId) {
      json(res, 400, { error: "invalid_request" });
      return;
    }

    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod ?? "S256",
      redirectUri,
      scope,
      used: false,
    });

    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    redirect(res, target.href);
    return;
  }

  if (path === "/login/oauth/access_token" && req.method === "POST") {
    const body = new URLSearchParams(await readBody(req));
    const code = body.get("code");
    const verifier = body.get("code_verifier");
    const redirectUri = body.get("redirect_uri");

    const pending = code ? codes.get(code) : undefined;
    if (!pending || pending.used) {
      json(res, 400, {
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
      });
      return;
    }

    // PKCE check — S256 only, exactly like GitHub.
    const challenge = base64url(createHash("sha256").update(verifier ?? "").digest());
    if (
      pending.codeChallengeMethod !== "S256" ||
      !verifier ||
      !timingSafeEqual(Buffer.from(challenge), Buffer.from(pending.codeChallenge))
    ) {
      json(res, 400, {
        error: "bad_verification_code",
        error_description: "PKCE verification failed.",
      });
      return;
    }

    if (redirectUri !== pending.redirectUri) {
      json(res, 400, {
        error: "redirect_uri_mismatch",
        error_description: "The redirect_uri does not match.",
      });
      return;
    }

    pending.used = true;

    json(res, 200, {
      access_token: ACCESS_TOKEN,
      token_type: "bearer",
      scope: pending.scope,
      expires_in: 3600,
    });
    return;
  }

  if (path === "/user" || path === "/user/emails") {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${ACCESS_TOKEN}`) {
      json(res, 401, { message: "Bad credentials" });
      return;
    }
    json(res, 200, path === "/user" ? PROFILE : EMAILS);
    return;
  }

  json(res, 404, { message: `stub: no route for ${path}` });
}

export type Stub = {
  url: string;
  accessToken: string;
  close: () => Promise<void>;
};

export function startGithubStub(port = 4100): Promise<Stub> {
  PORT = port;
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => json(res, 500, { error: String(err) }));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        url: `http://localhost:${port}`,
        accessToken: ACCESS_TOKEN,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const stub = await startGithubStub(PORT);
  console.log(`[stub] GitHub OAuth stub listening on ${stub.url}`);
  console.log(`[stub] stub access token: ${ACCESS_TOKEN}`);
}
