import { Writable } from "node:stream";
import { DockerWorkspace } from "../sandbox.js";
import type { DockerClient } from "@docker/node-sdk";

const instance = new DockerWorkspace("marker-check") as DockerWorkspace & {
  ["containerName"]: string;
  deps(): Promise<{ client: DockerClient }>;
};
await instance.ensureRunning();
const { client: docker } = await instance.deps();

const exec = await docker.containerExec(instance.containerName, {
  Cmd: ["bash", "-c", "echo MARKER_IS=$KAIRO_EXEC_ID"],
  AttachStdin: false,
  AttachStdout: true,
  AttachStderr: true,
  Tty: false,
  User: "1000:1000",
  Env: ["HOME=/home/node", "KAIRO_EXEC_ID=marker-test-123"],
});
const chunks: string[] = [];
const w = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
await docker.execStart(exec.Id ?? "", w, w);
console.log("out:", chunks.join("").trim());
