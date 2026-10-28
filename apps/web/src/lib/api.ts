
const API_PREFIX = "/api";

export type OnboardingStep = "WELCOME" | "PROFILE" | "PERMISSIONS" | "DONE";

export type PublicUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  onboardingStep: OnboardingStep;
};

/** RunEvent — mirrors @kairo/run-queue (SSE `data:` payloads). */
export type AgentEvent =
  | { type: "workspace"; state: "starting" | "ready" }
  | { type: "text"; text: string; done?: boolean }
  | { type: "reasoning"; text: string; done?: boolean }
  | {
      type: "tool";
      name: string;
      state: "running" | "done" | "error";
      input?: unknown;
      output?: string;
      callId?: string;
    }
  | { type: "edit"; path: string; state?: "running" | "done" | "error" }
  | { type: "error"; code: string; message: string }
  | {
      type: "done";
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      summary: string;
      tokensIn?: number;
      tokensOut?: number;
      prUrl?: string;
      error?: { code: string; message: string };
    };

export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export type RunSummary = {
  id: string;
  status: RunStatus;
  mode: string;
  prompt: string;
  conversationId: string | null;
  repoFullName: string | null;
  prUrl: string | null;
  errorMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
  finishedAt: string | null;
};

export type StartedRun = {
  runId: string;
  conversationId: string;
  sessionId: string;
};

export type ConversationMessage = {
  id: string;
  role: string;
  content: string;
  runId: string | null;
  createdAt: string;
};

export type ConversationView = {
  id: string;
  sessionId: string;
  mode: string;
  createdAt: string;
  messages: ConversationMessage[];
  runs: { id: string; status: string; createdAt: string; finishedAt: string | null }[];
};

export type ConversationSummary = {
  id: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
  lastRole: string | null;
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  conversations: ConversationSummary[];
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
    response = await fetch(`${API_PREFIX}${path}`, {
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

  /** Public GitHub App metadata (install links for the onboarding step). */
  githubApp: () =>
    apiFetch<{ appUrl: string; installUrl: string }>("/auth/github-app"),
};

export const runs = {
  create: (input: {
    prompt: string;
    mode?: "CREATE" | "FIX";
    conversationId?: string;
    sessionId?: string;
    repoFullName?: string;
  }) =>
    apiFetch<StartedRun & { status: RunStatus }>("/runs", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  list: () => apiFetch<{ runs: RunSummary[] }>("/runs").then((r) => r.runs),

  get: (id: string) =>
    apiFetch<{ run: RunSummary; steps: number }>(`/runs/${id}`),

  cancel: (id: string) =>
    apiFetch<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),

  /** SSE endpoint (same-origin via the /api rewrite, cookies flow with it). */
  eventsUrl: (id: string) => `/api/runs/${id}/events`,
};

export const sessions = {
  list: () =>
    apiFetch<{ sessions: SessionSummary[] }>("/sessions").then(
      (r) => r.sessions,
    ),

  get: (id: string) =>
    apiFetch<{ session: SessionSummary }>(`/sessions/${id}`),

  create: (title?: string) =>
    apiFetch<{ session: SessionSummary }>("/sessions", {
      method: "POST",
      body: JSON.stringify(title ? { title } : {}),
    }),

  newConversation: (
    id: string,
    input: { prompt: string; mode?: "CREATE" | "FIX"; repoFullName?: string },
  ) =>
    apiFetch<StartedRun & { status: RunStatus }>(`/sessions/${id}/conversations`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export const conversations = {
  get: (id: string) =>
    apiFetch<{ conversation: ConversationView }>(`/conversations/${id}`),

  message: (
    id: string,
    input: { prompt: string; mode?: "CREATE" | "FIX"; repoFullName?: string },
  ) =>
    apiFetch<StartedRun & { status: RunStatus }>(`/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export const github = {
  /** Recent GitHub activity (issues, PRs, review comments) from webhooks. */
  events: () =>
    apiFetch<{ events: GithubEventItem[] }>("/github/events").then(
      (r) => r.events,
    ),
};

export type GithubEventItem = {
  id: string;
  eventType: string;
  action: string | null;
  repo: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  createdAt: string;
};

/** Full-page navigation through the proxy, so the session cookie lands on this origin. */
export const githubLoginUrl = "/api/auth/github";
