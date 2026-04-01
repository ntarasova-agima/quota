import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";

const roleEnum = v.union(
  v.literal("AD"),
  v.literal("NBD"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("BUH"),
  v.literal("HOD"),
  v.literal("ADMIN"),
);

const decisionEnum = v.union(v.literal("approved"), v.literal("rejected"));

export const listPendingForMe = query({
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
    const roleRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!roleRecord || !roleRecord.active) {
      return [];
    }
    const roles = roleRecord.roles.filter((role) => role !== "AD");
    if (roles.length === 0) {
      return [];
    }

    const approvals: any[] = [];
    for (const role of roles) {
      const items = await ctx.db
        .query("approvals")
        .withIndex("by_role", (q) => q.eq("role", role))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect();
      approvals.push(...items);
    }

    const seen = new Set<string>();
    const results: Array<{ approval: any; request: any; kind: "approval" | "payment" | "hod" }> = [];
    for (const approval of approvals) {
      if (seen.has(approval.requestId)) {
        continue;
      }
      seen.add(approval.requestId);
      const request = await ctx.db.get(approval.requestId);
      if (!request) {
        continue;
      }
      results.push({ approval, request, kind: "approval" });
    }

    if (roles.includes("BUH")) {
      const paymentRequests = await ctx.db.query("requests").collect();
      for (const request of paymentRequests) {
        if (
          seen.has(request._id) ||
          request.isCanceled ||
          !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
        ) {
          continue;
        }
        seen.add(request._id);
        results.push({
          request,
          approval: {
            requestId: request._id,
            role: "BUH",
            status: "pending",
          },
          kind: "payment",
        });
      }
    }

    if (roles.includes("HOD")) {
      const departments = roleRecord.hodDepartments ?? [];
      const hodRequests = await ctx.db.query("requests").collect();
      for (const request of hodRequests) {
        if (seen.has(request._id) || request.isCanceled || request.status !== "hod_pending") {
          continue;
        }
        const specialists = request.specialists ?? [];
        const hasPendingForDepartment = specialists.some(
          (item: any) =>
            item.department &&
            departments.includes(item.department) &&
            (!item.hodConfirmed || item.directCost === undefined),
        );
        if (!hasPendingForDepartment) {
          continue;
        }
        seen.add(request._id);
        results.push({
          request,
          approval: {
            requestId: request._id,
            role: "HOD",
            status: "pending",
          },
          kind: "hod",
        });
      }
    }

    results.sort((a, b) => b.request.updatedAt - a.request.updatedAt);
    return results;
  },
});

export const hasReviewedAny = query({
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
    const items = await ctx.db
      .query("approvals")
      .filter((q) => q.eq(q.field("reviewerEmail"), email))
      .take(1);
    return items.length > 0;
  },
});

