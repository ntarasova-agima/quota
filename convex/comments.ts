import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";

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

async function canViewRequest(ctx: any, requestId: any) {
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
  return { request, userId, email, record };
}

export const listByRequest = query({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    await canViewRequest(ctx, args.requestId);
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .order("asc")
      .collect();
    return comments;
  },
});

export const addComment = mutation({
  args: {
    requestId: v.id("requests"),
    body: v.string(),
    parentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const { userId, email, record } = await canViewRequest(ctx, args.requestId);
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    const body = args.body.trim();
    if (!body) {
      throw new Error("Комментарий не может быть пустым");
    }
    const id = await ctx.db.insert("comments", {
      requestId: args.requestId,
      authorId: userId,
      authorEmail: email,
      authorName: record?.fullName ?? identity?.name ?? undefined,
      body,
      parentId: args.parentId,
      createdAt: now,
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "comment_added",
      title: args.parentId ? "Добавлен ответ в комментариях" : "Добавлен комментарий",
      actorEmail: email,
      actorName: record?.fullName ?? identity?.name ?? undefined,
    });
    return id;
  },
});

export const editComment = mutation({
  args: {
    id: v.id("comments"),
    body: v.string(),
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
    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Комментарий не найден");
    }
    if (comment.authorId !== userId) {
      throw new Error("Not authorized");
    }
    const replies = await ctx.db
      .query("comments")
      .withIndex("by_parent", (q) => q.eq("parentId", comment._id))
      .collect();
    if (replies.length > 0) {
      throw new Error("Комментарий нельзя редактировать после ответа");
    }
    const body = args.body.trim();
    if (!body) {
      throw new Error("Комментарий не может быть пустым");
    }
    await ctx.db.patch(comment._id, {
      body,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: comment.requestId,
      type: "comment_edited",
      title: "Комментарий отредактирован",
      actorEmail: email,
    });
    return { updated: true };
  },
});
