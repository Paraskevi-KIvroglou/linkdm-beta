"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityPage() {
  const logs = useQuery(api.dmLog.listRecentByUser);

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
          {logs !== undefined && (
            <span className="text-xs text-green-600 font-medium">● Live</span>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {logs === undefined ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-500">No DMs sent yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Activity will appear here as your campaigns run.
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div key={log._id} className="flex items-center gap-4 px-5 py-4">
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${
                    log.status === "sent"
                      ? "bg-green-500"
                      : log.status === "failed"
                      ? "bg-red-400"
                      : "bg-gray-300"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <a
                    href={log.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-gray-900 hover:text-blue-600"
                  >
                    {log.profileName}
                  </a>
                  {log.status === "failed" && log.errorMessage && (
                    <p className="text-xs text-red-500 mt-0.5">{log.errorMessage}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`text-xs font-medium ${
                      log.status === "sent"
                        ? "text-green-600"
                        : log.status === "failed"
                        ? "text-red-500"
                        : "text-gray-400"
                    }`}
                  >
                    {log.status}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{timeAgo(log.sentAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
