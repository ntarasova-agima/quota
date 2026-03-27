import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { sumQuotaUsageByMonth } from "./quotaUsage";

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthInfoFromKey(key: string) {
  const [yearStr, monthStr] = key.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

async function ensureRole(ctx: any, role: "NBD" | "CFD" | "COO") {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    if (process.env.ALLOW_DEV_QUOTA_DELETE === "true") {
      return { email: "dev" };
    }
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing email");
  }
  const record = await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
  const hasRole = record?.roles?.includes(role);
  if (!hasRole) {
    throw new Error("Not authorized");
  }
  return { email };
}

async function ensureNbd(ctx: any) {
  return await ensureRole(ctx, "NBD");
}

async function ensureCfd(ctx: any) {
  return await ensureRole(ctx, "CFD");
}

async function ensureCoo(ctx: any) {
  return await ensureRole(ctx, "COO");
}

export const listByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const items = await ctx.db.query("presalesQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на пресейлы",
    );
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = spentByMonth.get(key) ?? 0;
      results.push(
        existing
          ? { ...existing, spent }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              spent,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на пресейлы",
    ).get(args.monthKey) ?? 0;

    const existing = await ctx.db
      .query("presalesQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        spent,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("presalesQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      spent,
      updatedAt: Date.now(),
    });
  },
});

export const listCfdByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureCfd(ctx);
    const items = await ctx.db.query("cfdQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(requests, () => true);
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = spentByMonth.get(key) ?? 0;
      results.push(
        existing
          ? { ...existing, spent }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              adjustedQuota: 0,
              spent,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateCfdQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    adjustedQuota: v.number(),
  },
  handler: async (ctx, args) => {
    await ensureCfd(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent = sumQuotaUsageByMonth(requests, () => true).get(args.monthKey) ?? 0;

    const existing = await ctx.db
      .query("cfdQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        adjustedQuota: args.adjustedQuota,
        spent,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("cfdQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      adjustedQuota: args.adjustedQuota,
      spent,
      updatedAt: Date.now(),
    });
  },
});

export const listCooByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureCoo(ctx);
    const items = await ctx.db.query("cooQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на внутренние затраты",
    );
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = spentByMonth.get(key) ?? 0;
      results.push(
        existing
          ? { ...existing, spent }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              adjustedQuota: 0,
              spent,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateCooQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    adjustedQuota: v.number(),
  },
  handler: async (ctx, args) => {
    await ensureCoo(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на внутренние затраты",
    ).get(args.monthKey) ?? 0;
    const existing = await ctx.db
      .query("cooQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        adjustedQuota: args.adjustedQuota,
        spent,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("cooQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      adjustedQuota: args.adjustedQuota,
      spent,
      updatedAt: Date.now(),
    });
  },
});

export const deleteQuotasForYear = mutation({
  args: {
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const items = await ctx.db
      .query("presalesQuotas")
      .filter((q: any) => q.eq(q.field("year"), args.year))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    return { deleted: items.length };
  },
});

export const deleteQuotaByMonthKey = mutation({
  args: {
    monthKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const existing = await ctx.db
      .query("presalesQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});
