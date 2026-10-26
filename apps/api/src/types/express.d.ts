import type { Session, User } from "@kairo/db";

declare module "express-serve-static-core" {
  interface Request {
    /** Populated by the `requireAuth` middleware. */
    auth?: {
      session: Session;
      user: User;
    };
  }
}
