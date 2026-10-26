/*
 * Live sandbox checks (requires Docker Desktop + kairo-sandbox image):
 *   npm run sandbox:check -w @kairo/sandbox
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DockerWorkspace } from "../sandbox.js";
import { WorkspaceError } from "@kairo/agent";

const results: Array<{ name: string; ok: boolean; note?: string }> = [];

function record(name: string, ok: boolean, note?: string): void {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}`);
}

const userId = "check-sandbox-run";
const ws = new DockerWorkspace(userId);

async function main(): Promise<void> {
  const t0 = Date.now();
  const boot = await ws.ensureRunning();
  record(
    "ensureRunning boot",
    boot.containerName.startsWith("kairo-sbx-") && boot.volumeName.startsWith("kairo-ws-"),
    `${boot.containerName} (reused=${boot.reused}, ${Date.now() - t0}ms)`,
  );

  const status = await ws.status();
  record("status running", status.running === true);

  // writeFile + readFile roundtrip
  const content = "hello sandbox\nline2\n";
  const write = await ws.writeFile("src/hello.txt", content);
  record("writeFile", write.bytes === Buffer.byteLength(content, "utf8"), `${write.bytes} bytes`);
  const read = await ws.readFile("src/hello.txt");
  record("readFile roundtrip", read.content === content, read.truncated ? "" : "exact match");

  // mkdir chaining: deep write
  await ws.writeFile("deep/nested/path/file.md", "# deep\n");
  const deep = await ws.readFile("deep/nested/path/file.md");
  record("writeFile deep dirs", deep.content === "# deep\n");

  // path traversal + absolute + symlink escape
  const rejects: Array<[string, string]> = [
    ["../escape.txt", "TRAVERSAL"],
    ["/etc/passwd", "ABSOLUTE_PATH"],
    ["a/../../b.txt", "TRAVERSAL"],
    ["C:/x.txt", "ABSOLUTE_PATH"],
  ];
  let allRejected = true;
  for (const [bad, expected] of rejects) {
    try {
      await ws.writeFile(bad, "x");
      allRejected = false;
      record(`reject ${bad}`, false);
    } catch (error) {
      const code = error instanceof WorkspaceError ? error.code : "OTHER";
      record(`reject ${bad}`, code === expected, `code=${code}`);
    }
  }
  record("all traversal rejects", allRejected);

  // missing file
  try {
    await ws.readFile("no/such-file.txt");
    record("readFile missing rejects", false);
  } catch (error) {
    record(
      "readFile missing rejects",
      error instanceof WorkspaceError && error.code === "NOT_FOUND",
    );
  }

  // exec
  const echo = await ws.exec(["echo", "argv-works", "%d"]);
  record("exec argv", echo.exitCode === 0 && echo.stdout.trim() === "argv-works %d");
  const shell = await ws.exec("echo shell-works && echo second");
  record("exec shell string", shell.exitCode === 0 && shell.stdout.includes("shell-works"));
  const failing = await ws.exec("exit 3");
  record("exec exit code", failing.exitCode === 3);
  const cwd = await ws.exec(["pwd"], { cwd: "src" });
  record("exec cwd", cwd.stdout.trim() === "/workspace/src", cwd.stdout.trim());

  // agent toolchain sanity inside the container
  const nodeV = await ws.exec(["node", "--version"]);
  const gitV = await ws.exec(["git", "--version"]);
  const rgV = await ws.exec(["rg", "--version"]);
  record(
    "toolchain node/git/rg",
    nodeV.exitCode === 0 && gitV.exitCode === 0 && rgV.exitCode === 0,
    `${nodeV.stdout.trim()} | ${gitV.stdout.trim()} | ${rgV.stdout.trim().split(" ")[1] ?? ""}`,
  );

  // timeout enforcement
  const t1 = Date.now();
  const slow = await ws.exec(["bash", "-c", "sleep 30"], { timeoutMs: 1_500 });
  const elapsed = Date.now() - t1;
  record("exec timeout kill", slow.timedOut && elapsed < 10_000, `${elapsed}ms, exit=${slow.exitCode}`);

  // listFiles
  const list = await ws.listFiles();
  const found = ["src/hello.txt", "deep/nested/path/file.md"].every((p) => list.paths.includes(p));
  record("listFiles includes written files", found, `${list.paths.length} entries`);

  // searchCode
  const search = await ws.searchCode({ query: "hello sandbox", isRegex: false });
  record(
    "searchCode fixed string",
    search.hits.some((hit) => hit.path === "src/hello.txt"),
    `${search.hits.length} hits`,
  );
  const regex = await ws.searchCode({ query: "^line\\d$", isRegex: true });
  record(
    "searchCode regex",
    regex.hits.some((hit) => hit.line === 2),
    `${regex.hits.length} hits`,
  );

  // persistence across stop → start
  await ws.stop();
  const again = await ws.ensureRunning();
  const persisted = await ws.readFile("src/hello.txt");
  record(
    "volume persists across stop/start",
    again.reused === true && persisted.content === content,
  );

  mkdirSync("results", { recursive: true });
  writeFileSync(
    join("results", "sandbox-check.log"),
    JSON.stringify(results, null, 2),
  );

  const failed = results.filter((result) => !result.ok);
  console.log(failed.length === 0 ? `\n${results.length}/${results.length} PASS` : `\n${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`sandbox check crashed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(2);
});
