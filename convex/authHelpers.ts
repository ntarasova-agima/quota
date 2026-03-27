import { getAuthUserId } from "@convex-dev/auth/server";

export async function getCurrentEmail(ctx: { auth: { getUserIdentity: () => Promise<any> }; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.email) {
    return identity.email.toLowerCase();
  }
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return null;
  }
  const user = await ctx.db.get(userId);
  if (user?.email) {
    return user.email.toLowerCase();
  }
  const account = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q: any) => q.eq("userId", userId).eq("provider", "email"))
    .first();
  if (account?.providerAccountId && account.providerAccountId.includes("@")) {
    return account.providerAccountId.toLowerCase();
  }
  const anyAccount = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q: any) => q.eq("userId", userId))
    .first();
  if (anyAccount?.providerAccountId && anyAccount.providerAccountId.includes("@")) {
    return anyAccount.providerAccountId.toLowerCase();
  }
  return null;
}
