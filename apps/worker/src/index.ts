import { Worker } from "bullmq";
import { RUN_QUEUE_NAME, createRedis, type RunJobData } from "@kairo/run-queue";
import { env } from "./env.js";
import { processRun } from "./processor.js";

const connection = createRedis(env.REDIS_URL);

export const runWorker = new Worker<RunJobData>(
  RUN_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] job ${job.id} start`);
    await processRun(job.data);
    console.log(`[worker] job ${job.id} done`);
  },
  { connection, concurrency: 4 },
);

runWorker.on("failed", (job, error) => {
  console.error(`[worker] job ${job?.id ?? "?"} failed: ${error.message}`);
});
runWorker.on("error", (error) => {
  console.error(`[worker] error: ${error.message}`);
});

console.log(
  `[worker] listening on queue "${RUN_QUEUE_NAME}" (${env.REDIS_URL})`,
);
