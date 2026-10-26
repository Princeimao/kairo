import { rateLimit } from "express-rate-limit";

const onTooMany = { error: "Too many requests, please try again later." };

/** Applied to every /auth/* route (per IP, sliding window). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: onTooMany,
});

/** Stricter budget for starting/exchanging an OAuth login (CSRF/code-leak surface). */
export const oauthStartRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts, please try again later." },
});
