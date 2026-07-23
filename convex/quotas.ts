import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import {
  getApprovedRequestQuotaAllocations,
  getEffectiveQuotaAllocations,
  sumQuotaUsageByMonth,
  sumQuotaUsageByMonthAndTag,
} from "./quotaUsage";
import {
  AI_TOOLS_REQUEST_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  isAgimaQuotaFundingSource,
  isAiToolsFundingSource,
  normalizeRequestCategory,
  shouldSkipQuotaByTag,
} from "../src/lib/requestRules";
import { HOD_DEPARTMENTS, normalizeHodDepartment } from "../src/lib/departments";
import { hasAnyRole, hasFinanceApproverRole } from "../src/lib/financeRole";
import { DEFAULT_VAT_RATE, getAmountWithVat, normalizeVatRate } from "../src/lib/vat";

const ADMINISTRATION_TOTAL_KEY = "__total__";

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthInfoFromKey(key: string) {
  const [yearStr, monthStr] = key.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

function isAiToolsQuotaRequest(request: { fundingSource: string; category: string }) {
  const normalizedCategory = normalizeRequestCategory(request.category);
  return (
    isAiToolsFundingSource(request.fundingSource) &&
    [AI_TOOLS_REQUEST_CATEGORY, SERVICE_PURCHASE_CATEGORY].includes(
      normalizedCategory as typeof AI_TOOLS_REQUEST_CATEGORY | typeof SERVICE_PURCHASE_CATEGORY,
    )
  );
}

function getQuotaWithVat(quota: number, quotaWithVat?: number, vatRate?: number) {
  return getAmountWithVat(quota, quotaWithVat, vatRate) ?? quota;
}

function quotaValue(row: any) {
  return row?.adjustedQuota ?? row?.quota ?? 0;
}

function quotaValueWithVat(row: any) {
  if (!row) return 0;
  if (row.adjustedQuota !== undefined) {
    return getQuotaWithVat(row.adjustedQuota, row.adjustedQuotaWithVat, row.vatRate);
  }
  return getQuotaWithVat(row.quota ?? 0, row.quotaWithVat, row.vatRate);
}

function getSpentPair(
  spentByMonth: Map<string, { amountWithoutVat: number; amountWithVat: number }>,
  key: string,
) {
  return spentByMonth.get(key) ?? { amountWithoutVat: 0, amountWithVat: 0 };
}

function getManualSpentPair(row: any) {
  const amountWithoutVat = row?.manualSpent ?? 0;
  return {
    amountWithoutVat,
    amountWithVat:
      getAmountWithVat(amountWithoutVat, row?.manualSpentWithVat, normalizeVatRate(row?.vatRate)) ??
      amountWithoutVat,
  };
}

async function ensureAnyRole(
  ctx: any,
  roles: Array<"NBD" | "AI-BOSS" | "CFD" | "COO" | "BUH" | "ADMIN" | "HOD">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    if (process.env.ALLOW_DEV_QUOTA_DELETE === "true") {
      return { email: "dev" };
    }
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing email");
  }
  const record = await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
  const hasRole = hasAnyRole(record, roles);
  if (!hasRole) {
    throw new Error("Not authorized");
  }
  return { email, record };
}

async function ensureNbd(ctx: any) {
  return await ensureAnyRole(ctx, ["NBD"]);
}

async function ensureAiBoss(ctx: any) {
  return await ensureAnyRole(ctx, ["AI-BOSS"]);
}

async function ensureCfd(ctx: any) {
  return await ensureAnyRole(ctx, ["CFD"]);
}

async function ensureCoo(ctx: any) {
  return await ensureAnyRole(ctx, ["COO"]);
}

async function ensureAdministrationQuotaViewer(ctx: any) {
  return await ensureAnyRole(ctx, ["NBD", "CFD", "COO", "BUH", "ADMIN", "HOD"]);
}

async function ensureAdministrationQuotaEditor(ctx: any) {
  return await ensureAnyRole(ctx, ["NBD", "CFD", "COO", "BUH", "ADMIN", "HOD"]);
}

function getAllowedHodDepartments(record: any) {
  return (record?.hodDepartments ?? [])
    .map((department: string) => normalizeHodDepartment(department))
    .filter((department: string | undefined): department is string =>
      Boolean(department && HOD_DEPARTMENTS.includes(department as any)),
    );
}

function canEditAdministrationQuotaRow(record: any, departmentKey: string) {
  if (
    record?.roles?.some((role: string) => ["COO", "BUH", "ADMIN"].includes(role)) ||
    hasFinanceApproverRole(record)
  ) {
    return true;
  }
  if (departmentKey === ADMINISTRATION_TOTAL_KEY) {
    return false;
  }
  if (record?.roles?.includes("NBD") && departmentKey === "Аккаунтинг") {
    return true;
  }
  return record?.roles?.includes("HOD") && getAllowedHodDepartments(record).includes(departmentKey);
}

function getAdministrationQuotaVisibility(record: any) {
  const canSeeAllDepartments =
    record?.roles?.some((role: string) =>
      ["COO", "BUH", "ADMIN"].includes(role),
    ) || hasFinanceApproverRole(record);
  const allowedDepartments = canSeeAllDepartments
    ? HOD_DEPARTMENTS
    : record?.roles?.includes("NBD")
      ? ["Аккаунтинг"]
      : getAllowedHodDepartments(record);
  return {
    canSeeAllDepartments,
    allowedDepartments,
    canEditTotal:
      record?.roles?.some((role: string) => ["COO", "BUH", "ADMIN"].includes(role)) ||
      hasFinanceApproverRole(record),
  };
}

function isAdministrationQuotaRequest(request: any) {
  return isAgimaQuotaFundingSource(request.fundingSource) && !shouldSkipQuotaByTag(request.cfdTag);
}

function getAdministrationQuotaDepartment(request: any) {
  return (
    normalizeHodDepartment(request.requestArea) ??
    normalizeHodDepartment(request.department) ??
    "Без цеха"
  );
}

