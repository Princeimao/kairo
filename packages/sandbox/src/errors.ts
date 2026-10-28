/** Error type shared by sandbox ops (moved out of the deleted @kairo/agent). */
export class WorkspaceError extends Error {
  readonly code: string;

  constructor(message: string, code = "WORKSPACE_ERROR") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
