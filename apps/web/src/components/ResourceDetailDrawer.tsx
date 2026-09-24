"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { StateBadge } from "./ui";

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}

export function ResourceDetailDrawer({
  resourceId,
  onClose,
  onNavigate,
}: {
  resourceId: string | null;
  onClose: () => void;
  onNavigate?: (id: string) => void;
}): ReactNode {
  const enabled = Boolean(resourceId);
  const { data: resource } = useQuery({
    queryKey: ["resource", resourceId],
    queryFn: () => api.resource(resourceId!),
    enabled,
  });
  const { data: rels } = useQuery({
    queryKey: ["resource-rels", resourceId],
    queryFn: () => api.resourceRelationships(resourceId!),
    enabled,
  });

  if (!resourceId) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-auto border-l border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {resource?.service} · {resource?.type}
            </div>
            <h2 className="text-lg font-semibold break-all">
              {resource?.name ?? resource?.externalId ?? "…"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!resource ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="space-y-4">
            <section>
              <Row label="Resource ID" value={resource.externalId} />
              <Row label="Region" value={resource.region} />
              <Row
                label="State"
                value={<StateBadge state={resource.state} />}
              />
              {resource.environment && (
                <Row label="Environment" value={resource.environment} />
              )}
              {resource.arn && <Row label="ARN" value={resource.arn} />}
            </section>

            {Object.keys(resource.metadata).length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Metadata
                </h3>
                {Object.entries(resource.metadata)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => (
                    <Row
                      key={k}
                      label={k}
                      value={
                        typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)
                      }
                    />
                  ))}
              </section>
            )}

            {Object.keys(resource.tags).length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Tags
                </h3>
                {Object.entries(resource.tags).map(([k, v]) => (
                  <Row key={k} label={k} value={v} />
                ))}
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Relationships
              </h3>
              {!rels ||
              (rels.outgoing.length === 0 && rels.incoming.length === 0) ? (
                <p className="text-sm text-neutral-500">None discovered.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {rels.outgoing.map((o, i) => (
                    <li key={`o-${i}`}>
                      <span className="text-neutral-500">{o.type} → </span>
                      <button
                        className="font-medium underline-offset-2 hover:underline"
                        onClick={() => onNavigate?.(o.target.id)}
                      >
                        {o.target.name ?? o.target.service} ({o.target.type})
                      </button>
                    </li>
                  ))}
                  {rels.incoming.map((inc, i) => (
                    <li key={`i-${i}`}>
                      <button
                        className="font-medium underline-offset-2 hover:underline"
                        onClick={() => onNavigate?.(inc.source.id)}
                      >
                        {inc.source.name ?? inc.source.service} (
                        {inc.source.type})
                      </button>
                      <span className="text-neutral-500"> → {inc.type}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
