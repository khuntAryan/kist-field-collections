"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** Fallback for any page that fails to load (outside a more specific error page), e.g. a brief database outage. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[var(--radius-control)] border border-rule bg-surface">
        <EmptyState
          title="Kist could not load this page"
          body={`The server or database had a problem, often for only a few seconds. Try again in a moment.${digest ? ` Reference ${digest}.` : ""}`}
          action={
            <Button icon={<RotateCw size={18} />} onClick={() => retry()}>
              Try again
            </Button>
          }
        />
      </div>
    </main>
  );
}
