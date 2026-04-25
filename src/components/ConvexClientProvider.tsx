"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";

// Placeholder lets prerender succeed when the env var isn't set at build time.
// Real queries will fail to connect with this URL, which is intentional —
// missing env should be loud at runtime, not crash the whole build.
const PLACEHOLDER_CONVEX_URL = "https://placeholder.convex.cloud";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(
    () =>
      new ConvexReactClient(
        process.env.NEXT_PUBLIC_CONVEX_URL ?? PLACEHOLDER_CONVEX_URL
      )
  );
  return (
    <ConvexAuthProvider client={convex}>
      {children}
    </ConvexAuthProvider>
  );
}
