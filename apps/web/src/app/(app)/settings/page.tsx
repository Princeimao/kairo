"use client";

import * as React from "react";
import {
  CalendarClock,
  Clock,
  Download,
  Link2,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ApiError,
  schedules,
  skills,
  type ScheduleItem,
  type UserSkillItem,
} from "@/lib/api";

const INTERVAL_OPTIONS = [
  { minutes: 15, label: "every 15 min" },
  { minutes: 60, label: "every hour" },
  { minutes: 360, label: "every 6 hours" },
  { minutes: 720, label: "every 12 hours" },
  { minutes: 1440, label: "every day" },
];

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cadenceLabel(schedule: ScheduleItem): string {
  if (schedule.dailyAt !== null) return `daily at ${schedule.dailyAt} UTC`;
  if (schedule.intervalMinutes !== null) {
    const option = INTERVAL_OPTIONS.find(
      (entry) => entry.minutes === schedule.intervalMinutes,
    );
    return option ? option.label : `every ${schedule.intervalMinutes} min`;
  }
  return "—";
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
      <div className="mb-1 text-sm font-medium text-orange-500">settings</div>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight text-neutral-950 md:text-4xl">
        Harness settings
      </h1>
      <SkillsSection />
      <SchedulesSection />
    </div>
  );
}

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 rounded-2xl border border-neutral-200/70 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-neutral-950">
        {title}
      </div>
      {hint && <p className="mb-5 text-sm text-neutral-500">{hint}</p>}
      {children}
    </section>
  );
}

