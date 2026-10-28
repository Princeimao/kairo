import { app } from "./app.js";
import { env } from "./config/env.js";
import { startLlmProxy } from "./llm/proxy.js";

app.listen(env.PORT, () => {
  console.log(
    `[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});

startLlmProxy();
