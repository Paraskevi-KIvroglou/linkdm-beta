import { convexAuth } from "@convex-dev/auth/server";
import Resend from "@auth/core/providers/resend";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: "linkdm <hello@paraskevikivroglou.com>",
    }),
  ],
  callbacks: {
    /**
     * Guarantee that the same email always maps to the same user record.
     *
     * @convex-dev/auth normally does this via the authAccounts lookup, but
     * if that lookup ever misses (e.g. the account row was missing, or there
     * is a subtle version-specific bug), a second user record would be created
     * and all existing campaigns / data would become invisible.
     *
     * This callback is the safety net: when existingUserId is null we check
     * the users table by email before ever inserting a new row.
     */
    async createOrUpdateUser(ctx, args) {
      // Fast path: the auth account was found — return the linked userId.
      if (args.existingUserId) {
        return args.existingUserId;
      }

      const email =
        typeof args.profile?.email === "string"
          ? args.profile.email
          : undefined;

      // If we have an email, look for an existing user before creating a new one.
      // Cast to any because the callback ctx uses a generic DB type that doesn't
      // expose the "email" index defined in authTables — but it IS there at runtime.
      if (email) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = ctx.db as any;
        const existing = await db
          .query("users")
          .withIndex("email", (q: any) => q.eq("email", email))
          .first();
        if (existing) return existing._id;
      }

      // Genuinely new user — insert a record.
      return await ctx.db.insert("users", {
        email,
        emailVerificationTime: args.profile?.emailVerified
          ? Date.now()
          : undefined,
      });
    },
  },
});
