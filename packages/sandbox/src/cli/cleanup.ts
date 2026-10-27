import { DockerWorkspace } from "../sandbox.js";
import type { DockerClient } from "@docker/node-sdk";

const instance = new DockerWorkspace("kill-probe") as DockerWorkspace & {
  ["containerName"]: string;
  deps(): Promise<{ client: DockerClient }>;
};
const { client: docker } = await instance.deps();

const captured = async (argv: string[]): Promise<string> => {
  const e = await docker.containerExec(instance.containerName, {
    Cmd: argv,
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: "1000:1000",
  });
  const chunks: string[] = [];
  const w = new (await import("node:stream")).Writable({
    write(c, _enc, cb) { chunks.push(c.toString()); cb(); },
  });
  await docker.execStart(e.Id ?? "", w, w);
  return chunks.join("");
};

// Sweep every leftover sleep (the agent image's pid 1 also runs sleep — keep it).
console.log(
  "cleanup:",
  (await captured(["bash", "-c", `for d in /proc/[0-9]*; do pid=$(basename $d); c=$(cat $d/comm); if [ "$c" = "sleep" ] && [ "$pid" != "1" ]; then kill -9 $pid 2>/dev/null; fi; done; echo swept`])).trim(),
);
