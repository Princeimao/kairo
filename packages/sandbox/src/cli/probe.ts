import { DockerWorkspace } from "../sandbox.js";

const workspace = new DockerWorkspace("probe-user");
const status = await workspace.status();
console.log("status:", JSON.stringify(status));
