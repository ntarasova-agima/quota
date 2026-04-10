import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import { ensureCanViewRequest, getRoleRecord, upsertViewerAccessEntry } from "./requestAccessHelpers";
import { isAgimaEmail } from "../src/lib/authRules";

function normalizeMentionEntries(
  mentions: Array<{ key: string; email: string; name: string; token: string }> = [],
  authorEmail: string,
) {
  return Array.from(
    new Map(
      mentions
        .map((item) => ({
          key: item.key.trim() || item.email.trim().toLowerCase(),
          email: item.email.trim().toLowerCase(),
          name: item.name.trim(),
          token: item.token.trim() || item.name.trim(),
        }))
        .filter((item) => item.email && item.name && item.token)
        .filter((item) => item.email !== authorEmail.trim().toLowerCase())
        .filter((item) => isAgimaEmail(item.email))
        .map((item) => [item.email, item]),
    ).values(),
  );
}

export const listByRequest = query({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    await ensureCanViewRequest(ctx, args.requestId);
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
    mentions: v.optional(
      v.array(
        v.object({
          key: v.string(),
          email: v.string(),
          name: v.string(),
          token: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanViewRequest(ctx, args.requestId);
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    const body = args.body.trim();
    if (!body) {
      throw new Error("Комментарий не может быть пустым");
    }
    const mentionCandidates = normalizeMentionEntries(args.mentions ?? [], access.email);
    const validMentions: Array<{ key: string; email: string; name: string; token: string }> = [];
    let viewerAccess = access.request.viewerAccess;
    let viewerAccessChanged = false;
    for (const mention of mentionCandidates) {
      const targetRecord = await getRoleRecord(ctx, mention.email);
      validMentions.push({
        key: targetRecord?._id ? String(targetRecord._id) : mention.email,
        email: mention.email,
        name: targetRecord?.fullName?.trim() || mention.name,
        token: mention.token,
      });
      const nextViewerAccess = upsertViewerAccessEntry(
        {
          ...access.request,
          viewerAccess,
        },
        {
          email: mention.email,
          fullName: targetRecord?.fullName ?? mention.name,
          grantedByEmail: access.email,
          grantedByName: access.roleRecord?.fullName ?? identity?.name ?? undefined,
          source: "mention",
          grantedAt: now,
        },
      );
      if (nextViewerAccess.created) {
        viewerAccess = nextViewerAccess.viewerAccess;
        viewerAccessChanged = true;
      }
    }
    if (viewerAccessChanged) {
      await ctx.db.patch(access.request._id, {
        viewerAccess,
        updatedAt: now,
      });
    }
    const id = await ctx.db.insert("comments", {
      requestId: args.requestId,
      authorId: access.userId,
      authorEmail: access.email,
      authorName: access.roleRecord?.fullName ?? identity?.name ?? undefined,
      body,
      mentions: validMentions.length ? validMentions : undefined,
      parentId: args.parentId,
      createdAt: now,
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "comment_added",
      title: args.parentId ? "Добавлен ответ в комментариях" : "Добавлен комментарий",
      actorEmail: access.email,
      actorName: access.roleRecord?.fullName ?? identity?.name ?? undefined,
      metadata: validMentions.length
        ? {
            mentionedEmails: validMentions.map((item) => item.email),
          }
        : undefined,
    });
    if (validMentions.length) {
      await ctx.scheduler.runAfter(0, internal.emails.sendCommentMentioned, {
        requestId: args.requestId,
        recipients: validMentions.map((item) => item.email),
        authorEmail: access.email,
        authorName: access.roleRecord?.fullName ?? identity?.name ?? undefined,
        commentBody: body,
      });
    }
    return id;
  },
});

export const editComment = mutation({
  args: {
    id: v.id("comments"),
    body: v.string(),
    mentions: v.optional(
      v.array(
        v.object({
          key: v.string(),
          email: v.string(),
          name: v.string(),
          token: v.string(),
        }),
      ),
    ),
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
    const request = await ctx.db.get(comment.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const identity = await ctx.auth.getUserIdentity();
    const mentionCandidates = normalizeMentionEntries(args.mentions ?? [], email);
    const previousMentionEmails = new Set(
      (comment.mentions ?? []).map((item: any) => item.email.trim().toLowerCase()),
    );
    const validMentions: Array<{ key: string; email: string; name: string; token: string }> = [];
    let viewerAccess = request.viewerAccess;
    let viewerAccessChanged = false;
    const newMentionRecipients: string[] = [];
    for (const mention of mentionCandidates) {
      const targetRecord = await getRoleRecord(ctx, mention.email);
      validMentions.push({
        key: targetRecord?._id ? String(targetRecord._id) : mention.email,
        email: mention.email,
        name: targetRecord?.fullName?.trim() || mention.name,
        token: mention.token,
      });
      const nextViewerAccess = upsertViewerAccessEntry(
        {
          ...request,
          viewerAccess,
        },
        {
          email: mention.email,
          fullName: targetRecord?.fullName ?? mention.name,
          grantedByEmail: email,
          grantedByName: roleRecord?.fullName ?? identity?.name ?? undefined,
          source: "mention",
          grantedAt: Date.now(),
        },
      );
      if (nextViewerAccess.created) {
        viewerAccess = nextViewerAccess.viewerAccess;
        viewerAccessChanged = true;
      }
      if (!previousMentionEmails.has(mention.email)) {
        newMentionRecipients.push(mention.email);
      }
    }
    if (viewerAccessChanged) {
      await ctx.db.patch(request._id, {
        viewerAccess,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(comment._id, {
      body,
      mentions: validMentions.length ? validMentions : undefined,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: comment.requestId,
      type: "comment_edited",
      title: "Комментарий отредактирован",
      actorEmail: email,
    });
    if (newMentionRecipients.length) {
      await ctx.scheduler.runAfter(0, internal.emails.sendCommentMentioned, {
        requestId: comment.requestId,
        recipients: newMentionRecipients,
        authorEmail: email,
        authorName: roleRecord?.fullName ?? identity?.name ?? undefined,
        commentBody: body,
      });
    }
    return { updated: true };
  },
});
