"use client";

import { Suspense } from "react";
import { AgentConsole } from "@/components/agent-console";

export default function AgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentConsole conversationId={null} />
    </Suspense>
  );
}
