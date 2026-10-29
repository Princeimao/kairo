import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@kairo/db";
import { z } from "zod";
import { encryptionKey, env } from "../config/env.js";
import {
  clearOauthCookie,
  clearSessionCookie,
  readOauthCookie,
  readSessionCookie,
  setOauthCookie,
  setSessionCookie,
} from "../lib/cookies.js";
import {
  constantTimeEqual,
  encryptSecret,
  pkceChallenge,
  randomToken,
} from "../lib/crypto.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchPrimaryEmail,
  fetchProfile,
  GitHubApiError,
} from "../lib/github.js";
import {
  createSession,
  destroySession,
  lookupSession,
  rotateSession,
} from "../lib/session.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/error-handler.js";
import { oauthStartRateLimiter } from "../middleware/rate-limit.js";

export const authRouter = Router();

const ONBOARDING_STEPS = ["WELCOME", "PROFILE", "PERMISSIONS", "DONE"] as const;
type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Onboarding only ever moves forward, one step at a time. */
const ONBOARDING_TRANSITIONS: Record<OnboardingStep, OnboardingStep[]> = {
  WELCOME: ["WELCOME", "PROFILE"],
  PROFILE: ["PROFILE", "PERMISSIONS"],
  PERMISSIONS: ["PERMISSIONS", "DONE"],
  DONE: ["DONE"],
};

function onboardingPatchSchema(current: OnboardingStep) {
  return z
    .object({ step: z.enum(ONBOARDING_STEPS) })
    .superRefine((value, ctx) => {
      if (!ONBOARDING_TRANSITIONS[current].includes(value.step)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["step"],
          message: `Onboarding cannot move from ${current} to ${value.step}`,
        });
      }
    });
}

type PublicUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  onboardingStep: OnboardingStep;
};

function toPublicUser(user: {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  onboardingStep: OnboardingStep;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    onboardingStep: user.onboardingStep,
  };
}

function authed(req: Request) {
  if (!req.auth) {
    throw new AppError(401, "Authentication required");
  }
  return req.auth;
}

function callbackUrl(): string {
  return `${env.API_URL}/auth/github/callback`;
}

function queryParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** OAuth failures land the user back on the login screen with a machine-readable reason. */
function redirectToLogin(res: Response, code: string): void {
  res.redirect(302, `${env.WEB_URL}/login?error=${encodeURIComponent(code)}`);
}

// ── Start the GitHub OAuth flow ─────────────────────────────────────
// ── GitHub App metadata ─────────────────────────────────────────────
// Lets the web app build the "install this App on your repositories" link
// without knowing the App slug itself.
authRouter.get("/github-app", (req, res) => {
  res.json({
    appUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}`,
    installUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
  });
});

authRouter.get("/github", oauthStartRateLimiter, (req, res, next) => {
  try {
    const state = randomToken();
    const verifier = randomToken(); // 43 chars, satisfies RFC 7636 length rules

    setOauthCookie(res, { state, verifier });

    res.redirect(
      302,
      buildAuthorizeUrl({
        redirectUri: callbackUrl(),
        state,
        codeChallenge: pkceChallenge(verifier),
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ── OAuth callback ──────────────────────────────────────────────────
authRouter.get("/github/callback", oauthStartRateLimiter, async (req, res, next) => {
  const oauthState = readOauthCookie(req);
  clearOauthCookie(res); // one-time use

  try {
    if (!oauthState) {
      return redirectToLogin(res, "state_mismatch");
    }

    const oauthError = queryParam(req.query.error);
    if (oauthError) {
      return redirectToLogin(
        res,
        oauthError === "access_denied" ? "access_denied" : "github_error",
      );
    }

    const state = queryParam(req.query.state);
    const code = queryParam(req.query.code);
    if (!state || !code || !constantTimeEqual(state, oauthState.state)) {
      return redirectToLogin(res, "state_mismatch");
    }

    const tokens = await exchangeCode({
      code,
      codeVerifier: oauthState.verifier,
      redirectUri: callbackUrl(),
    });

    const profile = await fetchProfile(tokens.accessToken);

    let email = profile.email;
    try {
      email = (await fetchPrimaryEmail(tokens.accessToken)) ?? profile.email;
    } catch (err) {
      console.warn("[auth] could not read primary email, falling back:", err);
    }

    const user = await prisma.user.upsert({
      where: { githubId: profile.githubId },
      create: {
        githubId: profile.githubId,
        username: profile.username,
        name: profile.name,
        email,
        avatarUrl: profile.avatarUrl,
      },
      update: {
        username: profile.username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        ...(email ? { email } : {}),
      },
    });

    const accessTokenEncrypted = encryptSecret(tokens.accessToken, encryptionKey);
    await prisma.githubConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        accessTokenEncrypted,
        scopes: tokens.scope,
      },
      update: {
        accessTokenEncrypted,
        scopes: tokens.scope,
      },
    });

    const session = await createSession({
      userId: user.id,
      userAgent: req.get("user-agent") ?? null,
      ip: req.ip ?? null,
    });
    setSessionCookie(res, session.token, session.expiresAt);

    const destination = user.onboardingStep === "DONE" ? "/dashboard" : "/onboarding";
    res.redirect(302, `${env.WEB_URL}${destination}`);
  } catch (err) {
    if (err instanceof GitHubApiError) {
      console.error(`[auth] GitHub error during callback: ${err.message}`);
      return redirectToLogin(res, "github_error");
    }
    next(err);
  }
});

// ── Logout ──────────────────────────────────────────────────────────
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = readSessionCookie(req);
    if (token) {
      await destroySession(token);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Refresh (token rotation) ────────────────────────────────────────
// Issues a brand-new opaque token for the current session and re-sets the
// cookie with a full TTL, so active users never age out. The old token stops
// matching immediately; a stale in-flight request may still 401 once (unknown
// tokens deliberately do NOT clear the cookie, so the fresh one survives).
// The web app calls this on load, on tab focus, and every 6 hours.
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = readSessionCookie(req);
    if (!token) {
      throw new AppError(401, "Authentication required");
    }

    const lookup = await lookupSession(token);
    if (lookup.status === "expired") clearSessionCookie(res);
    if (lookup.status !== "active") {
      throw new AppError(401, "Session is invalid or expired");
    }

    const rotated = await rotateSession(lookup.session.id);
    setSessionCookie(res, rotated.token, rotated.expiresAt);
    res.json({ ok: true, expiresAt: rotated.expiresAt });
  } catch (err) {
    next(err);
  }
});

// ── Current user ────────────────────────────────────────────────────
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: toPublicUser(authed(req).user) });
});

// ── Advance onboarding ──────────────────────────────────────────────
authRouter.patch("/onboarding", requireAuth, async (req, res, next) => {
  try {
    const { user } = authed(req);
    const { step } = onboardingPatchSchema(user.onboardingStep).parse(req.body);

    const updated =
      step === user.onboardingStep
        ? user
        : await prisma.user.update({
            where: { id: user.id },
            data: { onboardingStep: step },
          });

    res.json({ user: toPublicUser(updated) });
  } catch (err) {
    next(err);
  }
});
