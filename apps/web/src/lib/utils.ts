export { cn } from "cn";

/**
 * `next/image` only loads hosts configured in next.config.js, so any avatar
 * outside that allowlist falls back to initials instead of crashing.
 */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname === "avatars.githubusercontent.com"
      ? url
      : null;
  } catch {
    return null;
  }
}
