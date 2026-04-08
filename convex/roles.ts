import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";

const roleEnum = v.union(
  v.literal("AD"),
  v.literal("NBD"),
  v.literal("AI-BOSS"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("BUH"),
  v.literal("HOD"),
  v.literal("ADMIN"),
);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      return null;
    }
    const record = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    return {
      email,
      roles: record?.active ? record.roles : [],
      fullName: record?.fullName ?? null,
      creatorTitle: record?.creatorTitle ?? null,
      hodDepartments: record?.hodDepartments ?? [],
    };
  },
});

export const myRoles = query({
  args: {},
  handler: async (ctx) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      return [] as string[];
    }
    const record = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!record || !record.active) {
      return [] as string[];
    }
    return record.roles;
  },
});

export const listRoles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const anyRoles = await ctx.db.query("roles").first();
    if (!anyRoles) {
      return [];
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing email");
    }
    const record = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const canManage = record?.roles?.some((role) =>
      ["ADMIN", "NBD", "AI-BOSS", "COO", "CFD"].includes(role),
    );
    if (!canManage) {
      return [];
    }
    return await ctx.db.query("roles").collect();
  },
});

export const listAdContacts = query({
  args: {},
  handler: async (ctx) => {
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
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const canView = record?.roles?.some((role) =>
      ["ADMIN", "NBD", "AI-BOSS", "COO", "CFD"].includes(role),
    );
    if (!canView) {
      return [];
    }
    const roles = await ctx.db.query("roles").collect();
    return roles
      .filter((role) => role.active)
      .map((role) => ({
        email: role.email,
        fullName: role.fullName ?? null,
        creatorTitle: role.creatorTitle ?? null,
      }));
  },
});

export const upsertRole = mutation({
  args: {
    email: v.string(),
    roles: v.array(roleEnum),
    active: v.boolean(),
    isTest: v.boolean(),
    fullName: v.optional(v.string()),
    creatorTitle: v.optional(v.string()),
    hodDepartments: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing email");
    }
    const anyRoles = await ctx.db.query("roles").first();
    const selfRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const canManage = selfRecord?.roles?.some((role) =>
      ["ADMIN", "NBD", "AI-BOSS", "COO", "CFD"].includes(role),
    );
    const normalizedEmail = normalizeEmail(args.email);
    if (anyRoles && !canManage) {
      const allRoles = await ctx.db.query("roles").collect();
      const hasNonTestAdmin = allRoles.some(
        (role) => role.active && !role.isTest && role.roles.includes("ADMIN"),
      );
      const canBootstrap =
        !hasNonTestAdmin &&
        normalizedEmail === email &&
        args.roles.includes("ADMIN");
      if (!canBootstrap) {
        throw new Error("Not authorized");
      }
    }

    const existing = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        roles: args.roles,
        active: args.active,
        isTest: args.isTest,
        fullName: args.fullName?.trim() || undefined,
        creatorTitle: args.creatorTitle?.trim() || undefined,
        hodDepartments: args.hodDepartments?.length ? args.hodDepartments : undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("roles", {
      email: normalizedEmail,
      roles: args.roles,
      active: args.active,
      isTest: args.isTest,
      fullName: args.fullName?.trim() || undefined,
      creatorTitle: args.creatorTitle?.trim() || undefined,
      hodDepartments: args.hodDepartments?.length ? args.hodDepartments : undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteRole = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing email");
    }
    const selfRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const canManage = selfRecord?.roles?.some((role) =>
      ["ADMIN", "NBD", "AI-BOSS", "COO", "CFD"].includes(role),
    );
    if (!canManage) {
      throw new Error("Not authorized");
    }

    const normalizedEmail = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const archiveRole = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing email");
    }
    const selfRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!selfRecord?.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }

    const normalizedEmail = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    if (!existing) {
      throw new Error("Пользователь не найден");
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      active: false,
      updatedAt: now,
    });

    const requests = await ctx.db
      .query("requests")
      .withIndex("by_createdByEmail", (q) => q.eq("createdByEmail", normalizedEmail))
      .collect();
    const transferable = requests.filter((request) => request.status !== "closed");
    for (const request of transferable) {
      await ctx.db.patch(request._id, {
        originalCreatedBy: request.originalCreatedBy ?? request.createdBy,
        originalCreatedByEmail: request.originalCreatedByEmail ?? request.createdByEmail,
        originalCreatedByName: request.originalCreatedByName ?? request.createdByName,
        archivedAuthorTransferredAt: now,
        createdBy: userId,
        createdByEmail: email,
        createdByName: selfRecord.fullName ?? "Администратор",
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "author_archived_transfer",
        title: "Заявка передана администратору",
        description: `Исходный автор архивирован: ${existing.fullName ?? normalizedEmail}`,
        actorEmail: email,
        actorName: selfRecord.fullName ?? undefined,
        metadata: {
          originalAuthorEmail: request.originalCreatedByEmail ?? request.createdByEmail,
        },
      });
    }

    return { archived: true, transferred: transferable.length };
  },
});

export const seedTestRoles = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const existing = await ctx.db.query("roles").collect();
    if (existing.length > 0) {
      return { inserted: 0 };
    }
    const now = Date.now();
    const emails = [
      { email: "ad.test@quota.local", roles: ["AD"] as const, isTest: true },
      { email: "nbd.test@quota.local", roles: ["NBD"] as const, isTest: true },
      { email: "ai-boss.test@quota.local", roles: ["AI-BOSS"] as const, isTest: true },
      { email: "coo.test@quota.local", roles: ["COO"] as const, isTest: true },
      { email: "cfd.test@quota.local", roles: ["CFD"] as const, isTest: true },
      { email: "admin.test@quota.local", roles: ["ADMIN"] as const, isTest: true },
      { email: "buh.test@quota.local", roles: ["BUH"] as const, isTest: true },
      { email: "hod.mobile.test@quota.local", roles: ["HOD"] as const, isTest: true },
    ];
    for (const entry of emails) {
      await ctx.db.insert("roles", {
        email: entry.email,
        roles: [...entry.roles],
        active: true,
        isTest: entry.isTest,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { inserted: emails.length };
  },
});

export const updateMyProfile = mutation({
  args: {
    fullName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const isAdmin = record?.roles?.includes("ADMIN") ?? false;
    const now = Date.now();
    const nextEmail = args.email ? normalizeEmail(args.email) : email;
    if (nextEmail !== email && !isAdmin) {
      throw new Error("Only admin can change email");
    }
    if (nextEmail !== email) {
      const existing = await ctx.db
        .query("roles")
        .withIndex("by_email", (q) => q.eq("email", nextEmail))
        .first();
      if (existing && existing._id !== record?._id) {
        throw new Error("Email already exists");
      }
    }

    if (record) {
      await ctx.db.patch(record._id, {
        email: nextEmail,
        fullName: args.fullName?.trim() || undefined,
        updatedAt: now,
      });
      return { email: nextEmail };
    }
    await ctx.db.insert("roles", {
      email: nextEmail,
      roles: [],
      active: true,
      isTest: false,
      fullName: args.fullName?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { email: nextEmail };
  },
});
