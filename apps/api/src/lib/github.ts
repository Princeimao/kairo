import { prisma } from "@kairo/db";
import { env, encryptionKey } from "../config/env.js";
import { decryptSecret } from "./crypto.js";

// GitHub Apps do not accept a `scope` query parameter (permissions are defined
// in the App settings); classic OAuth Apps take a space-separated list here.
export const GITHUB_SCOPES = env.GITHUB_OAUTH_SCOPES;
const REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export type AuthorizeParams = {
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

/**
 * Builds the GitHub authorization URL. GitHub has no discovery document, so
 * every endpoint/parameter is configured manually (see env config).
 */
export function buildAuthorizeUrl({
  redirectUri,
  state,
  codeChallenge,
}: AuthorizeParams): string {
  const url = new URL(env.GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  // GitHub Apps reject the authorize URL when a scope parameter is present.
  if (GITHUB_SCOPES.trim() !== "") {
    url.searchParams.set("scope", GITHUB_SCOPES.trim());
  }
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

type OAuthBody = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/** GitHub answers the token endpoint with JSON when `Accept: application/json`. */
async function parseOAuthBody(response: Response): Promise<OAuthBody> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return (await JSON.parse(text)) as OAuthBody;
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries()) as OAuthBody;
}

export type TokenResult = {
  accessToken: string;
  scope: string;
  tokenType: string;
};

export type ExchangeParams = {
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

/** Exchanges the authorization code for an access token (PKCE `code_verifier` included). */
export async function exchangeCode({
  code,
  codeVerifier,
  redirectUri,
}: ExchangeParams): Promise<TokenResult> {
  const response = await fetch(env.GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await parseOAuthBody(response);

  if (!response.ok || body.error) {
    throw new GitHubApiError(
      body.error_description ?? body.error ?? `token endpoint: HTTP ${response.status}`,
      response.status,
    );
  }
  if (!body.access_token) {
    throw new GitHubApiError("token endpoint returned no access_token", 502);
  }

  return {
    accessToken: body.access_token,
    scope: body.scope ?? GITHUB_SCOPES,
    tokenType: body.token_type ?? "bearer",
  };
}

async function githubApi(path: string, accessToken: string): Promise<Response> {
  return fetch(`${env.GITHUB_API_URL}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "Kairo",
      "x-github-api-version": GITHUB_API_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export type GithubProfile = {
  githubId: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
};

/** Profile data comes from GitHub's REST API — there is no OIDC userinfo endpoint. */
export async function fetchProfile(accessToken: string): Promise<GithubProfile> {
  const response = await githubApi("/user", accessToken);
  if (!response.ok) {
    throw new GitHubApiError(
      await errorMessage(response, `GET /user: HTTP ${response.status}`),
      response.status,
    );
  }

  const data = (await response.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
  };

  if (typeof data.id !== "number" || !data.login) {
    throw new GitHubApiError("GET /user returned an unexpected payload", 502);
  }

  return {
    githubId: String(data.id),
    username: data.login,
    name: data.name ?? null,
    email: data.email ?? null,
    avatarUrl: data.avatar_url ?? null,
    profileUrl: data.html_url ?? null,
  };
}

/** Primary verified address, falling back to any verified address. */
export async function fetchPrimaryEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await githubApi("/user/emails", accessToken);
  if (!response.ok) {
    throw new GitHubApiError(
      await errorMessage(response, `GET /user/emails: HTTP ${response.status}`),
      response.status,
    );
  }

  const emails = (await response.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  if (!Array.isArray(emails)) {
    throw new GitHubApiError("GET /user/emails returned an unexpected payload", 502);
  }

  const chosen =
    emails.find((entry) => entry.primary && entry.verified) ??
    emails.find((entry) => entry.verified) ??
    null;

  return chosen?.email ?? null;
}

/** Decrypted OAuth token for a user (null when GitHub is not connected). */
export async function userAccessToken(userId: string): Promise<string | null> {
  const connection = await prisma.githubConnection.findUnique({ where: { userId } });
  if (connection === null) return null;
  try {
    return decryptSecret(connection.accessTokenEncrypted, encryptionKey);
  } catch {
    return null;
  }
}

/** Authenticated GitHub REST call; throws GitHubApiError (with status) on !ok. */
export async function githubJson<T = unknown>(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${env.GITHUB_API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Kairo",
      "x-github-api-version": GITHUB_API_VERSION,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new GitHubApiError(`GitHub ${method} ${path} failed: ${message}`, response.status);
  }
  return json;
}
