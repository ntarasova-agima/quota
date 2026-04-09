import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import { canManageAttachments, ensureCanViewRequest } from "./requestAccessHelpers";

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_SIZE = 40 * 1024 * 1024;
const allowedExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

function isAllowedAttachment(fileName: string, contentType?: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (allowedExtensions.has(extension)) {
    return true;
  }
  if (!contentType) {
    return false;
  }
  return (
    contentType.startsWith("image/") ||
    [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(contentType)
  );
}

async function ensureCanAccessRequest(ctx: any, requestId: any) {
  return await ensureCanViewRequest(ctx, requestId);
}

export const generateUploadUrl = mutation({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanAccessRequest(ctx, args.requestId);
    if (!canManageAttachments(access)) {
      throw new Error("Загружать файлы может только автор, согласующие и администратор");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveAttachment = mutation({
  args: {
    requestId: v.id("requests"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanAccessRequest(ctx, args.requestId);
    if (!canManageAttachments(access)) {
      throw new Error("Загружать файлы может только автор, согласующие и администратор");
    }
    if ((access.request.attachmentCount ?? 0) >= MAX_ATTACHMENTS) {
      throw new Error("Можно прикрепить не более 20 файлов");
    }
    if (args.fileSize > MAX_ATTACHMENT_SIZE) {
      throw new Error("Размер файла не должен превышать 40 МБ");
    }
    if (!isAllowedAttachment(args.fileName, args.contentType)) {
      throw new Error("Допустимы PDF, Office и изображения");
    }
    const id = await ctx.db.insert("requestAttachments", {
      requestId: args.requestId,
      storageId: args.storageId,
      fileName: args.fileName.trim(),
      fileSize: args.fileSize,
      contentType: args.contentType?.trim() || undefined,
      uploadedByEmail: access.email,
      uploadedByName: access.roleRecord?.fullName?.trim() || undefined,
      createdAt: Date.now(),
    });
    await ctx.db.patch(access.request._id, {
      attachmentCount: (access.request.attachmentCount ?? 0) + 1,
      lastAttachmentName: args.fileName.trim(),
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "attachment_added",
      title: "Добавлен файл",
      description: args.fileName.trim(),
      actorEmail: access.email,
      actorName: access.roleRecord?.fullName?.trim() || undefined,
    });
    return id;
  },
});

export const deleteAttachment = mutation({
  args: {
    attachmentId: v.id("requestAttachments"),
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
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) {
      throw new Error("Файл не найден");
    }
    const access = await ensureCanAccessRequest(ctx, attachment.requestId);
    if (!canManageAttachments(access)) {
      throw new Error("Удалять файлы может только автор, согласующие и администратор");
    }
    const isAdmin = access.roleRecord?.roles?.includes("ADMIN");
    if (!isAdmin && attachment.uploadedByEmail !== email) {
      throw new Error("Удалить файл может только тот, кто его загрузил, или администратор");
    }
    await ctx.db.delete(args.attachmentId);
    await ctx.storage.delete(attachment.storageId);
    const remaining = await ctx.db
      .query("requestAttachments")
      .withIndex("by_request", (q) => q.eq("requestId", attachment.requestId))
      .order("desc")
      .collect();
    await ctx.db.patch(access.request._id, {
      attachmentCount: remaining.length,
      lastAttachmentName: remaining[0]?.fileName,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: attachment.requestId,
      type: "attachment_deleted",
      title: "Удален файл",
      description: attachment.fileName,
      actorEmail: email,
      actorName: access.roleRecord?.fullName?.trim() || undefined,
    });
    return { deleted: true };
  },
});

export const listForRequest = query({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanAccessRequest(ctx, args.requestId);
    const rows = await ctx.db
      .query("requestAttachments")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .order("desc")
      .collect();
    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        url: await ctx.storage.getUrl(row.storageId),
        canDelete:
          row.uploadedByEmail === access.email || Boolean(access.roleRecord?.roles?.includes("ADMIN")),
      })),
    );
  },
});
