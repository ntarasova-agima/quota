import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getCurrentEmail } from "./authHelpers";
import { getRoleRecord } from "./requestAccessHelpers";

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
  "zip",
  "7z",
  "rar",
]);

const suggestionStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("validation"),
  v.literal("done"),
);

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
      "application/zip",
      "application/x-7z-compressed",
      "application/vnd.rar",
      "application/x-rar-compressed",
    ].includes(contentType)
  );
}

async function ensureCanAccessSuggestion(
  ctx: MutationCtx,
  suggestionId: Id<"improvementSuggestions">,
) {
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
  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) {
    throw new Error("Предложение не найдено");
  }
  if (!isAdmin && suggestion.authorEmail !== email) {
    throw new Error("Not authorized");
  }
  return { email, roleRecord, suggestion, isAdmin };
}

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
    const sortedItems = visibleItems.sort((left, right) => right.createdAt - left.createdAt);
    return await Promise.all(
      sortedItems.map(async (item) => {
        const attachments = await ctx.db
          .query("improvementAttachments")
          .withIndex("by_suggestion", (q) => q.eq("suggestionId", item._id))
          .order("desc")
          .collect();
        return {
          ...item,
          attachments: await Promise.all(
            attachments.map(async (attachment) => ({
              ...attachment,
              url: await ctx.storage.getUrl(attachment.storageId),
              canDelete: isAdmin || attachment.uploadedByEmail === email,
            })),
          ),
        };
      }),
    );
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

export const generateUploadUrl = mutation({
  args: {
    suggestionId: v.id("improvementSuggestions"),
  },
  handler: async (ctx, args) => {
    await ensureCanAccessSuggestion(ctx, args.suggestionId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveAttachment = mutation({
  args: {
    suggestionId: v.id("improvementSuggestions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanAccessSuggestion(ctx, args.suggestionId);
    const attachments = await ctx.db
      .query("improvementAttachments")
      .withIndex("by_suggestion", (q) => q.eq("suggestionId", args.suggestionId))
      .collect();
    if (attachments.length >= MAX_ATTACHMENTS) {
      throw new Error("Можно прикрепить не более 20 файлов");
    }
    if (args.fileSize > MAX_ATTACHMENT_SIZE) {
      throw new Error("Размер файла не должен превышать 40 МБ");
    }
    if (!isAllowedAttachment(args.fileName, args.contentType)) {
      throw new Error("Допустимы PDF, Office, изображения и архивы");
    }
    const fileName = args.fileName.trim();
    const id = await ctx.db.insert("improvementAttachments", {
      suggestionId: args.suggestionId,
      storageId: args.storageId,
      fileName,
      fileSize: args.fileSize,
      contentType: args.contentType?.trim() || undefined,
      uploadedByEmail: access.email,
      uploadedByName: access.roleRecord?.fullName?.trim() || undefined,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.suggestionId, {
      updatedAt: Date.now(),
    });
    return id;
  },
});

export const deleteAttachment = mutation({
  args: {
    attachmentId: v.id("improvementAttachments"),
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
    const access = await ensureCanAccessSuggestion(ctx, attachment.suggestionId);
    if (!access.isAdmin && attachment.uploadedByEmail !== email) {
      throw new Error("Удалить файл может только тот, кто его загрузил, или администратор");
    }
    await ctx.db.delete(args.attachmentId);
    await ctx.storage.delete(attachment.storageId);
    await ctx.db.patch(attachment.suggestionId, {
      updatedAt: Date.now(),
    });
    return { deleted: true };
  },
});
