import type { RequestHandler } from "express";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "../lib/cookies.js";
import {
  loadSession,
  renewSession,
  shouldRenewSession,
} from "../lib/session.js";
import { AppError } from "./error-handler.js";

/**
 * 401s unless a valid, unexpired session cookie is present. Slides the session
 * expiry forward (server-side row + refreshed cookie) as it is used.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = readSessionCookie(req);
    if (!token) {
      throw new AppError(401, "Authentication required");
    }

    const session = await loadSession(token);
    if (!session) {
      clearSessionCookie(res);
      throw new AppError(401, "Session is invalid or expired");
    }

    if (shouldRenewSession(session.expiresAt)) {
      const expiresAt = await renewSession(session.id);
      session.expiresAt = expiresAt;
      // token is unchanged; only the cookie expiry is extended
      setSessionCookie(res, token, expiresAt);
    }

    req.auth = { session, user: session.user };
    next();
  } catch (err) {
    next(err);
  }
};