function isWelcomeBonusRequest(request: any) {
  return (
    isAgimaQuotaFundingSource(request.fundingSource) &&
    normalizeRequestCategory(request.category) === "Welcome-бонус" &&
    !request.isCanceled &&
    !["draft", "hod_pending", "pending", "rejected"].includes(request.status)
  );
}

function isQuotaVisibleRequest(request: any) {
  return isAdministrationQuotaRequest(request) || isWelcomeBonusRequest(request);
}

function emptyUsage() {
  return { amountWithoutVat: 0, amountWithVat: 0 };
}

function addUsage(
  current: { amountWithoutVat: number; amountWithVat: number },
  amount: { amountWithoutVat: number; amountWithVat: number },
) {
  current.amountWithoutVat += amount.amountWithoutVat;
  current.amountWithVat += amount.amountWithVat;
}

function monthKeyFromTimestamp(timestamp?: number) {
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getRequestAmountPair(request: any) {
  const amountWithoutVat = request.amount ?? 0;
  const amountWithVat =
    getAmountWithVat(
      amountWithoutVat,
      request.amountWithVat,
      request.vatRate,
    ) ?? amountWithoutVat;
  return { amountWithoutVat, amountWithVat };
}

function requestMatchesAdministrationFilters(
  request: any,
  options: { department?: string; tag?: string } = {},
) {
  const requestDepartment = getAdministrationQuotaDepartment(request);
  if (options.department && requestDepartment !== options.department) {
    return false;
  }
  const tag = request.cfdTag?.trim() || "Без тега";
  if (options.tag !== undefined && tag !== options.tag) {
    return false;
  }
  return true;
}

function buildRequestCounterpartyLines(request: any, approvedAmount: number) {
  const specialists = (request.specialists ?? []).filter(
    (specialist: any) => (specialist.name?.trim() || specialist.contractorLegalEntity?.trim()) && (specialist.directCost ?? 0) > 0,
  );
  if (!specialists.length) {
    return [{ lineKey: "request", counterparty: request.counterparty?.trim() || "", amount: approvedAmount }];
  }

  const lines = specialists.map((specialist: any) => ({
    lineKey: `specialist:${specialist.id}`,
    counterparty: specialist.contractorLegalEntity?.trim() || specialist.name?.trim() || "",
    amount: specialist.directCost ?? 0,
  }));
  const allocated = lines.reduce((sum: number, line: { amount: number }) => sum + line.amount, 0);
  const remainder = Math.max(approvedAmount - allocated, 0);
  if (remainder > 0) {
    lines.push({
      lineKey: "request",
      counterparty: request.counterparty?.trim() || "",
      amount: remainder,
    });
  }
  return lines;
}

function getLatestApprovalTimestamp(approvalsByRequest: Map<string, any[]>, request: any) {
  const decidedAt = (approvalsByRequest.get(request._id) ?? [])
    .filter((approval: any) => approval.status === "approved" && approval.decidedAt)
    .map((approval: any) => approval.decidedAt);
  return decidedAt.length ? Math.max(...decidedAt) : request.updatedAt ?? request.createdAt;
}

function getAdministrationUsage(
  requests: any[],
  options: { tag?: string; department?: string } = {},
) {
  const byMonth = new Map<string, {
    total: { amountWithoutVat: number; amountWithVat: number };
    departments: Map<string, { amountWithoutVat: number; amountWithVat: number }>;
    tagsByDepartment: Map<string, Map<string, { amountWithoutVat: number; amountWithVat: number }>>;
  }>();
  const normalizedDepartment = normalizeHodDepartment(options.department);
  for (const request of requests) {
    if (!isAdministrationQuotaRequest(request)) {
      continue;
    }
    const requestDepartment = getAdministrationQuotaDepartment(request);
    if (normalizedDepartment && requestDepartment !== normalizedDepartment) {
      continue;
    }
    const tag = request.cfdTag?.trim() || "Без тега";
    if (options.tag !== undefined) {
      if (options.tag === "" && request.cfdTag) {
        continue;
      }
      if (options.tag !== "" && tag !== options.tag) {
        continue;
      }
    }
    for (const allocation of getApprovedRequestQuotaAllocations(request)) {
      const { monthKey, ...amount } = allocation;
      if (!byMonth.has(monthKey)) {
        byMonth.set(monthKey, {
          total: emptyUsage(),
          departments: new Map(),
          tagsByDepartment: new Map(),
        });
      }
      const month = byMonth.get(monthKey)!;
      addUsage(month.total, amount);
      const departmentKey = requestDepartment;
      const departmentUsage = month.departments.get(departmentKey) ?? emptyUsage();
      addUsage(departmentUsage, amount);
      month.departments.set(departmentKey, departmentUsage);
      const departmentTags = month.tagsByDepartment.get(departmentKey) ?? new Map();
      const tagUsage = departmentTags.get(tag) ?? emptyUsage();
      addUsage(tagUsage, amount);
      departmentTags.set(tag, tagUsage);
      month.tagsByDepartment.set(departmentKey, departmentTags);
    }
  }
  return byMonth;
}

export const listByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAnyRole(ctx, ["NBD", "CFD", "COO"]);
    const items = await ctx.db.query("presalesQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на пресейлы",
    );
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = getSpentPair(spentByMonth, key);
      results.push(
        existing
          ? {
              ...existing,
              quotaWithVat: getQuotaWithVat(existing.quota, existing.quotaWithVat, existing.vatRate),
              adjustedQuota: existing.adjustedQuota,
              adjustedQuotaWithVat:
                existing.adjustedQuota !== undefined
                  ? getQuotaWithVat(
                      existing.adjustedQuota,
                      existing.adjustedQuotaWithVat,
                      existing.vatRate,
                    )
                  : undefined,
              vatRate: normalizeVatRate(existing.vatRate),
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
            }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              quotaWithVat: 0,
              adjustedQuota: undefined,
              adjustedQuotaWithVat: undefined,
              vatRate: DEFAULT_VAT_RATE,
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    adjustedQuota: v.optional(v.number()),
    adjustedQuotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на пресейлы",
    ).get(args.monthKey) ?? { amountWithoutVat: 0, amountWithVat: 0 };
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const adjustedQuotaWithVat =
      args.adjustedQuota !== undefined
        ? getQuotaWithVat(args.adjustedQuota, args.adjustedQuotaWithVat, vatRate)
        : undefined;

    const existing = await ctx.db
      .query("presalesQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        quotaWithVat,
        adjustedQuota: args.adjustedQuota,
        adjustedQuotaWithVat,
        vatRate,
        spent: spent.amountWithoutVat,
        spentWithVat: spent.amountWithVat,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("presalesQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      quotaWithVat,
      adjustedQuota: args.adjustedQuota,
      adjustedQuotaWithVat,
      vatRate,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    });
  },
});

