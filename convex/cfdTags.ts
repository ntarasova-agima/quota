import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";

async function ensureCfdOrAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
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
  const canManage = record?.roles?.some((role: string) => ["CFD", "ADMIN", "BUH", "NBD"].includes(role));
  if (!canManage) {
    throw new Error("Not authorized");
  }
}

async function ensureCanViewTags(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
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
  const canView = record?.roles?.some((role: string) =>
    ["CFD", "ADMIN", "NBD", "COO", "BUH"].includes(role),
  );
  if (!canView) {
    throw new Error("Not authorized");
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ensureCanViewTags(ctx);
    const rows = await ctx.db.query("cfdTags").withIndex("by_name").collect();
    return rows.filter((row) => row.active);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureCfdOrAdmin(ctx);
    const name = args.name.trim();
    if (!name) {
      throw new Error("Название тега обязательно");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("cfdTags")
      .withIndex("by_name", (q: any) => q.eq("name", name))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("cfdTags", {
      name,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("cfdTags"),
  },
  handler: async (ctx, args) => {
    await ensureCfdOrAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.patch(args.id, {
      active: false,
      updatedAt: Date.now(),
    });
    return { deleted: true };
  },
});
