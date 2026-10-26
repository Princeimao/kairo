import { prisma } from "@kairo/db";
import type { Session, User } from "@kairo/db";
import { env, sessionTtlMs } from "../config/env.js";
import { hashToken, randomToken } from "./crypto.js";

export type SessionWithUser = Session & { user: User };


export type CreateSessionInput = {
  userId: string;
  userAgent: string | null;
  ip: string | null;
};

/** Issues a server-side session; the raw token only ever exists in the cookie. */
export async function createSession({
  userId,
  userAgent,
  ip,
}: CreateSessionInput): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token, env.SESSION_SECRET),
      userAgent: userAgent?.slice(0, 255) ?? null,
      ip,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

/** Looks up a session by its cookie value (hash lookup) and drops it when expired. */
export async function loadSession(
  token: string,
): Promise<SessionWithUser | null> {
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return session;
}

export function shouldRenewSession(expiresAt: Date): boolean {
  const renewAfterMs = env.SESSION_RENEW_INTERVAL_MINUTES * 60_000;
  const remaining = expiresAt.getTime() - Date.now();
  return remaining < sessionTtlMs() - renewAfterMs;
}

/** Sliding renewal: push expiry back to a full TTL. */
export async function renewSession(sessionId: string): Promise<Date> {
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await prisma.session.update({
    where: { id: sessionId },
    data: { expiresAt },
  });
  return expiresAt;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { tokenHash: hashToken(token, env.SESSION_SECRET) },
  });
}
