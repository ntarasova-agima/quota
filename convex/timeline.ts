import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { logEmailEvent, logTimelineEvent } from "./timelineHelpers";
import { ensureCanViewRequest } from "./requestAccessHelpers";

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
