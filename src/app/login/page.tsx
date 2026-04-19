"use client";

import { useState, useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useRouter } from "next/navigation";

type Status = "idle" | "checking" | "sending" | "not-approved";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const convex = useConvex();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");

    const isApproved = await convex.query(api.waitlist.checkApproval, { email });

    if (!isApproved) {
      setStatus("not-approved");
      return;
    }

    setStatus("sending");
    await signIn("resend", { email, redirectTo: "/dashboard" });
    router.push("/check-email");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Log in to linkdm</h1>
        <p className="text-gray-500 mb-6 text-sm">We'll send you a magic link — no password needed.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {status === "not-approved" && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              We're rolling out to beta users slowly — you'll hear from us as soon as you're in!
            </p>
          )}
          <button
            type="submit"
            disabled={status === "checking" || status === "sending"}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {status === "checking" ? "Checking..." : status === "sending" ? "Sending link..." : "Send magic link"}
          </button>
        </form>
        <p className="text-center text-sm text-gray-400 mt-4">
          Not on the list yet?{" "}
          <a href="/waitlist" className="text-blue-600 hover:underline">Request access</a>
        </p>
      </div>
    </main>
  );
}
