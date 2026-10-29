import { freshEnvValue } from "../config/env.js";

const TAVILY_BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULTS = 10;
const MAX_CONTENT_CHARS = 4_000;
const MAX_EXTRACT_CHARS = 40_000;

/** Thrown when TAVILY_API_KEY (or the legacy TAVILY_API) is absent. */
export class TavilyNotConfiguredError extends Error {
  constructor() {
    super("Tavily is not configured — set TAVILY_API_KEY in apps/api/.env");
    this.name = "TavilyNotConfiguredError";
  }
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

function tavilyKey(): string {
  const key = freshEnvValue("TAVILY_API_KEY") ?? freshEnvValue("TAVILY_API");
  if (key === null) throw new TavilyNotConfiguredError();
  return key;
}

function clampContent(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function tavilyPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = tavilyKey();
  const response = await fetch(`${TAVILY_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ ...body, api_key: key }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(
      `Tavily request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const json = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "detail" in json
        ? String((json as { detail: unknown }).detail)
        : `HTTP ${response.status}`;
    throw new Error(`Tavily ${path} failed: ${message}`);
  }
  if (json === null) throw new Error(`Tavily ${path} returned no JSON`);
  return json;
}

export interface TavilySearchOptions {
  query: string;
  maxResults?: number;
  topic?: "general" | "news" | "finance";
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
}

/** Web search via Tavily. */
export async function tavilySearch(
  options: TavilySearchOptions,
): Promise<TavilySearchResponse> {
  const maxResults = Math.min(
    Math.max(options.maxResults ?? 5, 1),
    MAX_RESULTS,
  );
  const raw = await tavilyPost<{
    query?: unknown;
    results?: unknown;
    answer?: unknown;
  }>("/search", {
    query: options.query,
    max_results: maxResults,
    topic: options.topic ?? "general",
    include_answer: false,
    include_raw_content: false,
  });

  const results = Array.isArray(raw.results)
    ? raw.results
        .map((entry) => {
          const item = entry as {
            title?: unknown;
            url?: unknown;
            content?: unknown;
            score?: unknown;
          };
          return {
            title: typeof item.title === "string" ? item.title : "",
            url: typeof item.url === "string" ? item.url : "",
            content: clampContent(item.content, MAX_CONTENT_CHARS),
            score: typeof item.score === "number" ? item.score : undefined,
          };
        })
        .filter((entry) => entry.url !== "")
    : [];

  return {
    query: typeof raw.query === "string" ? raw.query : options.query,
    results,
    ...(typeof raw.answer === "string"
      ? { answer: clampContent(raw.answer, MAX_CONTENT_CHARS) }
      : {}),
  };
}

export interface TavilyExtractResponse {
  results: { url: string; content: string }[];
  failed: { url: string; error: string }[];
}

/** Fetch + readability-extract full page text (for reading docs online). */
export async function tavilyExtract(
  urls: string[],
): Promise<TavilyExtractResponse> {
  const capped = urls.slice(0, 5);
  const raw = await tavilyPost<{
    results?: unknown;
    failed_results?: unknown;
  }>("/extract", { urls: capped });

  const results = Array.isArray(raw.results)
    ? raw.results
        .map((entry) => {
          const item = entry as { url?: unknown; raw_content?: unknown };
          return {
            url: typeof item.url === "string" ? item.url : "",
            content: clampContent(item.raw_content, MAX_EXTRACT_CHARS),
          };
        })
        .filter((entry) => entry.url !== "")
    : [];

  const failed = Array.isArray(raw.failed_results)
    ? raw.failed_results
        .map((entry) => {
          const item = entry as { url?: unknown; error?: unknown };
          return {
            url: typeof item.url === "string" ? item.url : "",
            error: typeof item.error === "string" ? item.error : "failed",
          };
        })
        .filter((entry) => entry.url !== "")
    : [];

  return { results, failed };
}