function SkillsSection() {
  const [list, setList] = React.useState<UserSkillItem[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [importUrl, setImportUrl] = React.useState("");
  const [busy, setBusy] = React.useState<"create" | "import" | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    skills
      .list()
      .then((items) => {
        setList(items);
        setListError(null);
      })
      .catch((error: unknown) => {
        setListError(errorMessage(error));
        setList([]);
      });
  }, []);

  React.useEffect(reload, [reload]);

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!SLUG_RE.test(name)) {
      setFormError(
        "Name must be lowercase letters, digits and dashes (a-z, 0-9, -)",
      );
      return;
    }
    setBusy("create");
    try {
      await skills.create({ name, description, body });
      setName("");
      setDescription("");
      setBody("");
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const onImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setBusy("import");
    try {
      await skills.importUrl(importUrl.trim());
      setImportUrl("");
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (skill: UserSkillItem) => {
    if (!window.confirm(`Delete the skill "${skill.name}"?`)) return;
    try {
      await skills.remove(skill.id);
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    }
  };

  const inputClass =
    "w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-orange-400";

  return (
    <SectionCard
      title="Custom skills"
      hint="Skills teach the agent how you want specific work done. They load into your workspace (and become available to the skill tool) when your next run starts."
    >
      <form onSubmit={onImport} className="mb-5 flex gap-2">
        <input
          value={importUrl}
          onChange={(event) => setImportUrl(event.target.value)}
          placeholder="Paste a URL to a SKILL.md (raw GitHub link, docs site, …)"
          className={inputClass}
          aria-label="Skill URL"
        />
        <button
          type="submit"
          disabled={busy !== null || importUrl.trim() === ""}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy === "import" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Import
        </button>
      </form>

      <form onSubmit={onCreate} className="mb-5 rounded-xl bg-neutral-50 p-4">
        <div className="mb-3 text-sm font-medium text-neutral-700">
          Create a skill
        </div>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="name (e.g. my-deploy-flow)"
            className={inputClass}
            aria-label="Skill name"
          />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="when should the agent use it?"
            className={inputClass}
            aria-label="Skill description"
          />
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={"Markdown instructions — steps, commands, rules…\n\n## Steps\n1. …"}
          rows={6}
          className={`${inputClass} font-mono text-xs leading-relaxed`}
          aria-label="Skill body"
        />
        <button
          type="submit"
          disabled={
            busy !== null ||
            name.trim() === "" ||
            description.trim() === "" ||
            body.trim() === ""
          }
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
        >
          {busy === "create" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Add skill
        </button>
      </form>

      {formError && <p className="mb-3 text-sm text-red-500">{formError}</p>}
      {listError && <p className="mb-3 text-sm text-red-500">{listError}</p>}

      <div className="space-y-2">
        {list === null && !listError && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="size-4 animate-spin" /> loading skills…
          </div>
        )}
        {list?.length === 0 && (
          <p className="text-sm text-neutral-400">
            No skills yet — import one from a URL or create one above.
          </p>
        )}
        {list?.map((skill) => (
          <div
            key={skill.id}
            className="flex items-start gap-3 rounded-xl border border-neutral-200/70 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-medium text-neutral-900">
                  {skill.name}
                </span>
                {skill.sourceUrl && (
                  <a
                    href={skill.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-neutral-400 transition-colors hover:text-orange-500"
                  >
                    <Link2 className="size-3" /> imported
                  </a>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">
                {skill.description}
              </p>
              <p className="mt-1 text-[11px] text-neutral-400">
                updated {formatWhen(skill.updatedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onDelete(skill)}
              aria-label={`Delete ${skill.name}`}
              className="cursor-pointer rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SchedulesSection() {
  const [list, setList] = React.useState<ScheduleItem[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [cadenceKind, setCadenceKind] = React.useState<"interval" | "daily">(
    "interval",
  );
  const [intervalMinutes, setIntervalMinutes] = React.useState(60);
  const [dailyAt, setDailyAt] = React.useState("09:00");
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    schedules
      .list()
      .then((items) => {
        setList(items);
        setListError(null);
      })
      .catch((error: unknown) => {
        setListError(errorMessage(error));
        setList([]);
      });
  }, []);

  React.useEffect(reload, [reload]);

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await schedules.create({
        ...(title.trim() !== "" ? { title: title.trim() } : {}),
        prompt: prompt.trim(),
        ...(cadenceKind === "interval"
          ? { intervalMinutes }
          : { dailyAt }),
      });
      setPrompt("");
      setTitle("");
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (schedule: ScheduleItem) => {
    try {
      await schedules.update(schedule.id, { active: !schedule.active });
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    }
  };

  const onDelete = async (schedule: ScheduleItem) => {
    if (!window.confirm(`Delete this schedule${schedule.title ? ` "${schedule.title}"` : ""}?`)) {
      return;
    }
    try {
      await schedules.remove(schedule.id);
      reload();
    } catch (error: unknown) {
      setFormError(errorMessage(error));
    }
  };

  const inputClass =
    "w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-orange-400";

  return (
    <SectionCard
      title="Scheduled runs"
      hint="Recurring prompts that start a run on their own (times are UTC). If another run is active when one is due, that period is skipped."
    >
      <form onSubmit={onCreate} className="mb-5 rounded-xl bg-neutral-50 p-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="title (optional, e.g. morning triage)"
          className={`${inputClass} mb-3`}
          aria-label="Schedule title"
        />
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should the agent do on each run?"
          rows={3}
          className={`${inputClass} mb-3`}
          aria-label="Schedule prompt"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cadenceKind === "daily" ? "daily" : String(intervalMinutes)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "daily") {
                setCadenceKind("daily");
              } else {
                setCadenceKind("interval");
                setIntervalMinutes(Number(value));
              }
            }}
            className="cursor-pointer rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 outline-none focus:border-orange-400"
            aria-label="Cadence"
          >
            {INTERVAL_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
            <option value="daily">daily at (UTC)…</option>
          </select>
          {cadenceKind === "daily" && (
            <input
              type="time"
              value={dailyAt}
              onChange={(event) => setDailyAt(event.target.value)}
              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none focus:border-orange-400"
              aria-label="Daily time (UTC)"
            />
          )}
          <button
            type="submit"
            disabled={busy || prompt.trim().length < 3}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Schedule
          </button>
        </div>
      </form>

      {formError && <p className="mb-3 text-sm text-red-500">{formError}</p>}
      {listError && <p className="mb-3 text-sm text-red-500">{listError}</p>}

      <div className="space-y-2">
        {list === null && !listError && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 className="size-4 animate-spin" /> loading schedules…
          </div>
        )}
        {list?.length === 0 && (
          <p className="text-sm text-neutral-400">No schedules yet.</p>
        )}
        {list?.map((schedule) => (
          <div
            key={schedule.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              schedule.active
                ? "border-neutral-200/70"
                : "border-neutral-200/50 bg-neutral-50 opacity-70"
            }`}
          >
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
              <CalendarClock className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-neutral-900">
                  {schedule.title || schedule.prompt.slice(0, 48)}
                </span>
                {!schedule.active && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    paused
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">
                {schedule.prompt}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" /> {cadenceLabel(schedule)}
                </span>
                <span>
                  next {formatWhen(schedule.nextRunAt)}
                  {schedule.lastRunAt
                    ? ` · last ${formatWhen(schedule.lastRunAt)}`
                    : ""}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void toggleActive(schedule)}
                title={schedule.active ? "Pause" : "Resume"}
                className="cursor-pointer rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
              >
                {schedule.active ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(schedule)}
                title="Delete"
                className="cursor-pointer rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
