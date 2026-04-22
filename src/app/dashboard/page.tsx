"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";

export default function DashboardPage() {
  const { signOut } = useAuthActions();
  const getOrCreateToken = useMutation(api.extensionToken.getOrCreate);
  const approveUser = useMutation(api.waitlist.approveUser);
  const pending = useQuery(api.waitlist.listPending);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  async function handleGetToken() {
    const t = await getOrCreateToken();
    setToken(t);
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleApprove(email: string) {
    setApproving(email);
    try {
      await approveUser({ email });
    } finally {
      setApproving(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">🔗 linkdm</h1>
          <button
            onClick={() => signOut()}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Waitlist approvals */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Waitlist</h2>
          <p className="text-xs text-gray-500 mb-4">
            Approve users to send them a magic link email automatically.
          </p>
          {pending === undefined ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-gray-400">No pending requests.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {pending.map((entry) => (
                <li key={entry._id} className="flex items-center justify-between py-3">
                  <span className="text-sm text-gray-800">{entry.email}</span>
                  <button
                    onClick={() => handleApprove(entry.email)}
                    disabled={approving === entry.email}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {approving === entry.email ? "Approving..." : "Approve"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Extension token */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Extension Token</h2>
          <p className="text-xs text-gray-500 mb-4">
            Paste this into the linkdm Chrome extension popup to connect it to your account.
          </p>
          {token ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 break-all">
                {token}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleGetToken}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Show my token
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">Welcome to the beta! Campaigns coming soon.</p>
        </div>
      </div>
    </main>
  );
}
