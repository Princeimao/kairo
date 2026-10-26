import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/client";

function createPrisma() {
  const connectionString =
    "postgresql://kairo:kairo_dev_secret@localhost:5432/kairo?schema=public";
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = createPrisma();
export { PrismaClient } from "./generated/client/client";
export * from "./generated/client/enums";
export * as Prisma from "./generated/client/internal/prismaNamespace";
export type {
  User,
  Session,
  GithubConnection,
  AgentRun,
  AgentStep,
} from "./generated/client/client";
