import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@kairo/db";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";

export const skillsRouter = Router();

/** Skills the worker writes itself — user skills must never shadow these. */
const RESERVED_NAMES = ["github-publish", "software-engineer", "research"];

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const MAX_SKILL_CHARS = 200_000;

function authenticatedUser(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) throw new AppError(401, "Authentication required");
  return id;
}

function idParam(req: Request, name: string): string {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, `Missing ${name}`);
  }
  return value;
}

function serializeSkill(row: {
  id: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertUsableName(name: string): void {
  if (!SLUG_RE.test(name)) {
    throw new AppError(
      400,
      "Skill name must be lowercase letters, digits and dashes (a-z, 0-9, -)",
    );
  }
  if (RESERVED_NAMES.includes(name)) {
    throw new AppError(409, `"${name}" is a built-in skill name`);
  }
}

function parseFrontMatter(content: string): {
  name: string | null;
  description: string | null;
} {
  const match = FRONT_MATTER_RE.exec(content);
  if (match === null) return { name: null, description: null };
  const block = match[1];
  const field = (key: string): string | null => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(block);
    if (line === null) return null;
    let value = line[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value === "" ? null : value;
  };
  return { name: field("name"), description: field("description") };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

/** Rejects loopback/private/link-local hosts so the import URL can't SSRF. */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80")
  ) {
    throw new AppError(400, "That host is not allowed");
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const octets = v4.slice(1).map(Number);
    const [a, b] = octets;
    const privateBlock =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (privateBlock || octets.some((o) => o > 255)) {
      throw new AppError(400, "That host is not allowed");
    }
  }
  return url;
}

/** GET /skills — the user's custom skills for the workspace harness. */
skillsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const skills = await prisma.userSkill.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });
    res.json({ skills: skills.map(serializeSkill) });
  } catch (err) {
    next(err);
  }
});

/** POST /skills {name, description, body} — create a skill from scratch. */
skillsRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(63),
        description: z.string().trim().min(3).max(1_000),
        body: z.string().trim().min(3).max(MAX_SKILL_CHARS),
      })
      .safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, "name, description and body are required");
    }
    assertUsableName(body.data.name);

    const content = `---\nname: ${body.data.name}\ndescription: ${JSON.stringify(body.data.description)}\n---\n\n${body.data.body}\n`;
    try {
      const skill = await prisma.userSkill.create({
        data: {
          userId,
          name: body.data.name,
          description: body.data.description,
          content,
        },
      });
      res.status(201).json({ skill: serializeSkill(skill) });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, `Skill "${body.data.name}" already exists`);
      }
      throw error;
    }
  } catch (err) {
    next(err);
  }
});

/** POST /skills/import {url} — fetch a SKILL.md from an online source. */
skillsRouter.post("/import", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const body = z
      .object({ url: z.string().trim().min(1).max(2_000) })
      .safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, "url is required");

    const url = assertPublicHttpUrl(body.data.url);
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Kairo" },
    }).catch((error: unknown) => {
      throw new AppError(
        400,
        `Could not fetch the URL: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!response.ok) {
      throw new AppError(400, `URL responded with HTTP ${response.status}`);
    }
    // A redirect may have moved the request somewhere we forbid.
    assertPublicHttpUrl(response.url);

    const text = await response.text();
    if (text.length > MAX_SKILL_CHARS) {
      throw new AppError(413, "That file is too large to be a skill");
    }

    const frontMatter = parseFrontMatter(text);
    if (frontMatter.name === null || frontMatter.description === null) {
      throw new AppError(
        422,
        "Not a SKILL.md — the file must start with YAML front-matter containing name: and description:",
      );
    }

    const name = slugify(frontMatter.name);
    if (name === "") throw new AppError(422, "The skill name is empty");
    assertUsableName(name);

    try {
      const skill = await prisma.userSkill.create({
        data: {
          userId,
          name,
          description: frontMatter.description,
          content: text,
          sourceUrl: url.toString(),
        },
      });
      res.status(201).json({ skill: serializeSkill(skill) });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          409,
          `Skill "${name}" already exists — delete it first to re-import`,
        );
      }
      throw error;
    }
  } catch (err) {
    next(err);
  }
});

/** DELETE /skills/:id */
skillsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const id = idParam(req, "id");
    const { count } = await prisma.userSkill.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new AppError(404, "Skill not found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
