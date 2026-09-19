"use client";

import { use } from "react";
import ConnectPanel from "./connect-panel";

export default function ConnectRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ConnectPanel conversationId={id} />;
}