export const listAiToolByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAnyRole(ctx, ["AI-BOSS", "CFD", "COO"]);
    const items = await ctx.db.query("aiToolQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const predicate = (request: any) => isAiToolsQuotaRequest(request);
    const spentByMonth = sumQuotaUsageByMonth(requests, predicate);
    const spentByMonthAndTag = sumQuotaUsageByMonthAndTag(requests, predicate);
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = getSpentPair(spentByMonth, key);
      const tagBreakdown = Array.from(spentByMonthAndTag.get(key)?.entries() ?? [])
        .sort((a, b) => b[1].amountWithVat - a[1].amountWithVat)
        .map(([tag, amount]) => ({ tag, ...amount }));
      results.push(
        existing
          ? {
              ...existing,
              quotaWithVat: getQuotaWithVat(existing.quota, existing.quotaWithVat, existing.vatRate),
              adjustedQuota: existing.adjustedQuota,
              adjustedQuotaWithVat:
                existing.adjustedQuota !== undefined
                  ? getQuotaWithVat(
                      existing.adjustedQuota,
                      existing.adjustedQuotaWithVat,
                      existing.vatRate,
                    )
                  : undefined,
              vatRate: normalizeVatRate(existing.vatRate),
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
              tagBreakdown,
            }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              quotaWithVat: 0,
              adjustedQuota: undefined,
              adjustedQuotaWithVat: undefined,
              vatRate: DEFAULT_VAT_RATE,
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
              tagBreakdown,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateAiToolQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    adjustedQuota: v.optional(v.number()),
    adjustedQuotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAiBoss(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent =
      sumQuotaUsageByMonth(requests, (request) => isAiToolsQuotaRequest(request)).get(args.monthKey) ??
      { amountWithoutVat: 0, amountWithVat: 0 };
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const adjustedQuotaWithVat =
      args.adjustedQuota !== undefined
        ? getQuotaWithVat(args.adjustedQuota, args.adjustedQuotaWithVat, vatRate)
        : undefined;

    const existing = await ctx.db
      .query("aiToolQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        quotaWithVat,
        adjustedQuota: args.adjustedQuota,
        adjustedQuotaWithVat,
        vatRate,
        spent: spent.amountWithoutVat,
        spentWithVat: spent.amountWithVat,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("aiToolQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      quotaWithVat,
      adjustedQuota: args.adjustedQuota,
      adjustedQuotaWithVat,
      vatRate,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    });
  },
});

export const listCfdByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAnyRole(ctx, ["CFD", "COO"]);
    const items = await ctx.db.query("cfdQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(requests, () => true);
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = getSpentPair(spentByMonth, key);
      results.push(
        existing
          ? {
              ...existing,
              quotaWithVat: getQuotaWithVat(existing.quota, existing.quotaWithVat, existing.vatRate),
              adjustedQuotaWithVat: getQuotaWithVat(
                existing.adjustedQuota ?? existing.quota,
                existing.adjustedQuotaWithVat,
                existing.vatRate,
              ),
              vatRate: normalizeVatRate(existing.vatRate),
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
            }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              quotaWithVat: 0,
              adjustedQuota: undefined,
              adjustedQuotaWithVat: undefined,
              vatRate: DEFAULT_VAT_RATE,
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateCfdQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    adjustedQuota: v.optional(v.number()),
    adjustedQuotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureCfd(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent =
      sumQuotaUsageByMonth(requests, () => true).get(args.monthKey) ??
      { amountWithoutVat: 0, amountWithVat: 0 };
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const adjustedQuotaWithVat =
      args.adjustedQuota !== undefined
        ? getQuotaWithVat(args.adjustedQuota, args.adjustedQuotaWithVat, vatRate)
        : undefined;

    const existing = await ctx.db
      .query("cfdQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        quotaWithVat,
        adjustedQuota: args.adjustedQuota,
        adjustedQuotaWithVat,
        vatRate,
        spent: spent.amountWithoutVat,
        spentWithVat: spent.amountWithVat,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("cfdQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      quotaWithVat,
      adjustedQuota: args.adjustedQuota,
      adjustedQuotaWithVat,
      vatRate,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    });
  },
});

export const listCooByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAnyRole(ctx, ["COO", "CFD"]);
    const items = await ctx.db.query("cooQuotas").collect();
    const map = new Map(items.map((item) => [item.monthKey, item]));
    const requests = await ctx.db.query("requests").collect();
    const spentByMonth = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на внутренние затраты",
    );
    const results = [];
    for (const key of args.monthKeys) {
      const existing = map.get(key);
      const { year, month } = monthInfoFromKey(key);
      const spent = getSpentPair(spentByMonth, key);
      results.push(
        existing
          ? {
              ...existing,
              quotaWithVat: getQuotaWithVat(existing.quota, existing.quotaWithVat, existing.vatRate),
              adjustedQuotaWithVat: getQuotaWithVat(
                existing.adjustedQuota ?? existing.quota,
                existing.adjustedQuotaWithVat,
                existing.vatRate,
              ),
              vatRate: normalizeVatRate(existing.vatRate),
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
            }
          : {
              monthKey: key,
              year,
              month,
              quota: 0,
              quotaWithVat: 0,
              adjustedQuota: undefined,
              adjustedQuotaWithVat: undefined,
              vatRate: DEFAULT_VAT_RATE,
              spent: spent.amountWithoutVat,
              spentWithVat: spent.amountWithVat,
              updatedAt: 0,
            },
      );
    }
    return results;
  },
});

