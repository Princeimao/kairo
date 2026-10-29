import { app } from "./app.js";
import { env } from "./config/env.js";
import { startLlmProxy } from "./llm/proxy.js";
import { startScheduler } from "./lib/scheduler.js";

app.listen(env.PORT, () => {
  console.log(
    `[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});

startLlmProxy();
startScheduler();
