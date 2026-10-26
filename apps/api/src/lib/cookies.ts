import type { Request, Response } from "express";
import { env, oauthCookieTtlMs } from "../config/env.js";

export const SESSION_COOKIE = "kairo_session";
export const OAUTH_COOKIE = "kairo_oauth";

export type OauthState = {
  state: string;
  verifier: string;
};

const baseOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/",
};

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions, expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseOptions);
}

/** Short-lived one-time cookie carrying the `state` + PKCE verifier of a login attempt. */
export function setOauthCookie(res: Response, payload: OauthState): void {
  res.cookie(OAUTH_COOKIE, JSON.stringify(payload), {
    ...baseOptions,
    maxAge: oauthCookieTtlMs(),
  });
}

export function clearOauthCookie(res: Response): void {
  res.clearCookie(OAUTH_COOKIE, { ...baseOptions, maxAge: oauthCookieTtlMs() });
}

export function readSessionCookie(req: Request): string | null {
  const value = req.cookies?.[SESSION_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readOauthCookie(req: Request): OauthState | null {
  const raw = req.cookies?.[OAUTH_COOKIE];
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OauthState>;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") {
      return null;
    }
    if (parsed.state.length === 0 || parsed.verifier.length === 0) return null;
    return { state: parsed.state, verifier: parsed.verifier };
  } catch {
    return null;
  }
}
