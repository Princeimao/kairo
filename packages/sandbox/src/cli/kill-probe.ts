import { Writable } from "node:stream";
import { DockerWorkspace } from "../sandbox.js";
import type { DockerClient } from "@docker/node-sdk";

const instance = new DockerWorkspace("marker-check") as DockerWorkspace & {
  ["containerName"]: string;
  deps(): Promise<{ client: DockerClient }>;
  killTimedOutExec: (c: DockerClient, m: string, n: string) => Promise<void>;
};
await instance.ensureRunning();
const { client: docker } = await instance.deps();

const exec = await docker.containerExec(instance.containerName, {
  Cmd: ["bash", "-c", "sleep 300"],
  AttachStdin: false,
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
  User: "1000:1000",
  Env: ["HOME=/home/node", "KAIRO_EXEC_ID=kasx-detached-target"],
});
await docker.execStart(exec.Id ?? "", null, null, { Detach: true });
await new Promise((r) => setTimeout(r, 800));

// Replicate the sandbox killer with stdout captured to see why it misses.
const script = [
  'MARKER="kasx-detached-target"',
  'for d in /proc/[0-9]*; do',
  '  if [ -r "$d/environ" ]; then',
  '    if grep -aq "$MARKER" "$d/environ" 2>/dev/null; then',
  '      pid=$(basename "$d")',
  '      kill -9 -- "-$pid" 2>/dev/null',
  '      kill -9 "$pid" 2>/dev/null',
  '      echo killed pid=$pid rc=$?',
  '    fi',
  '  fi',
  'done',
  'echo scan_done',
].join("; ");
const killer = await docker.containerExec(instance.containerName, {
  Cmd: ["bash", "-c", script],
  AttachStdin: false,
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
  User: "1000:1000",
});
const chunks: string[] = [];
const w = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
await docker.execStart(killer.Id ?? "", w, w);
console.log("killer out:", chunks.join("").trim());
await new Promise((r) => setTimeout(r, 500));
const after = await docker.execInspect(exec.Id ?? "");
console.log("after:", JSON.stringify({ running: after.Running, exit: after.ExitCode }));
