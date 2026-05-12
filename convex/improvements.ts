import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentEmail } from "./authHelpers";
import { getRoleRecord } from "./requestAccessHelpers";

const suggestionStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("validation"),
  v.literal("done"),
);

export const create = mutation({
  args: {
    subject: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const subject = args.subject.trim();
    const description = args.description.trim();
    if (!subject) {
      throw new Error("Укажите тему");
    }
    if (!description) {
      throw new Error("Опишите улучшение");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const now = Date.now();
    return await ctx.db.insert("improvementSuggestions", {
      authorEmail: email,
      authorName: roleRecord?.fullName ?? undefined,
      authorRoles: roleRecord?.roles ?? [],
      authorDepartment: roleRecord?.department ?? undefined,
      subject,
      description,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isAdmin = roleRecord?.roles?.includes("ADMIN");
    const items = await ctx.db.query("improvementSuggestions").collect();
    const visibleItems = isAdmin
      ? items
      : items.filter((item) => item.authorEmail === email);
    return visibleItems.sort((left, right) => right.createdAt - left.createdAt);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("improvementSuggestions"),
    status: suggestionStatus,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    if (!roleRecord?.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});
