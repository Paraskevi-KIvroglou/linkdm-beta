"use client";

import { useAuthActions } from "@convex-dev/auth/react";

export default function DashboardPage() {
  const { signOut } = useAuthActions();

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
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">Welcome to the beta! Campaigns coming soon.</p>
        </div>
      </div>
    </main>
  );
}
