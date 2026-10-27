import { DockerWorkspace } from "../sandbox.js";

const instance = new DockerWorkspace("timeout-check");
const t0 = Date.now();
const result = await instance.exec(["bash", "-c", "sleep 30"], { timeoutMs: 1_500 });
const elapsed = Date.now() - t0;
console.log(`elapsed=${elapsed}ms result=${JSON.stringify(result)}`);
const t1 = Date.now();
const alive = await instance.exec(["bash", "-c", "echo alive"], { timeoutMs: 5_000 });
console.log(`postcheck=${Date.now() - t1}ms exit=${alive.exitCode} out=${alive.stdout.trim()}`);
