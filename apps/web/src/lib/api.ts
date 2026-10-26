const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type OnboardingStep = "WELCOME" | "PROFILE" | "PERMISSIONS" | "DONE";

export type PublicUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  onboardingStep: OnboardingStep;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Every call to the API goes through here: cross-origin cookies are always
 * sent (`credentials: "include"`) so `/auth/me` and friends see the session.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Could not reach the Kairo API");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
}

export const auth = {
  me: () => apiFetch<{ user: PublicUser }>("/auth/me").then((r) => r.user),

  logout: () => apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  setOnboardingStep: (step: OnboardingStep) =>
    apiFetch<{ user: PublicUser }>("/auth/onboarding", {
      method: "PATCH",
      body: JSON.stringify({ step }),
    }).then((r) => r.user),
};

export const apiUrl = API_URL;

/** Full-page navigation target that starts the GitHub OAuth flow. */
export const githubLoginUrl = `${API_URL}/auth/github`;
