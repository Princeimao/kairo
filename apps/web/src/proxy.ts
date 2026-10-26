import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SESSION_COOKIE = "kairo_session";

type MeResponse = { user: { onboardingStep: string } };

type MeResult =
  | { status: "authenticated"; onboardingStep: string }
  | { status: "unauthenticated" }
  | { status: "unknown" };

/**
 * Server-side session check against the API. The cookie is forwarded as a
 * request header because this runs outside the browser.
 */
async function fetchMe(request: NextRequest): Promise<MeResult> {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return { status: "unauthenticated" };

  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
      cache: "no-store",
    });

    if (response.ok) {
      const data = (await response.json()) as MeResponse;
      return {
        status: "authenticated",
        onboardingStep: data.user.onboardingStep,
      };
    }
    if (response.status === 401) return { status: "unauthenticated" };
    return { status: "unknown" };
  } catch {
    // API unreachable — don't log the user out over a network blip.
    return { status: "unknown" };
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  // Signed-in users skip the login screen.
  if (pathname.startsWith("/login")) {
    if (!hasSessionCookie) return NextResponse.next();

    const result = await fetchMe(request);
    if (result.status !== "authenticated") return NextResponse.next();

    const target = result.onboardingStep === "DONE" ? "/dashboard" : "/onboarding";
    return NextResponse.redirect(new URL(target, request.url));
  }

  const isProtected =
    pathname.startsWith("/dashboard") || pathname.startsWith("/onboarding");
  if (!isProtected) return NextResponse.next();

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const result = await fetchMe(request);

  if (result.status === "unauthenticated") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (result.status === "unknown") {
    // API is down: let the page render its own error state instead of
    // pretending the user is logged out.
    return NextResponse.next();
  }

  const onboardingDone = result.onboardingStep === "DONE";

  if (!onboardingDone && !pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  if (onboardingDone && pathname.startsWith("/onboarding")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login"],
};
