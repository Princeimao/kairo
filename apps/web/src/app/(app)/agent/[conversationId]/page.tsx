"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AgentConsole } from "@/components/agent-console";

export default function AgentConversationPage() {
  const params = useParams<{ conversationId: string }>();
  return (
    <Suspense fallback={null}>
      <AgentConsole key={params.conversationId} conversationId={params.conversationId} />
    </Suspense>
  );
}
