import { getAuthUserId } from "@convex-dev/auth/server";
import { normalizeEmail } from "../src/lib/authRules";
import { requiresContestSpecialistValidation } from "../src/lib/requestFields";
import { getCurrentEmail } from "./authHelpers";

export const REQUEST_WIDE_VIEW_ROLES = ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN"] as const;
export const REQUEST_ALL_LIST_ROLES = [...REQUEST_WIDE_VIEW_ROLES, "HOD"] as const;
export const ADDITIONAL_APPROVAL_ROLES = ["NBD", "AI-BOSS", "COO", "CFD", "HOD"] as const;

export async function getRoleRecord(ctx: { db: any }, email: string) {
  return await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
}

export function hasHodAccessToRequest(roleRecord: any, request: any) {
  if (!roleRecord?.roles?.includes("HOD")) {
    return false;
  }
  const departments = roleRecord.hodDepartments ?? [];
  if (!departments.length) {
    return false;
  }
  const specialists = request.specialists ?? [];
  return specialists.some(
    (item: any) =>
      requiresContestSpecialistValidation(item) && departments.includes(item.department),
  );
}

export async function hasHistoricalApprovalAccess(ctx: { db: any }, requestId: any, email: string) {
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_request", (q: any) => q.eq("requestId", requestId))
    .collect();
  return approvals.some((approval: any) => approval.reviewerEmail === email);
}

export function getViewerAccessEntries(request: any) {
  return request.viewerAccess ?? [];
}

export function hasViewerAccess(request: any, email: string) {
  const normalized = normalizeEmail(email);
  return getViewerAccessEntries(request).some(
    (item: any) => normalizeEmail(item.email) === normalized,
  );
}

export function upsertViewerAccessEntry(
  request: any,
  entry: {
    email: string;
    fullName?: string;
    grantedByEmail: string;
    grantedByName?: string;
    source: "share" | "mention";
    grantedAt: number;
  },
) {
  const normalized = normalizeEmail(entry.email);
  const existingEntries = getViewerAccessEntries(request);
  const existing = existingEntries.find((item: any) => normalizeEmail(item.email) === normalized);
  if (existing) {
    return {
      created: false,
      viewerAccess: existingEntries,
    };
  }
  return {
    created: true,
    viewerAccess: [
      ...existingEntries,
      {
        email: normalized,
        fullName: entry.fullName?.trim() || undefined,
        grantedByEmail: normalizeEmail(entry.grantedByEmail),
        grantedByName: entry.grantedByName?.trim() || undefined,
        source: entry.source,
        grantedAt: entry.grantedAt,
      },
    ],
  };
}

export async function ensureCanViewRequest(ctx: any, requestId: any) {
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
  const roleRecord = await getRoleRecord(ctx, email);
  const canViewAll = roleRecord?.roles?.some((role: string) =>
    REQUEST_WIDE_VIEW_ROLES.includes(role as (typeof REQUEST_WIDE_VIEW_ROLES)[number]),
  );
  const canHodView = hasHodAccessToRequest(roleRecord, request);
  const canViewByHistory = await hasHistoricalApprovalAccess(ctx, requestId, email);
  const isCreator = request.createdBy === userId || normalizeEmail(request.createdByEmail) === normalizeEmail(email);
  const hasExplicitViewerAccess = hasViewerAccess(request, email);
  if (!canViewAll && !canHodView && !canViewByHistory && !isCreator && !hasExplicitViewerAccess) {
    throw new Error("Not authorized");
  }
  return {
    userId,
    email,
    request,
    roleRecord,
    canViewAll,
    canHodView,
    canViewByHistory,
    isCreator,
    hasExplicitViewerAccess,
  };
}

export function canManageViewerAccess(access: {
  isCreator: boolean;
  roleRecord?: { roles?: string[] } | null;
}) {
  return access.isCreator || Boolean(access.roleRecord?.roles?.includes("ADMIN"));
}

export function canManageAttachments(access: {
  isCreator: boolean;
  canViewAll: boolean;
  canHodView: boolean;
  canViewByHistory: boolean;
}) {
  return access.isCreator || access.canViewAll || access.canHodView || access.canViewByHistory;
}
