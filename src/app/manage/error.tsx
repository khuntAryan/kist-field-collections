"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** Shown inside the manager layout when a page fails to load, most often a brief database hiccup. */
export default function ManageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <div className="mt-6 rounded-[var(--radius-control)] border border-rule bg-surface">
      <EmptyState
        title="This page could not load"
        body={`The server or database had a problem, often for only a few seconds. Try again; if it keeps happening, check /api/health.${digest ? ` Reference ${digest}.` : ""}`}
        action={
          <Button icon={<RotateCw size={18} />} onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