export const decide = mutation({
  args: {
    requestId: v.id("requests"),
    role: roleEnum,
    decision: decisionEnum,
    comment: v.optional(v.string()),
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
    const roleRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!roleRecord || !roleRecord.active || !roleRecord.roles.includes(args.role)) {
      throw new Error("Not authorized for this role");
    }

    if (args.decision === "rejected" && (!args.comment || args.comment.trim().length === 0)) {
      throw new Error("Comment required for rejection");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.status === "draft") {
      throw new Error("Cannot decide on a draft request");
    }
    if (!request.requiredRoles.includes(args.role)) {
      throw new Error("Role not required for this request");
    }

    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .filter((q) => q.eq(q.field("role"), args.role))
      .first();
    if (!approval) {
      throw new Error("Approval entry not found");
    }
    if (approval.status !== "pending") {
      throw new Error("Already decided");
    }

    await ctx.db.patch(approval._id, {
      status: args.decision,
      comment: args.comment?.trim() || undefined,
      decidedAt: Date.now(),
      reviewerId: userId,
      reviewerEmail: email,
    });

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();

    let status: "pending" | "approved" | "rejected" = "pending";
    if (approvals.some((item) => item.status === "rejected")) {
      status = "rejected";
    } else if (approvals.every((item) => item.status === "approved")) {
      status = "approved";
    }

    await ctx.db.patch(request._id, {
      status,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "approval_decision",
      title: args.decision === "approved" ? "Заявка согласована" : "Заявка отклонена",
      description: `${args.role}${args.comment?.trim() ? ` · ${args.comment.trim()}` : ""}`,
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
      metadata: {
        role: args.role,
        requestStatus: status,
      },
    });

    if (status === "approved" && ["Квота на пресейлы", "Квота на AI-подписки"].includes(request.fundingSource)) {
      if (!request.neededBy) {
        throw new Error("Missing neededBy for NBD quota");
      }
      const date = new Date(request.neededBy);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const tableName = request.fundingSource === "Квота на AI-подписки" ? "nbdServiceQuotas" : "presalesQuotas";
      const existing = await ctx.db
        .query(tableName)
        .withIndex("by_monthKey", (q: any) => q.eq("monthKey", key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          spent: existing.spent + request.amount,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert(tableName, {
          monthKey: key,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          quota: 0,
          spent: request.amount,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.scheduler.runAfter(0, internal.emails.sendDecision, {
      requestId: request._id,
      decision: args.decision,
      role: args.role,
      comment: args.comment?.trim() || undefined,
      reviewerName: roleRecord.fullName ?? undefined,
      reviewerEmail: email,
      requestStatus: status,
    });

    return { status };
  },
});

export const remindApproval = mutation({
  args: {
    requestId: v.id("requests"),
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
    const roleRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!roleRecord?.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.status !== "pending") {
      throw new Error("Напоминание можно отправить только по заявке на согласовании");
    }
    await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
      requestId: args.requestId,
    });
    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "admin_reminder_sent",
      title: "Админ напомнил о согласовании",
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
    });
    return { reminded: true };
  },
});

export const adminApproveAsRole = mutation({
  args: {
    requestId: v.id("requests"),
    role: roleEnum,
    comment: v.optional(v.string()),
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
    const roleRecord = await ctx.db
      .query("roles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!roleRecord?.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    if (!request.requiredRoles.includes(args.role)) {
      throw new Error("Role not required for this request");
    }
    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .filter((q) => q.eq(q.field("role"), args.role))
      .first();
    if (!approval) {
      throw new Error("Approval entry not found");
    }
    if (approval.status !== "pending") {
      throw new Error("Already decided");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "approved",
      comment: args.comment?.trim() || undefined,
      decidedAt: now,
      reviewerId: userId,
      reviewerEmail: email,
    });

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();

    let status: "pending" | "approved" | "rejected" = "pending";
    if (approvals.some((item) => item.status === "rejected")) {
      status = "rejected";
    } else if (approvals.every((item) => item.status === "approved")) {
      status = "approved";
    }

    await ctx.db.patch(request._id, {
      status,
      updatedAt: now,
    });

    if (status === "approved" && ["Квота на пресейлы", "Квота на AI-подписки"].includes(request.fundingSource)) {
      if (!request.neededBy) {
        throw new Error("Missing neededBy for NBD quota");
      }
      const date = new Date(request.neededBy);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const tableName = request.fundingSource === "Квота на AI-подписки" ? "nbdServiceQuotas" : "presalesQuotas";
      const existing = await ctx.db
        .query(tableName)
        .withIndex("by_monthKey", (q: any) => q.eq("monthKey", key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          spent: existing.spent + request.amount,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert(tableName, {
          monthKey: key,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          quota: 0,
          spent: request.amount,
          updatedAt: Date.now(),
        });
      }
    }

    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "admin_approval_override",
      title: `Админ согласовал как ${args.role}`,
      description: args.comment?.trim() || undefined,
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
      metadata: { role: args.role },
    });

    await ctx.scheduler.runAfter(0, internal.emails.sendDecision, {
      requestId: request._id,
      decision: "approved",
      role: args.role,
      comment: args.comment?.trim() || undefined,
      reviewerName: roleRecord.fullName
        ? `${roleRecord.fullName} (админ)`
        : "Администратор",
      reviewerEmail: email,
      requestStatus: status,
    });
    return { status };
  },
});
