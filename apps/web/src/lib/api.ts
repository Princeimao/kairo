
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
      /** The agent is waiting for the user to answer (Approve/Decline/reply). */
      type: "ask";
      askId: string;
      question: string;
      options?: string[];
    }
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

  /** Rotates the session token and re-sets the cookie (SessionRefresh keeps this on a timer). */
  refresh: () =>
    apiFetch<{ ok: boolean; expiresAt: string }>("/auth/refresh", {
      method: "POST",
    }),

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

  /** Reply to a pending `ask` event (Approve / Decline / free-text note). */
  answer: (
    id: string,
    input: { askId: string; approved: boolean; note?: string },
  ) =>
    apiFetch<{ ok: boolean }>(`/runs/${id}/answers`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

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

  /** The user's repositories for the composer's repo picker. */
  repos: () =>
    apiFetch<{ repos: GithubRepoItem[] }>("/github/repos").then(
      (r) => r.repos,
    ),
};

export type GithubRepoItem = {
  fullName: string;
  private: boolean;
  fork: boolean;
  push: boolean;
  defaultBranch: string;
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

export type UserSkillItem = {
  id: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type ResearchSearchResponse = {
  query: string;
  results: ResearchResult[];
  answer?: string;
};

export type ScheduleItem = {
  id: string;
  title: string;
  prompt: string;
  mode: "CREATE" | "FIX";
  intervalMinutes: number | null;
  dailyAt: string | null;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The user's custom harness skills (create / import-from-URL / delete). */
export const skills = {
  list: () =>
    apiFetch<{ skills: UserSkillItem[] }>("/skills").then((r) => r.skills),

  create: (input: { name: string; description: string; body: string }) =>
    apiFetch<{ skill: UserSkillItem }>("/skills", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.skill),

  /** Fetch a SKILL.md from an online source and install it. */
  importUrl: (url: string) =>
    apiFetch<{ skill: UserSkillItem }>("/skills/import", {
      method: "POST",
      body: JSON.stringify({ url }),
    }).then((r) => r.skill),

  remove: (id: string) =>
    apiFetch<{ ok: boolean }>(`/skills/${id}`, { method: "DELETE" }),
};

/** Tavily-backed research for the signed-in user. */
export const research = {
  search: (input: {
    query: string;
    maxResults?: number;
    topic?: "general" | "news" | "finance";
  }) =>
    apiFetch<ResearchSearchResponse>("/research/search", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  extract: (urls: string[]) =>
    apiFetch<{
      results: { url: string; content: string }[];
      failed: { url: string; error: string }[];
    }>("/research/extract", {
      method: "POST",
      body: JSON.stringify({ urls }),
    }),
};

/** Scheduled (recurring) runs. */
export const schedules = {
  list: () =>
    apiFetch<{ schedules: ScheduleItem[] }>("/schedules").then(
      (r) => r.schedules,
    ),

  create: (input: {
    title?: string;
    prompt: string;
    mode?: "CREATE" | "FIX";
    intervalMinutes?: number;
    dailyAt?: string;
  }) =>
    apiFetch<{ schedule: ScheduleItem }>("/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.schedule),

  update: (
    id: string,
    input: {
      title?: string;
      prompt?: string;
      mode?: "CREATE" | "FIX";
      active?: boolean;
      intervalMinutes?: number;
      dailyAt?: string;
    },
  ) =>
    apiFetch<{ schedule: ScheduleItem }>(`/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.schedule),

  remove: (id: string) =>
    apiFetch<{ ok: boolean }>(`/schedules/${id}`, { method: "DELETE" }),
};

/** Full-page navigation through the proxy, so the session cookie lands on this origin. */
export const githubLoginUrl = "/api/auth/github";
