import { Queue } from "bullmq";
import {
  RUN_QUEUE_NAME,
  createRedis,
  type RunJobData,
} from "@kairo/run-queue";

let queue: Queue<RunJobData> | undefined;

/** Producer used by the HTTP layer. Lazily created per process. */
export function getRunQueue(): Queue<RunJobData> {
  if (queue === undefined) {
    queue = new Queue<RunJobData>(RUN_QUEUE_NAME, {
      connection: createRedis(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
  return queue;
}

export async function enqueueRun(data: RunJobData): Promise<void> {
  await getRunQueue().add("run", data, { jobId: data.runId });
}
