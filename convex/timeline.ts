import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { logEmailEvent, logTimelineEvent } from "./timelineHelpers";

function hasHodAccessToRequest(roleRecord: any, request: any) {
  if (!roleRecord?.roles?.includes("HOD")) {
    return false;
  }
  const departments = roleRecord.hodDepartments ?? [];
  if (!departments.length) {
    return false;
  }
  const specialists = request.specialists ?? [];
  return specialists.some((item: any) => item.department && departments.includes(item.department));
}

async function hasHistoricalApprovalAccess(ctx: any, requestId: any, email: string) {
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_request", (q: any) => q.eq("requestId", requestId))
    .collect();
  return approvals.some((approval: any) => approval.reviewerEmail === email);
}

async function ensureCanViewRequest(ctx: any, requestId: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing user email");
  }
  const request = await ctx.db.get(requestId);
  if (!request) {
    throw new Error("Request not found");
  }
  const record = await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
  const canViewAll = record?.roles?.some((role: string) =>
    ["NBD", "COO", "CFD", "BUH", "ADMIN"].includes(role),
  );
  const canHodView = hasHodAccessToRequest(record, request);
  const canViewByHistory = await hasHistoricalApprovalAccess(ctx, requestId, email);
  if (
    !canViewAll &&
    !canHodView &&
    !canViewByHistory &&
    request.createdBy !== userId &&
    request.createdByEmail !== email
  ) {
    throw new Error("Not authorized");
  }
}

export const listByRequest = query({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    await ensureCanViewRequest(ctx, args.requestId);
    const [events, emails] = await Promise.all([
      ctx.db
        .query("requestTimelineEvents")
        .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
        .collect(),
      ctx.db
        .query("requestEmailLogs")
        .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
        .collect(),
    ]);
    const normalizedEvents = events.map((item: any) => ({
      kind: "event" as const,
      id: item._id,
      title: item.title,
      description: item.description,
      actorEmail: item.actorEmail,
      actorName: item.actorName,
      createdAt: item.createdAt,
      status: undefined,
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
    }));
    const normalizedEmails = emails.map((item: any) => ({
      kind: "email" as const,
      id: item._id,
      title: item.status === "sent" ? "Письмо отправлено" : "Ошибка отправки письма",
      description: `${item.emailType}: ${item.subject}`,
      actorEmail: undefined,
      actorName: undefined,
      createdAt: item.createdAt,
      status: item.status,
      metadata: {
        recipients: item.recipients,
        error: item.error,
      },
    }));
    return [...normalizedEvents, ...normalizedEmails].sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const recordTimelineEvent = internalMutation({
  args: {
    requestId: v.id("requests"),
    type: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
    metadata: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: args.type,
      title: args.title,
      description: args.description,
      actorEmail: args.actorEmail,
      actorName: args.actorName,
      metadata: args.metadata ? JSON.parse(args.metadata) : undefined,
      createdAt: args.createdAt,
    });
  },
});

export const recordEmailLog = internalMutation({
  args: {
    requestId: v.optional(v.id("requests")),
    emailType: v.string(),
    recipients: v.array(v.string()),
    subject: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await logEmailEvent(ctx, args);
  },
});