export const updateCooQuota = mutation({
  args: {
    monthKey: v.string(),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    adjustedQuota: v.optional(v.number()),
    adjustedQuotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureCoo(ctx);
    const { year, month } = monthInfoFromKey(args.monthKey);
    const requests = await ctx.db.query("requests").collect();
    const spent = sumQuotaUsageByMonth(
      requests,
      (request) => request.fundingSource === "Квота на внутренние затраты",
    ).get(args.monthKey) ?? { amountWithoutVat: 0, amountWithVat: 0 };
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const adjustedQuotaWithVat =
      args.adjustedQuota !== undefined
        ? getQuotaWithVat(args.adjustedQuota, args.adjustedQuotaWithVat, vatRate)
        : undefined;
    const existing = await ctx.db
      .query("cooQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        quota: args.quota,
        quotaWithVat,
        adjustedQuota: args.adjustedQuota,
        adjustedQuotaWithVat,
        vatRate,
        spent: spent.amountWithoutVat,
        spentWithVat: spent.amountWithVat,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("cooQuotas", {
      monthKey: args.monthKey,
      year,
      month,
      quota: args.quota,
      quotaWithVat,
      adjustedQuota: args.adjustedQuota,
      adjustedQuotaWithVat,
      vatRate,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    });
  },
});

export const listAdministrationByMonthKeys = query({
  args: {
    monthKeys: v.array(v.string()),
    department: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await ensureAdministrationQuotaViewer(ctx);
    const roleRecord = access.record;
    const visibility = getAdministrationQuotaVisibility(roleRecord);
    const requestedDepartment = normalizeHodDepartment(args.department);
    const visibleDepartments = visibility.allowedDepartments;
    const departmentFilter = requestedDepartment && visibleDepartments.includes(requestedDepartment as any)
      ? requestedDepartment
      : !visibility.canSeeAllDepartments && visibleDepartments.length === 1
        ? visibleDepartments[0]
        : undefined;

    const quotaRows = await ctx.db.query("administrationQuotas").collect();
    const allTags = await ctx.db.query("cfdTags").collect();
    const requests = await ctx.db.query("requests").collect();
    const approvals = await ctx.db.query("approvals").collect();
    const savedEntries = await ctx.db.query("administrationQuotaEntries").collect();
    const approvalsByRequest = new Map<string, any[]>();
    for (const approval of approvals) {
      const list = approvalsByRequest.get(approval.requestId) ?? [];
      list.push(approval);
      approvalsByRequest.set(approval.requestId, list);
    }
    const entryMap = new Map(
      savedEntries.map((entry: any) => [
        `${entry.requestId}:${entry.monthKey}:${entry.lineKey ?? "request"}`,
        entry,
      ]),
    );
    const usageByMonth = getAdministrationUsage(requests, {
      department: departmentFilter,
      tag: args.tag,
    });
    const quotaEntriesByMonth = new Map<string, any[]>();
    const welcomeBonusByMonth = new Map<string, { amountWithoutVat: number; amountWithVat: number }>();
    const monthSet = new Set(args.monthKeys);
    for (const request of requests) {
      const department = getAdministrationQuotaDepartment(request);
      if (!visibility.canSeeAllDepartments && !visibleDepartments.includes(department as any)) {
        continue;
      }
      if (!requestMatchesAdministrationFilters(request, { department: departmentFilter, tag: args.tag })) {
        continue;
      }
      if (!isQuotaVisibleRequest(request)) {
        continue;
      }
      const tagName = request.cfdTag?.trim() || "Без тега";
      const isWelcomeBonus = isWelcomeBonusRequest(request);
      const allocations = isWelcomeBonus
        ? [
            {
              monthKey: monthKeyFromTimestamp(getLatestApprovalTimestamp(approvalsByRequest, request)),
              ...getRequestAmountPair(request),
            },
          ].filter(
            (
              allocation,
            ): allocation is {
              monthKey: string;
              amountWithoutVat: number;
              amountWithVat: number;
            } => Boolean(allocation.monthKey),
          )
        : getApprovedRequestQuotaAllocations(request);
      for (const allocation of allocations) {
        if (!monthSet.has(allocation.monthKey)) {
          continue;
        }
        const list = quotaEntriesByMonth.get(allocation.monthKey) ?? [];
        const counterpartyLines = isWelcomeBonus
          ? [{ lineKey: "request", counterparty: request.counterparty?.trim() || "", amount: allocation.amountWithoutVat }]
          : buildRequestCounterpartyLines(request, allocation.amountWithoutVat);
        counterpartyLines.forEach((line: any, lineIndex: number) => {
          const savedEntry = entryMap.get(`${request._id}:${allocation.monthKey}:${line.lineKey}`);
          list.push({
            key: `${request._id}:${allocation.monthKey}:${line.lineKey}`,
            lineKey: line.lineKey,
            requestId: request._id,
            monthKey: allocation.monthKey,
            departmentKey: department,
            tagName,
            requestCode: request.requestCode,
            requestTitle: request.title,
            clientName: request.clientName,
            assignmentTitle: request.title ?? request.justification,
            counterparty: line.counterparty,
            amount: line.amount,
            amountWithVat:
              allocation.amountWithoutVat > 0
                ? allocation.amountWithVat * (line.amount / allocation.amountWithoutVat)
                : 0,
            currency: "RUB",
            comment: savedEntry?.comment ?? "",
            workStatus: savedEntry?.workStatus ?? "",
            result: savedEntry?.result ?? "",
            isFirstForRequest: lineIndex === 0,
            requestRowSpan: counterpartyLines.length,
            isWelcomeBonus,
            canEditEntry: canEditAdministrationQuotaRow(roleRecord, department) || roleRecord?.roles?.includes("NBD"),
            updatedAt: savedEntry?.updatedAt ?? request.updatedAt ?? request.createdAt,
          });
        });
        quotaEntriesByMonth.set(allocation.monthKey, list);
        if (isWelcomeBonus) {
          const current = welcomeBonusByMonth.get(allocation.monthKey) ?? emptyUsage();
          addUsage(current, allocation);
          welcomeBonusByMonth.set(allocation.monthKey, current);
        }
      }
    }
    const rowMap = new Map(
      quotaRows.map((row: any) => [
        `${row.monthKey}:${row.departmentKey}:${row.tagName ?? ""}`,
        row,
      ]),
    );
    const activeTagsByDepartment = new Map<string, string[]>();
    for (const tag of allTags) {
      if (!tag.active) {
        continue;
      }
      const department = normalizeHodDepartment(tag.department);
      if (!department) {
        continue;
      }
      const list = activeTagsByDepartment.get(department) ?? [];
      if (!list.includes(tag.name)) {
        list.push(tag.name);
      }
      activeTagsByDepartment.set(department, list);
    }
    return args.monthKeys.map((key) => {
      const { year, month } = monthInfoFromKey(key);
      const totalRow = rowMap.get(`${key}:${ADMINISTRATION_TOTAL_KEY}:`);
      const monthUsage = usageByMonth.get(key);
      const departmentRows = visibleDepartments
        .filter((department: string) => !departmentFilter || department === departmentFilter)
        .map((department: string) => {
          const row = rowMap.get(`${key}:${department}:`);
          const requestSpent = monthUsage?.departments.get(department) ?? emptyUsage();
          const spentTags = monthUsage?.tagsByDepartment.get(department) ?? new Map();
          const tagNames = Array.from(
            new Set([
              ...(activeTagsByDepartment.get(department) ?? []),
              ...quotaRows
                .filter((quotaRow: any) => quotaRow.monthKey === key && quotaRow.departmentKey === department && quotaRow.tagName)
                .map((quotaRow: any) => quotaRow.tagName),
              ...Array.from(spentTags.keys()),
              ...(quotaEntriesByMonth.get(key) ?? [])
                .filter((entry: any) => entry.departmentKey === department)
                .map((entry: any) => entry.tagName),
            ]),
          ).filter((tag): tag is string => Boolean(tag));
          const tagRows = tagNames
            .filter((tagName) => args.tag === undefined || (args.tag === "" ? tagName === "Без тега" : tagName === args.tag))
            .sort((a, b) => a.localeCompare(b, "ru"))
            .map((tagName) => {
              const tagRow = rowMap.get(`${key}:${department}:${tagName}`);
              const requestTagSpent = spentTags.get(tagName) ?? emptyUsage();
              const manualTagSpent = getManualSpentPair(tagRow);
              const entries = (quotaEntriesByMonth.get(key) ?? []).filter(
                (entry: any) =>
                  entry.departmentKey === department &&
                  (entry.tagName ?? "Без тега") === tagName,
              );
              const tagSpent = requestTagSpent;
              const quota = quotaValue(tagRow);
              const quotaWithVat = quotaValueWithVat(tagRow);
              const tagIssues: string[] = [];
              return {
                monthKey: key,
                year,
                month,
                departmentKey: department,
                tagName,
                quota,
                quotaWithVat,
                vatRate: normalizeVatRate(tagRow?.vatRate),
                manualSpent: manualTagSpent.amountWithoutVat,
                manualSpentWithVat: manualTagSpent.amountWithVat,
                spent: tagSpent.amountWithoutVat,
                spentWithVat: tagSpent.amountWithVat,
                remaining: quota - tagSpent.amountWithoutVat,
                remainingWithVat: quotaWithVat - tagSpent.amountWithVat,
                entries,
                issues: tagIssues,
                updatedAt: tagRow?.updatedAt ?? 0,
                canEdit: canEditAdministrationQuotaRow(roleRecord, department),
                canEditManualSpent:
                  canEditAdministrationQuotaRow(roleRecord, department) && tagName !== "Без тега",
              };
            });
          const tagAllocated = tagRows.reduce((sum, tagRow) => sum + tagRow.quota, 0);
          const tagAllocatedWithVat = tagRows.reduce((sum, tagRow) => sum + (tagRow.quotaWithVat ?? tagRow.quota), 0);
          const spent = requestSpent;
          const quota = quotaValue(row);
          const quotaWithVat = quotaValueWithVat(row);
          const departmentIssues: string[] = [];
          if (quota > quotaValue(totalRow)) {
            departmentIssues.push("Квота цеха больше общей квоты AGIMA");
          }
          return {
            monthKey: key,
            year,
            month,
            departmentKey: department,
            departmentName: department,
            quota,
            quotaWithVat,
            vatRate: normalizeVatRate(row?.vatRate),
            spent: spent.amountWithoutVat,
            spentWithVat: spent.amountWithVat,
            remaining: quota - spent.amountWithoutVat,
            remainingWithVat: quotaWithVat - spent.amountWithVat,
            distributed: tagAllocated,
            distributedWithVat: tagAllocatedWithVat,
            unallocated: quota - tagAllocated,
            unallocatedWithVat: quotaWithVat - tagAllocatedWithVat,
            issues: departmentIssues,
            tags: tagRows,
            updatedAt: row?.updatedAt ?? 0,
            canEdit: canEditAdministrationQuotaRow(roleRecord, department),
          };
        });
      const distributed = departmentRows.reduce((sum: number, row: any) => sum + row.quota, 0);
      const distributedWithVat = departmentRows.reduce(
        (sum: number, row: any) => sum + (row.quotaWithVat ?? row.quota),
        0,
      );
      const totalRequestSpent = monthUsage?.total ?? emptyUsage();
      const totalSpent = totalRequestSpent;
      const totalQuota = quotaValue(totalRow);
      const totalQuotaWithVat = quotaValueWithVat(totalRow);
      const totalIssues: string[] = [];
      if (distributed > totalQuota) {
        totalIssues.push("Сумма квот цехов больше общей квоты AGIMA");
        for (const department of departmentRows) {
          department.issues = Array.from(new Set([...(department.issues ?? []), "Сумма квот цехов больше общей квоты AGIMA"]));
        }
      }
      return {
        monthKey: key,
        year,
        month,
        sheetRows: departmentRows.flatMap((department: any) =>
          department.tags.flatMap((tag: any) => {
            const entries = tag.entries?.length ? tag.entries : [undefined];
            return entries.map((entry: any, index: number) => ({
              key: `${department.departmentKey}:${tag.tagName ?? "Без тега"}:${entry?.key ?? "empty"}:${index}`,
              monthKey: key,
              departmentKey: department.departmentKey,
              tagName: tag.tagName ?? "Без тега",
              isFirstForTag: index === 0,
              tagRowSpan: entries.length,
              quota: tag.quota,
              remaining: tag.remaining,
              manualSpent: tag.manualSpent,
              canEdit: tag.canEdit,
              vatRate: tag.vatRate,
              entry,
            }));
          }),
        ),
        quotaEntries: (quotaEntriesByMonth.get(key) ?? []).sort((a: any, b: any) => {
          if (a.isWelcomeBonus !== b.isWelcomeBonus) {
            return a.isWelcomeBonus ? 1 : -1;
          }
          return `${a.departmentKey}:${a.tagName}:${a.requestCode ?? ""}`.localeCompare(
            `${b.departmentKey}:${b.tagName}:${b.requestCode ?? ""}`,
            "ru",
          );
        }),
        welcomeBonus: welcomeBonusByMonth.get(key) ?? emptyUsage(),
        total: visibility.canSeeAllDepartments
          ? {
              departmentKey: ADMINISTRATION_TOTAL_KEY,
              quota: totalQuota,
              quotaWithVat: totalQuotaWithVat,
              vatRate: normalizeVatRate(totalRow?.vatRate),
              spent: totalSpent.amountWithoutVat,
              spentWithVat: totalSpent.amountWithVat,
              remaining: totalQuota - totalSpent.amountWithoutVat,
              remainingWithVat: totalQuotaWithVat - totalSpent.amountWithVat,
              distributed,
              distributedWithVat,
              unallocated: totalQuota - distributed,
              unallocatedWithVat: totalQuotaWithVat - distributedWithVat,
              issues: totalIssues,
              updatedAt: totalRow?.updatedAt ?? 0,
              canEdit: visibility.canEditTotal,
            }
          : undefined,
        departments: departmentRows,
        canEditTotal: visibility.canEditTotal,
        canSeeTotal: visibility.canSeeAllDepartments,
      };
    });
  },
});

export const updateAdministrationQuota = mutation({
  args: {
    monthKey: v.string(),
    departmentKey: v.string(),
    tagName: v.optional(v.string()),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await ensureAdministrationQuotaEditor(ctx);
    const roleRecord = access.record;
    const { year, month } = monthInfoFromKey(args.monthKey);
    const departmentKey =
      args.departmentKey === ADMINISTRATION_TOTAL_KEY
        ? ADMINISTRATION_TOTAL_KEY
        : normalizeHodDepartment(args.departmentKey);
    if (!departmentKey) {
      throw new Error("Укажите цех");
    }
    if (
      departmentKey !== ADMINISTRATION_TOTAL_KEY &&
      !HOD_DEPARTMENTS.includes(departmentKey as any)
    ) {
      throw new Error("Так не бывает");
    }
    const tagName = args.tagName?.trim() || undefined;
    if (departmentKey === ADMINISTRATION_TOTAL_KEY && tagName) {
      throw new Error("Так не бывает");
    }
    if (!canEditAdministrationQuotaRow(roleRecord, departmentKey)) {
      throw new Error("Недостаточно прав для редактирования этой квоты");
    }
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const monthRows = await ctx.db
      .query("administrationQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .collect();
    const projectedRows = [
      ...monthRows.filter(
        (row: any) =>
          !(
            row.departmentKey === departmentKey &&
            (row.tagName ?? undefined) === tagName
          ),
      ),
      {
        departmentKey,
        tagName,
        quota: args.quota,
        quotaWithVat,
        vatRate,
      },
    ];
    const projectedQuota = (key: string, tag?: string) =>
      quotaValue(
        projectedRows.find(
          (row: any) =>
            row.departmentKey === key &&
            (row.tagName ?? undefined) === tag,
        ),
      );
    const totalQuota = projectedQuota(ADMINISTRATION_TOTAL_KEY);
    const departmentQuotas = projectedRows.filter(
      (row: any) =>
        row.departmentKey !== ADMINISTRATION_TOTAL_KEY &&
        !row.tagName,
    );
    const departmentQuotaSum = departmentQuotas.reduce(
      (sum: number, row: any) => sum + quotaValue(row),
      0,
    );
    if (departmentKey === ADMINISTRATION_TOTAL_KEY) {
      if (departmentQuotaSum > args.quota) {
        throw new Error("Сумма квот цехов не может быть больше общей квоты AGIMA");
      }
    } else if (!tagName) {
      if (args.quota > totalQuota) {
        throw new Error("Квота цеха не может быть больше общей квоты AGIMA");
      }
      if (departmentQuotaSum > totalQuota) {
        throw new Error("Сумма квот цехов не может быть больше общей квоты AGIMA");
      }
      const tagQuotaSum = projectedRows
        .filter((row: any) => row.departmentKey === departmentKey && row.tagName)
        .reduce((sum: number, row: any) => sum + quotaValue(row), 0);
      if (tagQuotaSum > args.quota) {
        throw new Error("Сумма квот тегов не может быть больше квоты цеха");
      }
    }
    const requests = await ctx.db.query("requests").collect();
    const spent = getAdministrationUsage(requests, {
      department: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
      tag: tagName,
    }).get(args.monthKey)?.total ?? emptyUsage();
    const existing = monthRows.find(
      (row: any) =>
        row.departmentKey === departmentKey &&
        (row.tagName ?? undefined) === tagName,
    );
    const patch = {
      monthKey: args.monthKey,
      departmentKey,
      departmentName: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
      tagName,
      year,
      month,
      quota: args.quota,
      quotaWithVat,
      adjustedQuota: undefined,
      adjustedQuotaWithVat: undefined,
      vatRate,
      manualSpent: existing?.manualSpent,
      manualSpentWithVat: existing?.manualSpentWithVat,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    };
    const previousQuota = existing?.adjustedQuota ?? existing?.quota;
    const actorEmail = access.email;
    const actorName = access.record?.fullName?.trim() || undefined;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      if (previousQuota !== args.quota) {
        await ctx.db.insert("quotaChangeLogs", {
          monthKey: args.monthKey,
          changeType: "quota",
          level: tagName ? "tag" : departmentKey === ADMINISTRATION_TOTAL_KEY ? "total" : "department",
          departmentKey: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
          tagName,
          fromQuota: previousQuota,
          toQuota: args.quota,
          actorEmail,
          actorName,
          createdAt: patch.updatedAt,
        });
      }
      return existing._id;
    }
    const id = await ctx.db.insert("administrationQuotas", patch);
    await ctx.db.insert("quotaChangeLogs", {
      monthKey: args.monthKey,
      changeType: "quota",
      level: tagName ? "tag" : departmentKey === ADMINISTRATION_TOTAL_KEY ? "total" : "department",
      departmentKey: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
      tagName,
      fromQuota: undefined,
      toQuota: args.quota,
      actorEmail,
      actorName,
      createdAt: patch.updatedAt,
    });
    return id;
  },
});

export const updateAdministrationManualSpent = mutation({
  args: {
    monthKey: v.string(),
    departmentKey: v.string(),
    tagName: v.string(),
    manualSpent: v.number(),
    manualSpentWithVat: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await ensureAdministrationQuotaEditor(ctx);
    const roleRecord = access.record;
    const { year, month } = monthInfoFromKey(args.monthKey);
    const departmentKey = normalizeHodDepartment(args.departmentKey);
    const tagName = args.tagName.trim();
    if (!departmentKey || !HOD_DEPARTMENTS.includes(departmentKey as any)) {
      throw new Error("Укажите цех");
    }
    if (!tagName || tagName === "Без тега") {
      throw new Error("Укажите тег для ручного списания");
    }
    if (!canEditAdministrationQuotaRow(roleRecord, departmentKey)) {
      throw new Error("Недостаточно прав для ручного списания по этому тегу");
    }
    if (args.manualSpent < 0) {
      throw new Error("Потрачено без заявок не может быть отрицательным");
    }

    const monthRows = await ctx.db
      .query("administrationQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .collect();
    const existing = monthRows.find(
      (row: any) => row.departmentKey === departmentKey && (row.tagName ?? undefined) === tagName,
    );
    const vatRate = normalizeVatRate(existing?.vatRate);
    const manualSpentWithVat = getAmountWithVat(
      args.manualSpent,
      args.manualSpentWithVat,
      vatRate,
    ) ?? args.manualSpent;
    const requests = await ctx.db.query("requests").collect();
    const spent = getAdministrationUsage(requests, {
      department: departmentKey,
      tag: tagName,
    }).get(args.monthKey)?.total ?? emptyUsage();
    const patch = {
      monthKey: args.monthKey,
      departmentKey,
      departmentName: departmentKey,
      tagName,
      year,
      month,
      quota: existing?.quota ?? 0,
      quotaWithVat: existing?.quotaWithVat ?? getQuotaWithVat(existing?.quota ?? 0, undefined, vatRate),
      adjustedQuota: undefined,
      adjustedQuotaWithVat: undefined,
      vatRate,
      manualSpent: args.manualSpent,
      manualSpentWithVat,
      spent: spent.amountWithoutVat,
      spentWithVat: spent.amountWithVat,
      updatedAt: Date.now(),
    };
    const actorEmail = access.email;
    const actorName = access.record?.fullName?.trim() || undefined;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      if (
        (existing.manualSpent ?? 0) !== args.manualSpent ||
        (existing.manualSpentWithVat ?? getAmountWithVat(existing.manualSpent ?? 0, undefined, existing.vatRate) ?? (existing.manualSpent ?? 0)) !==
          manualSpentWithVat
      ) {
        await ctx.db.insert("quotaChangeLogs", {
          monthKey: args.monthKey,
          changeType: "manual_spent",
          level: "tag",
          departmentKey,
          tagName,
          fromQuota: existing.adjustedQuota ?? existing.quota,
          toQuota: existing.adjustedQuota ?? existing.quota ?? 0,
          fromManualSpent: existing.manualSpent,
          toManualSpent: args.manualSpent,
          fromManualSpentWithVat: existing.manualSpentWithVat,
          toManualSpentWithVat: manualSpentWithVat,
          actorEmail,
          actorName,
          createdAt: patch.updatedAt,
        });
      }
      return existing._id;
    }

    const id = await ctx.db.insert("administrationQuotas", patch);
    await ctx.db.insert("quotaChangeLogs", {
      monthKey: args.monthKey,
      changeType: "manual_spent",
      level: "tag",
      departmentKey,
      tagName,
      fromQuota: undefined,
      toQuota: patch.quota,
      fromManualSpent: undefined,
      toManualSpent: args.manualSpent,
      fromManualSpentWithVat: undefined,
      toManualSpentWithVat: manualSpentWithVat,
      actorEmail,
      actorName,
      createdAt: patch.updatedAt,
    });
    return id;
  },
});

export const updateAdministrationQuotaEntry = mutation({
  args: {
    requestId: v.id("requests"),
    lineKey: v.optional(v.string()),
    monthKey: v.string(),
    departmentKey: v.string(),
    tagName: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    workStatus: v.optional(v.string()),
    result: v.optional(v.string()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await ensureAdministrationQuotaEditor(ctx);
    const roleRecord = access.record;
    const departmentKey = normalizeHodDepartment(args.departmentKey);
    if (!departmentKey || !HOD_DEPARTMENTS.includes(departmentKey as any)) {
      throw new Error("Укажите цех");
    }
    if (
      !canEditAdministrationQuotaRow(roleRecord, departmentKey) &&
      !roleRecord?.roles?.includes("NBD")
    ) {
      throw new Error("Недостаточно прав для редактирования строки квоты");
    }

    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.isCanceled ||
      ["draft", "hod_pending", "pending", "rejected"].includes(request.status) ||
      !isQuotaVisibleRequest(request)
    ) {
      throw new Error("Заявка не входит в таблицу квоты");
    }
    const requestDepartment = getAdministrationQuotaDepartment(request);
    if (requestDepartment !== departmentKey) {
      throw new Error("Цех строки не совпадает с заявкой");
    }

    const existing = await ctx.db
      .query("administrationQuotaEntries")
      .withIndex("by_request", (q: any) => q.eq("requestId", args.requestId))
      .collect();
    const lineKey = args.lineKey?.trim() || "request";
    const current = existing.find(
      (entry: any) => entry.monthKey === args.monthKey && (entry.lineKey ?? "request") === lineKey,
    );
    const now = Date.now();
    const patch = {
      requestId: args.requestId,
      lineKey,
      monthKey: args.monthKey,
      departmentKey,
      tagName: args.tagName?.trim() || "Без тега",
      counterparty: args.counterparty?.trim() || undefined,
      workStatus: args.workStatus?.trim() || undefined,
      result: args.result?.trim() || undefined,
      comment: args.comment?.trim() || undefined,
      updatedByEmail: access.email,
      updatedByName: access.record?.fullName?.trim() || undefined,
      updatedAt: now,
    };
    if (current) {
      await ctx.db.patch(current._id, patch);
      return current._id;
    }
    return await ctx.db.insert("administrationQuotaEntries", {
      ...patch,
      createdAt: now,
    });
  },
});

export const listAdministrationHistory = query({
  args: {
    monthKeys: v.array(v.string()),
    department: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await ensureAdministrationQuotaViewer(ctx);
    const roleRecord = access.record;
    const visibility = getAdministrationQuotaVisibility(roleRecord);
    const requestedDepartment = normalizeHodDepartment(args.department);
    const visibleDepartments = visibility.allowedDepartments;
    const monthSet = new Set(args.monthKeys);

    const logs = (await ctx.db.query("quotaChangeLogs").collect())
      .filter((log: any) => monthSet.has(log.monthKey))
      .filter((log: any) => {
        const department = normalizeHodDepartment(log.departmentKey);
        if (!visibility.canSeeAllDepartments && (!department || !visibleDepartments.includes(department as any))) {
          return false;
        }
        if (requestedDepartment && department !== requestedDepartment) {
          return false;
        }
        if (args.tag !== undefined && (log.tagName ?? "") !== args.tag) {
          return false;
        }
        return true;
      })
      .map((log: any) => ({
        key: `log:${log._id}`,
        type: log.changeType === "manual_spent" ? ("manual_spent_change" as const) : ("quota_change" as const),
        monthKey: log.monthKey,
        level: log.level,
        departmentKey: log.departmentKey,
        tagName: log.tagName,
        fromQuota: log.fromQuota,
        toQuota: log.toQuota,
        fromManualSpent: log.fromManualSpent,
        toManualSpent: log.toManualSpent,
        fromManualSpentWithVat: log.fromManualSpentWithVat,
        toManualSpentWithVat: log.toManualSpentWithVat,
        actorEmail: log.actorEmail,
        actorName: log.actorName,
        createdAt: log.createdAt,
      }));

    const requests = (await ctx.db.query("requests").collect())
      .filter((request: any) => isAdministrationQuotaRequest(request))
      .filter((request: any) => {
        const department = getAdministrationQuotaDepartment(request);
        if (!visibility.canSeeAllDepartments && department && !visibleDepartments.includes(department as any)) {
          return false;
        }
        if (requestedDepartment && department !== requestedDepartment) {
          return false;
        }
        const tag = request.cfdTag?.trim() || "Без тега";
        if (args.tag !== undefined && tag !== args.tag) {
          return false;
        }
        return true;
      });
    const requestEvents = [];
    for (const request of requests) {
      for (const allocation of sumQuotaUsageByMonth([request], () => true).entries()) {
        const [monthKey, amount] = allocation;
        if (!monthSet.has(monthKey)) {
          continue;
        }
        requestEvents.push({
          key: `request:${request._id}:${monthKey}`,
          type: "request_usage" as const,
          monthKey,
          departmentKey: getAdministrationQuotaDepartment(request),
          tagName: request.cfdTag?.trim() || "Без тега",
          requestId: request._id,
          requestCode: request.requestCode,
          requestTitle: request.title,
          amountWithoutVat: amount.amountWithoutVat,
          amountWithVat: amount.amountWithVat,
          actorEmail: request.createdByEmail,
          actorName: request.createdByName,
          createdAt: request.updatedAt ?? request.createdAt,
        });
      }
    }

    return [...logs, ...requestEvents].sort((a: any, b: any) => b.createdAt - a.createdAt);
  },
});

export const deleteQuotasForYear = mutation({
  args: {
    year: v.number(),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const items = await ctx.db
      .query("presalesQuotas")
      .filter((q: any) => q.eq(q.field("year"), args.year))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    return { deleted: items.length };
  },
});

export const deleteQuotaByMonthKey = mutation({
  args: {
    monthKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureNbd(ctx);
    const existing = await ctx.db
      .query("presalesQuotas")
      .withIndex("by_monthKey", (q: any) => q.eq("monthKey", args.monthKey))
      .first();
    if (!existing) {
      return { deleted: false };
    }
    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});
