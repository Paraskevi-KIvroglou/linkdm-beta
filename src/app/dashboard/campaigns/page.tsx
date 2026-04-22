"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState } from "react";
import Link from "next/link";

export default function CampaignsPage() {
  const campaigns = useQuery(api.campaigns.listByUser);
  const createCampaign = useMutation(api.campaigns.create);
  const updateStatus = useMutation(api.campaigns.updateStatus);

  const [showForm, setShowForm] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await createCampaign({
        postUrl: postUrl.trim(),
        messageTemplate: messageTemplate.trim(),
        keywordFilter: keywordFilter.trim() || undefined,
        dailyLimit: parseInt(dailyLimit, 10),
      });
      setPostUrl("");
      setMessageTemplate("");
      setKeywordFilter("");
      setDailyLimit("20");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(
    campaignId: Id<"campaigns">,
    current: "active" | "paused"
  ) {
    setToggling(campaignId);
    try {
      await updateStatus({
        campaignId,
        status: current === "active" ? "paused" : "active",
      });
    } finally {
      setToggling(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {showForm ? "Cancel" : "+ New campaign"}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">New Campaign</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  LinkedIn post URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                  required
                  placeholder="https://www.linkedin.com/feed/update/urn:li:activity:..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Message template <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  required
                  rows={3}
                  placeholder="Hey, I saw your comment on my post — would love to connect!"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Keyword filter <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={keywordFilter}
                    onChange={(e) => setKeywordFilter(e.target.value)}
                    placeholder="e.g. interested"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Only DM commenters whose comment contains this word</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Daily DM limit
                  </label>
                  <input
                    type="number"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    min="1"
                    max="80"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Max 20 recommended to stay safe</p>
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creating ? "Creating..." : "Create campaign"}
              </button>
            </form>
          </div>
        )}

        {/* Campaign list */}
        {campaigns === undefined ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-500 text-sm">No campaigns yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <div
                key={campaign._id}
                className="bg-white rounded-xl border border-gray-200 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          campaign.status === "active"
                            ? "bg-green-500"
                            : "bg-gray-300"
                        }`}
                      />
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {campaign.status}
                      </span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">
                        {campaign.todayCount}/{campaign.dailyLimit} DMs today
                      </span>
                    </div>
                    <a
                      href={campaign.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate block"
                    >
                      {campaign.postUrl}
                    </a>
                    <p className="text-sm text-gray-700 mt-1 line-clamp-2">
                      {campaign.messageTemplate}
                    </p>
                    {campaign.keywordFilter && (
                      <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">
                        keyword: {campaign.keywordFilter}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(campaign._id, campaign.status)}
                    disabled={toggling === campaign._id}
                    className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                      campaign.status === "active"
                        ? "bg-amber-100 hover:bg-amber-200 text-amber-700"
                        : "bg-green-100 hover:bg-green-200 text-green-700"
                    }`}
                  >
                    {toggling === campaign._id
                      ? "..."
                      : campaign.status === "active"
                      ? "Pause"
                      : "Resume"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
