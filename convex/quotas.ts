import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentEmail } from "./authHelpers";
import { sumQuotaUsageByMonth, sumQuotaUsageByMonthAndTag } from "./quotaUsage";
import {
  AI_TOOLS_REQUEST_CATEGORY,
  ADMINISTRATION_REQUEST_AREA,
  SERVICE_PURCHASE_CATEGORY,
  isAdministrationRequestCategory,
  isAiToolsFundingSource,
  normalizeRequestCategory,
} from "../src/lib/requestRules";
import { HOD_DEPARTMENTS, normalizeHodDepartment } from "../src/lib/departments";
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

function getSpentPair(
  spentByMonth: Map<string, { amountWithoutVat: number; amountWithVat: number }>,
  key: string,
) {
  return spentByMonth.get(key) ?? { amountWithoutVat: 0, amountWithVat: 0 };
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
  const hasRole = roles.some((role) => record?.roles?.includes(role));
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
  return await ensureAnyRole(ctx, ["CFD", "COO", "BUH", "ADMIN", "HOD"]);
}

async function ensureAdministrationQuotaEditor(ctx: any) {
  return await ensureAnyRole(ctx, ["CFD", "BUH", "ADMIN"]);
}

function isAdministrationQuotaRequest(request: any) {
  return (
    (request.requestArea ?? undefined) === ADMINISTRATION_REQUEST_AREA ||
    isAdministrationRequestCategory(request.category)
  );
}

function effectiveQuotaAmount(row?: { quota?: number; adjustedQuota?: number }) {
  return row?.adjustedQuota ?? row?.quota ?? 0;
}

