"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useState, useEffect } from "react";
import Link from "next/link";

export default function CampaignsPage() {
  const campaigns = useQuery(api.campaigns.listByUser);
  const debug = useQuery(api.debug.whoAmI);
  const createCampaign = useMutation(api.campaigns.create);
  const updateStatus = useMutation(api.campaigns.updateStatus);
  const mergeDuplicates = useMutation(api.campaigns.mergeDuplicateAccounts);

  // On first render, merge any campaigns stored under duplicate user records
  // that were created by the auth bug (new userId per login).
  useEffect(() => {
    mergeDuplicates().catch(() => {/* silent — non-critical */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [postType, setPostType] = useState<"personal" | "company">("personal");
  const [replyTemplate, setReplyTemplate] = useState("");
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<{ campaignId: string; message: string } | null>(null);

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
        postType,
        replyTemplate: replyTemplate.trim() || undefined,
      });
      setPostUrl("");
      setMessageTemplate("");
      setKeywordFilter("");
      setDailyLimit("20");
      setShowForm(false);
      setPostType("personal");
      setReplyTemplate("");
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
    setToggleError(null);
    try {
      await updateStatus({
        campaignId,
        status: current === "active" ? "paused" : "active",
      });
    } catch (err) {
      setToggleError({
        campaignId,
        message: err instanceof Error ? err.message : "Failed to update campaign",
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
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  Post type
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPostType("personal")}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      postType === "personal"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    👤 Personal post
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostType("company")}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      postType === "company"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                  >
                    🏢 Company page
                  </button>
                </div>
              </div>
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black font-semibold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black font-semibold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Reply to comment <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={replyTemplate}
                  onChange={(e) => setReplyTemplate(e.target.value)}
                  rows={2}
                  placeholder="e.g. Thanks for engaging! I sent you a DM 📩"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black font-semibold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">If set, the extension will reply to the commenter's post after sending the DM</p>
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black font-semibold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-black font-semibold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      <span className="text-xs text-gray-400">
                        {campaign.postType === "company" ? "🏢 Company page" : "👤 Personal"}
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
                    {campaign.replyTemplate && (
                      <span className="inline-block mt-2 text-xs bg-blue-50 text-blue-600 rounded px-2 py-0.5">
                        💬 auto-reply
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <button
                      onClick={() => handleToggle(campaign._id, campaign.status)}
                      disabled={toggling === campaign._id}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
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
                    {toggleError?.campaignId === campaign._id && (
                      <p className="text-xs text-red-500">{toggleError.message}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Temporary debug panel — remove after diagnosis */}
      {debug !== undefined && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1e1e1e", color: "#d4d4d4", fontSize: 11, padding: "8px 12px", fontFamily: "monospace", maxHeight: 180, overflowY: "auto", zIndex: 9999 }}>
          <strong style={{ color: "#4ec9b0" }}>DEBUG</strong>{" "}
          userId: <span style={{ color: "#ce9178" }}>{debug.userId ?? "null"}</span>{" "}
          | email: <span style={{ color: "#ce9178" }}>{debug.user?.email ?? "none"}</span>{" "}
          | users with this email: <span style={{ color: "#9cdcfe" }}>{debug.allEmailUsers.length}</span>{" "}
          | campaigns found: <span style={{ color: "#9cdcfe" }}>{debug.allCampaigns.length}</span>
          {debug.allEmailUsers.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {debug.allEmailUsers.map((u) => (
                <div key={u._id}>user {u._id}: {debug.allCampaigns.filter(c => c.userId === u._id).length} campaign(s)</div>
              ))}
            </div>
          )}
          {debug.allCampaigns.map((c) => (
            <div key={c._id} style={{ color: "#6a9955" }}>campaign {c._id} → userId {c.userId} | {c.postUrl.slice(0, 60)}</div>
          ))}
        </div>
      )}
    </main>
  );
}
