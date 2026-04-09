import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import { ensureCanViewRequest, getRoleRecord, upsertViewerAccessEntry } from "./requestAccessHelpers";

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
          email: v.string(),
          name: v.string(),
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
    const mentionCandidates = Array.from(
      new Map(
        (args.mentions ?? [])
          .map((item) => ({
            email: item.email.trim().toLowerCase(),
            name: item.name.trim(),
          }))
          .filter((item) => item.email && item.name && body.includes(`@${item.name}`))
          .filter((item) => item.email !== access.email.trim().toLowerCase())
          .map((item) => [`${item.email}::${item.name}`, item]),
      ).values(),
    );
    const validMentions: Array<{ email: string; name: string }> = [];
    let viewerAccess = access.request.viewerAccess;
    let viewerAccessChanged = false;
    for (const mention of mentionCandidates) {
      const targetRecord = await getRoleRecord(ctx, mention.email);
      if (!targetRecord?.active) {
        continue;
      }
      validMentions.push({
        email: mention.email,
        name: targetRecord.fullName?.trim() || mention.name,
      });
      const nextViewerAccess = upsertViewerAccessEntry(
        {
          ...access.request,
          viewerAccess,
        },
        {
          email: mention.email,
          fullName: targetRecord.fullName,
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
      mentions: comment.mentions?.filter((item: any) => body.includes(`@${item.name}`)) || undefined,
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