function effectiveQuotaAmountWithVat(row?: {
  quota?: number;
  quotaWithVat?: number;
  adjustedQuota?: number;
  adjustedQuotaWithVat?: number;
  vatRate?: number;
}) {
  if (!row) {
    return 0;
  }
  if (row.adjustedQuota !== undefined) {
    return getQuotaWithVat(row.adjustedQuota, row.adjustedQuotaWithVat, row.vatRate);
  }
  return getQuotaWithVat(row.quota ?? 0, row.quotaWithVat, row.vatRate);
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

function getAdministrationUsage(
  requests: any[],
  options: { tag?: string; department?: string } = {},
) {
  const byMonth = new Map<string, {
    total: { amountWithoutVat: number; amountWithVat: number };
    departments: Map<string, { amountWithoutVat: number; amountWithVat: number }>;
    tags: Map<string, { amountWithoutVat: number; amountWithVat: number }>;
  }>();
  const normalizedDepartment = normalizeHodDepartment(options.department);
  for (const request of requests) {
    if (!isAdministrationQuotaRequest(request)) {
      continue;
    }
    const requestDepartment = normalizeHodDepartment(request.department);
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
    for (const allocation of sumQuotaUsageByMonth([request], () => true).entries()) {
      const [monthKey, amount] = allocation;
      if (!byMonth.has(monthKey)) {
        byMonth.set(monthKey, {
          total: emptyUsage(),
          departments: new Map(),
          tags: new Map(),
        });
      }
      const month = byMonth.get(monthKey)!;
      addUsage(month.total, amount);
      const departmentKey = requestDepartment ?? "Без цеха";
      const departmentUsage = month.departments.get(departmentKey) ?? emptyUsage();
      addUsage(departmentUsage, amount);
      month.departments.set(departmentKey, departmentUsage);
      const tagUsage = month.tags.get(tag) ?? emptyUsage();
      addUsage(tagUsage, amount);
      month.tags.set(tag, tagUsage);
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
    const isWideViewer = roleRecord?.roles?.some((role: string) =>
      ["CFD", "COO", "BUH", "ADMIN"].includes(role),
    );
    const hodDepartments = (roleRecord?.hodDepartments ?? []).map((department: string) =>
      normalizeHodDepartment(department),
    );
    const requestedDepartment = normalizeHodDepartment(args.department);
    const visibleDepartments = isWideViewer
      ? HOD_DEPARTMENTS
      : HOD_DEPARTMENTS.filter((department) => hodDepartments.includes(department));
    const departmentFilter = requestedDepartment && visibleDepartments.includes(requestedDepartment as any)
      ? requestedDepartment
      : !isWideViewer && visibleDepartments.length === 1
        ? visibleDepartments[0]
        : undefined;

    const quotaRows = await ctx.db.query("administrationQuotas").collect();
    const requests = await ctx.db.query("requests").collect();
    const usageByMonth = getAdministrationUsage(requests, {
      department: departmentFilter,
      tag: args.tag,
    });
    const rowMap = new Map(
      quotaRows.map((row: any) => [`${row.monthKey}:${row.departmentKey}`, row]),
    );

    return args.monthKeys.map((key) => {
      const { year, month } = monthInfoFromKey(key);
      const totalRow = rowMap.get(`${key}:${ADMINISTRATION_TOTAL_KEY}`);
      const monthUsage = usageByMonth.get(key);
      const totalSpent = monthUsage?.total ?? emptyUsage();
      const departmentRows = visibleDepartments
        .filter((department) => !departmentFilter || department === departmentFilter)
        .map((department) => {
          const row = rowMap.get(`${key}:${department}`);
          const spent = monthUsage?.departments.get(department) ?? emptyUsage();
          return {
            monthKey: key,
            year,
            month,
            departmentKey: department,
            departmentName: department,
            quota: row?.quota ?? 0,
            quotaWithVat: row ? getQuotaWithVat(row.quota, row.quotaWithVat, row.vatRate) : 0,
            adjustedQuota: row?.adjustedQuota,
            adjustedQuotaWithVat:
              row?.adjustedQuota !== undefined
                ? getQuotaWithVat(row.adjustedQuota, row.adjustedQuotaWithVat, row.vatRate)
                : undefined,
            vatRate: normalizeVatRate(row?.vatRate),
            spent: spent.amountWithoutVat,
            spentWithVat: spent.amountWithVat,
            remaining: effectiveQuotaAmount(row) - spent.amountWithoutVat,
            remainingWithVat: effectiveQuotaAmountWithVat(row) - spent.amountWithVat,
            updatedAt: row?.updatedAt ?? 0,
          };
        });
      const distributed = departmentRows.reduce((sum, row) => sum + effectiveQuotaAmount(row), 0);
      const distributedWithVat = departmentRows.reduce((sum, row) => sum + effectiveQuotaAmountWithVat(row), 0);
      const totalQuota = totalRow?.quota ?? 0;
      const totalQuotaWithVat = totalRow ? getQuotaWithVat(totalRow.quota, totalRow.quotaWithVat, totalRow.vatRate) : 0;
      const totalAdjustedQuota = totalRow?.adjustedQuota;
      const totalAdjustedQuotaWithVat =
        totalRow?.adjustedQuota !== undefined
          ? getQuotaWithVat(totalRow.adjustedQuota, totalRow.adjustedQuotaWithVat, totalRow.vatRate)
          : undefined;
      const effectiveTotal = totalAdjustedQuota ?? totalQuota;
      const effectiveTotalWithVat = totalAdjustedQuotaWithVat ?? totalQuotaWithVat;
      const tagBreakdown = Array.from(monthUsage?.tags.entries() ?? [])
        .sort((a, b) => b[1].amountWithVat - a[1].amountWithVat)
        .map(([tag, amount]) => ({ tag, ...amount }));
      return {
        monthKey: key,
        year,
        month,
        total: {
          departmentKey: ADMINISTRATION_TOTAL_KEY,
          quota: totalQuota,
          quotaWithVat: totalQuotaWithVat,
          adjustedQuota: totalAdjustedQuota,
          adjustedQuotaWithVat: totalAdjustedQuotaWithVat,
          vatRate: normalizeVatRate(totalRow?.vatRate),
          spent: totalSpent.amountWithoutVat,
          spentWithVat: totalSpent.amountWithVat,
          remaining: effectiveTotal - totalSpent.amountWithoutVat,
          remainingWithVat: effectiveTotalWithVat - totalSpent.amountWithVat,
          distributed,
          distributedWithVat,
          unallocated: effectiveTotal - distributed,
          unallocatedWithVat: effectiveTotalWithVat - distributedWithVat,
          updatedAt: totalRow?.updatedAt ?? 0,
        },
        departments: departmentRows,
        tagBreakdown,
        canEdit: roleRecord?.roles?.some((role: string) => ["CFD", "BUH", "ADMIN"].includes(role)) ?? false,
      };
    });
  },
});

export const updateAdministrationQuota = mutation({
  args: {
    monthKey: v.string(),
    departmentKey: v.string(),
    quota: v.number(),
    quotaWithVat: v.optional(v.number()),
    adjustedQuota: v.optional(v.number()),
    adjustedQuotaWithVat: v.optional(v.number()),
    vatRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdministrationQuotaEditor(ctx);
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
    const requests = await ctx.db.query("requests").collect();
    const spent = getAdministrationUsage(requests, {
      department: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
    }).get(args.monthKey)?.total ?? emptyUsage();
    const vatRate = normalizeVatRate(args.vatRate);
    const quotaWithVat = getQuotaWithVat(args.quota, args.quotaWithVat, vatRate);
    const adjustedQuotaWithVat =
      args.adjustedQuota !== undefined
        ? getQuotaWithVat(args.adjustedQuota, args.adjustedQuotaWithVat, vatRate)
        : undefined;
    const existing = await ctx.db
      .query("administrationQuotas")
      .withIndex("by_month_department", (q: any) =>
        q.eq("monthKey", args.monthKey).eq("departmentKey", departmentKey),
      )
      .first();
    const patch = {
      monthKey: args.monthKey,
      departmentKey,
      departmentName: departmentKey === ADMINISTRATION_TOTAL_KEY ? undefined : departmentKey,
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
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("administrationQuotas", patch);
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
