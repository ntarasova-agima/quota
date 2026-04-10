import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import { isAiToolsFundingSource } from "../src/lib/requestRules";
import { requiresContestSpecialistValidation } from "../src/lib/requestFields";
import { getAmountWithVat, normalizeVatRate } from "../src/lib/vat";
import {
  buildApprovalTargets,
  getApprovalIdentity,
  getPendingContestValidationDepartments,
  getRequestApprovalStatus,
} from "./requestWorkflow";

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

const decisionEnum = v.union(v.literal("approved"), v.literal("rejected"));
const additionalApprovalRoleEnum = v.union(
  v.literal("NBD"),
  v.literal("AI-BOSS"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("HOD"),
);
const forwardModeEnum = v.union(v.literal("approve"), v.literal("defer"));

function getQuotaTableName(fundingSource: string) {
  if (fundingSource === "Квота на пресейлы") {
    return "presalesQuotas";
  }
  if (isAiToolsFundingSource(fundingSource)) {
    return "aiToolQuotas";
  }
  return null;
}

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
      let items = await ctx.db
        .query("approvals")
        .withIndex("by_role", (q) => q.eq("role", role))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .collect();
      if (role === "HOD") {
        const departments = roleRecord.hodDepartments ?? [];
        items = items.filter((item) => item.department && departments.includes(item.department));
      }
      approvals.push(...items);
    }

    const seen = new Set<string>();
    const results: Array<{ approval: any; request: any; kind: "approval" | "payment" | "hod" }> = [];
    for (const approval of approvals) {
      if (seen.has(approval.requestId)) {
        continue;
      }
      seen.add(approval.requestId);
      const request = await ctx.db.get(approval.requestId) as any;
      if (!request) {
        continue;
      }
      const kind =
        approval.role === "HOD" &&
        getPendingContestValidationDepartments({
          category: request.category,
          specialists: request.specialists,
          requiredHodDepartments: request.requiredHodDepartments,
        }).some((department) => (roleRecord.hodDepartments ?? []).includes(department))
          ? "hod"
          : "approval";
      results.push({ approval, request, kind });
    }

    if (roles.some((role) => ["BUH", "CFD"].includes(role))) {
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
            role: roles.includes("BUH") ? "BUH" : "CFD",
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
        if (seen.has(request._id) || request.isCanceled) {
          continue;
        }
        const pendingDepartments = getPendingContestValidationDepartments({
          category: request.category,
          specialists: request.specialists,
          requiredHodDepartments: request.requiredHodDepartments,
        }).filter((department) => departments.includes(department));
        if (!pendingDepartments.length) {
          continue;
        }
        seen.add(request._id);
        results.push({
          request,
          approval: {
            requestId: request._id,
            role: "HOD",
            status: "pending",
            department: pendingDepartments[0],
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
    department: v.optional(v.string()),
    decision: decisionEnum,
    comment: v.optional(v.string()),
    additionalRoles: v.optional(v.array(additionalApprovalRoleEnum)),
    additionalHodDepartments: v.optional(v.array(v.string())),
    forwardMode: v.optional(forwardModeEnum),
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
    if (
      args.role === "HOD" &&
      (!args.department || !(roleRecord.hodDepartments ?? []).includes(args.department.trim()))
    ) {
      throw new Error("Not authorized for this department");
    }

    if (args.decision === "rejected" && (!args.comment || args.comment.trim().length === 0)) {
      throw new Error("Comment required for rejection");
    }
    const additionalRoles = Array.from(new Set(args.additionalRoles ?? []));
    if (additionalRoles.length > 0 && args.decision !== "approved") {
      throw new Error("Дополнительные роли можно указать только при согласовании");
    }
    if (args.forwardMode && additionalRoles.length === 0) {
      throw new Error("Выберите роли, чтобы отправить заявку дальше");
    }
    if (args.forwardMode === "defer" && args.decision !== "approved") {
      throw new Error("Отложить согласование можно только при согласовании");
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

    const existingApprovals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    const approval = existingApprovals.find(
      (item) =>
        item.role === args.role &&
        (args.role !== "HOD" || (item.department ?? "") === (args.department?.trim() ?? "")),
    );
    if (!approval) {
      throw new Error("Approval entry not found");
    }
    if (approval.status !== "pending") {
      throw new Error("Already decided");
    }

    const additionalTargets = buildApprovalTargets({
      requiredRoles: additionalRoles,
      requiredHodDepartments: additionalRoles.includes("HOD")
        ? args.additionalHodDepartments
        : undefined,
    }).filter(
      (target) => getApprovalIdentity(target) !== getApprovalIdentity({
        role: args.role,
        department: args.department?.trim() || undefined,
      }),
    );

    if (additionalRoles.includes("HOD") && !additionalTargets.some((target) => target.role === "HOD")) {
      throw new Error("Выберите цех для руководителя цеха");
    }

    for (const target of additionalTargets) {
      if (
        target.role !== "HOD" &&
        roleRecord.roles.includes(target.role as any)
      ) {
        throw new Error("Нельзя отправить заявку самому себе");
      }
      if (
        target.role === "HOD" &&
        roleRecord.roles.includes("HOD") &&
        target.department &&
        (roleRecord.hodDepartments ?? []).includes(target.department)
      ) {
        throw new Error("Нельзя отправить заявку самому себе");
      }
      if (existingApprovals.some((item) => getApprovalIdentity(item) === getApprovalIdentity(target))) {
        throw new Error("Эта роль уже участвует в согласовании");
      }
    }

    const decidedAt = Date.now();
    if (args.forwardMode !== "defer") {
      await ctx.db.patch(approval._id, {
        status: args.decision,
        comment: args.comment?.trim() || undefined,
        decidedAt,
        reviewerId: userId,
        reviewerEmail: email,
      });
    }
    for (const target of additionalTargets) {
      await ctx.db.insert("approvals", {
        requestId: args.requestId,
        role: target.role as any,
        department: target.department,
        status: "pending",
        requestedByRole: args.role,
        requestedByEmail: email,
        requestedByName: roleRecord.fullName ?? undefined,
        requestedAt: decidedAt,
        requestedByApprovalId: approval._id,
        requestedByDeferred: args.forwardMode === "defer" ? true : undefined,
      });
    }

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    const nextRequiredHodDepartments = Array.from(
      new Set([
        ...(request.requiredHodDepartments ?? []),
        ...additionalTargets
          .filter((target) => target.role === "HOD")
          .map((target) => target.department)
          .filter(Boolean) as string[],
      ]),
    );
    const nextRequiredRoles = Array.from(
      new Set([
        ...request.requiredRoles,
        ...additionalTargets.map((target) => target.role),
      ]),
    );
    const status = getRequestApprovalStatus({
      category: request.category,
      specialists: request.specialists,
      requiredHodDepartments: nextRequiredHodDepartments,
      approvals,
    });

    await ctx.db.patch(request._id, {
      requiredRoles: nextRequiredRoles as any,
      requiredHodDepartments: nextRequiredHodDepartments.length ? nextRequiredHodDepartments : undefined,
      status,
      updatedAt: decidedAt,
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: additionalTargets.length > 0 ? "approval_forwarded" : "approval_decision",
      title: additionalTargets.length > 0
        ? args.forwardMode === "defer"
          ? "Согласование отложено и заявка отправлена дальше"
          : "Заявка согласована и отправлена на дополнительное согласование"
        : args.decision === "approved"
          ? "Заявка согласована"
          : "Заявка отклонена",
      description: additionalTargets.length > 0
        ? `${args.role}${args.department ? ` · ${args.department}` : ""} → ${additionalTargets
            .map((target) =>
              target.role === "HOD" && target.department
                ? `HOD · ${target.department}`
                : target.role,
            )
            .join(", ")}${args.comment?.trim() ? ` · ${args.comment.trim()}` : ""}`
        : `${args.role}${args.department ? ` · ${args.department}` : ""}${args.comment?.trim() ? ` · ${args.comment.trim()}` : ""}`,
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
      metadata: {
        role: args.role,
        department: args.department?.trim() || undefined,
        requestStatus: status,
        additionalRoles,
        forwardMode: args.forwardMode,
      },
    });

    const quotaTableName = getQuotaTableName(request.fundingSource);
    if (status === "approved" && request.status !== "approved" && quotaTableName) {
      if (!request.neededBy) {
        throw new Error("Missing neededBy for quota-backed request");
      }
      const date = new Date(request.neededBy);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const existing = await ctx.db
        .query(quotaTableName)
        .withIndex("by_monthKey", (q: any) => q.eq("monthKey", key))
        .first();
      const requestAmountWithVat =
        getAmountWithVat(request.amount, request.amountWithVat, request.vatRate) ?? request.amount;
      if (existing) {
        await ctx.db.patch(existing._id, {
          spent: existing.spent + request.amount,
          spentWithVat: (existing.spentWithVat ?? existing.spent) + requestAmountWithVat,
          vatRate: normalizeVatRate(existing.vatRate ?? request.vatRate),
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert(quotaTableName, {
          monthKey: key,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          quota: 0,
          quotaWithVat: 0,
          vatRate: normalizeVatRate(request.vatRate),
          spent: request.amount,
          spentWithVat: requestAmountWithVat,
          updatedAt: Date.now(),
        });
      }
    }

    if (additionalTargets.length > 0) {
      await ctx.scheduler.runAfter(0, internal.emails.sendAdditionalApprovalRequested, {
        requestId: request._id,
        targets: additionalTargets.map((target) => ({
          role: target.role as any,
          department: target.department,
        })),
        requestedByRole: args.role,
        requestedByName: roleRecord.fullName ?? undefined,
        requestedByEmail: email,
        forwardMode: args.forwardMode ?? "approve",
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendAdditionalApprovalForwardedToAuthor, {
        requestId: request._id,
        targets: additionalTargets.map((target) => ({
          role: target.role as any,
          department: target.department,
        })),
        requestedByRole: args.role,
        requestedByName: roleRecord.fullName ?? undefined,
        requestedByEmail: email,
        forwardMode: args.forwardMode ?? "approve",
      });
      if (args.forwardMode !== "defer") {
        await ctx.scheduler.runAfter(0, internal.emails.sendDecision, {
          requestId: request._id,
          decision: args.decision,
          role: args.role,
          comment: args.comment?.trim() || undefined,
          reviewerName: roleRecord.fullName ?? undefined,
          reviewerEmail: email,
          requestStatus: status,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.emails.sendDecision, {
        requestId: request._id,
        decision: args.decision,
        role: args.role,
        comment: args.comment?.trim() || undefined,
        reviewerName: roleRecord.fullName ?? undefined,
        reviewerEmail: email,
        requestStatus: status,
      });
    }
    if (
      args.decision === "approved" &&
      approval.requestedByDeferred &&
      approval.requestedByEmail &&
      approval.requestedByEmail.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      await ctx.scheduler.runAfter(0, internal.emails.sendDeferredApprovalResolved, {
        requestId: request._id,
        recipientEmail: approval.requestedByEmail,
        recipientName: approval.requestedByName ?? undefined,
        resolvedRole: args.role,
        resolvedDepartment: (approval.department ?? args.department?.trim()) || undefined,
        resolverEmail: email,
        resolverName: roleRecord.fullName ?? undefined,
      });
    }

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
    await ctx.scheduler.runAfter(0, internal.emails.sendApprovalReminder, {
      requestId: args.requestId,
      remindedByEmail: email,
      remindedByName: roleRecord.fullName ?? undefined,
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
    department: v.optional(v.string()),
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
    const approvalsBefore = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    const approval = approvalsBefore.find(
      (item) =>
        item.role === args.role &&
        (args.role !== "HOD" || (item.department ?? "") === (args.department?.trim() ?? "")),
    );
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
    const status = getRequestApprovalStatus({
      category: request.category,
      specialists: request.specialists,
      requiredHodDepartments: request.requiredHodDepartments,
      approvals,
    });

    await ctx.db.patch(request._id, {
      status,
      updatedAt: now,
    });

    const quotaTableName = getQuotaTableName(request.fundingSource);
    if (status === "approved" && quotaTableName) {
      if (!request.neededBy) {
        throw new Error("Missing neededBy for quota-backed request");
      }
      const date = new Date(request.neededBy);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const existing = await ctx.db
        .query(quotaTableName)
        .withIndex("by_monthKey", (q: any) => q.eq("monthKey", key))
        .first();
      const requestAmountWithVat =
        getAmountWithVat(request.amount, request.amountWithVat, request.vatRate) ?? request.amount;
      if (existing) {
        await ctx.db.patch(existing._id, {
          spent: existing.spent + request.amount,
          spentWithVat: (existing.spentWithVat ?? existing.spent) + requestAmountWithVat,
          vatRate: normalizeVatRate(existing.vatRate ?? request.vatRate),
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert(quotaTableName, {
          monthKey: key,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          quota: 0,
          quotaWithVat: 0,
          vatRate: normalizeVatRate(request.vatRate),
          spent: request.amount,
          spentWithVat: requestAmountWithVat,
          updatedAt: Date.now(),
        });
      }
    }

    await logTimelineEvent(ctx, {
      requestId: args.requestId,
      type: "admin_approval_override",
      title: `Админ согласовал как ${args.role}${args.department ? ` · ${args.department}` : ""}`,
      description: args.comment?.trim() || undefined,
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
      metadata: { role: args.role, department: args.department?.trim() || undefined },
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
