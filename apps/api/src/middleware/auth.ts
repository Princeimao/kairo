import type { RequestHandler } from "express";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "../lib/cookies.js";
import {
  lookupSession,
  renewSession,
  shouldRenewSession,
} from "../lib/session.js";
import { AppError } from "./error-handler.js";

/**
 * 401s unless a valid, unexpired session cookie is present. Slides the session
 * expiry forward (server-side row + refreshed cookie) as it is used.
 *
 * The cookie is only cleared when the session is *expired*: an unknown token
 * must survive, because right after POST /auth/refresh the browser may still
 * send a stale in-flight request with the pre-rotation token while already
 * holding the fresh cookie — clearing would log the user out over a race.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = readSessionCookie(req);
    if (!token) {
      throw new AppError(401, "Authentication required");
    }

    const lookup = await lookupSession(token);
    if (lookup.status !== "active") {
      if (lookup.status === "expired") clearSessionCookie(res);
      throw new AppError(401, "Session is invalid or expired");
    }
    const session = lookup.session;

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
