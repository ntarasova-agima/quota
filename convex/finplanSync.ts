import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  extractFirstAurumRequestCode,
  getFinplanCostSyncWindow,
} from "../src/lib/finplanCommentMatch";

type FinplanCostRow = {
  ID?: string | number;
  id?: string | number;
  COMMENT?: string;
  comment?: string;
  COST_DATE?: string;
  costDate?: string;
  PAYMENT_DDL?: string;
  paymentDeadline?: string;
  PAYMENT_DATE?: string;
  paymentDate?: string;
  COST_SUM?: string | number;
  costSum?: string | number;
  COST_SUM_NET?: string | number;
  costSumNet?: string | number;
  PAYED_COST_SUM?: string | number;
  payedCostSum?: string | number;
  BILL_STATUS?: string;
  billStatus?: string;
  COST_STATUS?: string;
  costStatus?: string;
};

type NormalizedFinplanCost = {
  id: string;
  comment: string;
  costDate?: string;
  paymentDeadline?: string;
  paymentDate?: string;
  costSum?: number;
  costSumNet?: number;
  payedCostSum?: number;
  billStatus?: string;
  costStatus?: string;
};

type FinplanSyncUpdatedRequest = {
  requestCode: string;
  finplanCostIds: string[];
};

type FinplanSyncApplyResult = {
  scannedRows: number;
  ignoredRows: number;
  matchedRequestCodes: number;
  unmatchedRequestCodes: string[];
  updatedRequests: FinplanSyncUpdatedRequest[];
};

type FinplanRequestSyncResult =
  | (FinplanSyncApplyResult & {
      ok: true;
      period: {
        from: string;
        to: string;
      };
      currentRequestCode: string;
      currentRequestUpdates: FinplanSyncUpdatedRequest[];
      preview: FinplanPaymentPreview;
    })
  | {
      ok: false;
      error: string;
    };

type DailyFinplanSyncRequest = {
  _id: string;
  requestCode: string;
  createdAt: number;
};

type DailyFinplanSyncResult = {
  checkedRequests: number;
  results: Array<
    FinplanSyncApplyResult & {
      requestCode: string;
      period: {
        from: string;
        to: string;
      };
    }
  >;
};

const FINPLAN_SYNC_ACTOR_EMAIL = "finplan-sync@aurum.local";
const DEFAULT_PAGE_LIMIT = 50;
const MAX_ROWS_PER_REQUEST = 500;
const LEGACY_FINPLAN_COSTS_URL = "https://finplan.agimagroup.ru/finance/api-costs/";
const FINPLAN_COST_FIELDS = [
  "ID",
  "COMMENT",
  "COST_DATE",
  "PAYMENT_DDL",
  "PAYMENT_DATE",
  "COST_SUM",
  "COST_SUM_NET",
  "PAYED_COST_SUM",
  "BILL_STATUS",
  "COST_STATUS",
] as const;

function toCommentMatchCosts(costs: NormalizedFinplanCost[]) {
  return costs.map((cost) => ({
    id: cost.id,
    comment: cost.comment,
  }));
}

type FinplanPaymentPreviewRow = {
  id: string;
  comment: string;
  costDate?: string;
  paymentDeadline?: string;
  paymentDate?: string;
  effectivePaymentDate?: string;
  costSum?: number;
  costSumNet?: number;
  payedCostSum?: number;
  billStatus?: string;
  costStatus?: string;
  paymentState: "paid" | "planned" | "needs_planning";
  warnings: string[];
  currencyRate?: number;
};

type FinplanPaymentPreview = {
  matchedRows: FinplanPaymentPreviewRow[];
  finplanCostIds: string[];
  totals: {
    amountWithoutVat: number;
    amountWithVat: number;
    paidWithoutVat: number;
    plannedWithoutVat: number;
  };
  comparison: {
    requestAmountWithoutVat?: number;
    requestAmountWithVat?: number;
    differenceWithoutVat?: number;
    amountMatches: boolean;
    isOverRequestAmount: boolean;
    hasExistingPaymentConflict: boolean;
  };
  suggestedStatus: "awaiting_payment" | "payment_planned" | "partially_paid" | "paid";
  canApply: boolean;
  needsAmountDecision: boolean;
  hasMissingAmounts: boolean;
  warnings: string[];
};

function getFinplanAuthMode() {
  return process.env.FINPLAN_COSTS_LIST_AUTH_MODE ?? "gateway";
}

function getFinplanCostsEndpoint() {
  return (
    process.env.FINPLAN_COSTS_LIST_URL ??
    process.env.FINPLAN_GATEWAY_COSTS_LIST_URL ??
    (getFinplanAuthMode() === "legacy_query" ? LEGACY_FINPLAN_COSTS_URL : undefined)
  );
}

function getFinplanRequestHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.FINPLAN_GATEWAY_API_KEY ?? process.env.FINPLAN_COSTS_LIST_API_KEY;
  if (apiKey) {
    const authHeader = process.env.FINPLAN_COSTS_LIST_AUTH_HEADER ?? "Authorization";
    const authScheme = process.env.FINPLAN_COSTS_LIST_AUTH_SCHEME ?? "Bearer";
    headers[authHeader] = authScheme ? `${authScheme} ${apiKey}` : apiKey;
  }
  return headers;
}

function normalizeFinplanCostRows(rows: FinplanCostRow[]) {
  return rows
    .map((row) => ({
      id: String(row.ID ?? row.id ?? "").trim(),
      comment: String(row.COMMENT ?? row.comment ?? ""),
      costDate: normalizeText(row.COST_DATE ?? row.costDate),
      paymentDeadline: normalizeText(row.PAYMENT_DDL ?? row.paymentDeadline),
      paymentDate: normalizeText(row.PAYMENT_DATE ?? row.paymentDate),
      costSum: parseFinplanMoney(row.COST_SUM ?? row.costSum),
      costSumNet: parseFinplanMoney(row.COST_SUM_NET ?? row.costSumNet),
      payedCostSum: parseFinplanMoney(row.PAYED_COST_SUM ?? row.payedCostSum),
      billStatus: normalizeText(row.BILL_STATUS ?? row.billStatus),
      costStatus: normalizeText(row.COST_STATUS ?? row.costStatus),
    }))
    .filter((row) => row.id);
}

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function parseFinplanMoney(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFinplanDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return undefined;
  }
  const [, day, month, year] = match;
  const timestamp = new Date(`${year}-${month}-${day}T00:00:00+03:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function formatFinplanDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

function isBillPaid(status?: string) {
  return (status ?? "").trim().toLowerCase() === "оплачен";
}

async function fetchCbrCurrencyRate(currency?: string, dateText?: string) {
  if (!currency || currency === "RUB" || !dateText) {
    return undefined;
  }
  const url = new URL("https://www.cbr.ru/scripts/XML_daily.asp");
  url.searchParams.set("date_req", dateText);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }
    const xml = await response.text();
    const escapedCurrency = currency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rate = xml.match(
      new RegExp(`<CharCode>${escapedCurrency}</CharCode>[\\s\\S]*?<Nominal>(\\d+)</Nominal>[\\s\\S]*?<Value>([\\d,]+)</Value>`),
    );
    if (!rate) {
      return undefined;
    }
    const nominal = Number(rate[1]);
    const value = Number(rate[2].replace(",", "."));
    return Number.isFinite(value) && Number.isFinite(nominal) && nominal > 0
      ? value / nominal
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLegacyFinplanCostsPage(params: {
  endpoint: string;
  raw: Record<string, string>;
  offset: number;
}) {
  const login = process.env.FINPLAN_LOGIN ?? process.env.FINPLAN_COSTS_LIST_LOGIN;
  const token = process.env.FINPLAN_TOKEN ?? process.env.FINPLAN_COSTS_LIST_API_KEY;
  if (!login || !token) {
    throw new Error(
      "Не настроены FINPLAN_LOGIN/FINPLAN_TOKEN для чтения затрат Финплана",
    );
  }

  const url = new URL(params.endpoint);
  url.searchParams.set("login", login);
  url.searchParams.set("token", token);
  url.searchParams.set("type", "json");
  url.searchParams.set("fields", FINPLAN_COST_FIELDS.join(","));
  url.searchParams.set("limit", String(DEFAULT_PAGE_LIMIT));
  url.searchParams.set("offset", String(params.offset));
  for (const [key, value] of Object.entries(params.raw)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "aurum-finplan-sync",
    },
  });
  if (!response.ok) {
    const message = await response.text();
    if (response.status === 403) {
      throw new Error(
        "Финплан запретил чтение затрат: проверьте права сервисной учётки на API затрат",
      );
    }
    throw new Error(`Finplan API error: ${message}`);
  }
  return response.json();
}

async function fetchGatewayFinplanCostsPage(params: {
  endpoint: string;
  raw: Record<string, string>;
  offset: number;
}) {
  const response = await fetch(params.endpoint, {
    method: "POST",
    headers: getFinplanRequestHeaders(),
    body: JSON.stringify({
      fields: [...FINPLAN_COST_FIELDS],
      limit: DEFAULT_PAGE_LIMIT,
      offset: params.offset,
      raw: params.raw,
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Finplan Gateway error: ${message}`);
  }
  return response.json();
}

async function fetchFinplanCosts(params: { createdAt: number }) {
  const endpoint = getFinplanCostsEndpoint();
  if (!endpoint) {
    throw new Error(
      "Не настроен FINPLAN_COSTS_LIST_URL для чтения затрат Финплана",
    );
  }

  const window = getFinplanCostSyncWindow(params.createdAt);
  const costs: NormalizedFinplanCost[] = [];
  let offset = 0;

  while (costs.length < MAX_ROWS_PER_REQUEST) {
    const payload =
      getFinplanAuthMode() === "legacy_query"
        ? await fetchLegacyFinplanCostsPage({
            endpoint,
            raw: window.raw,
            offset,
          })
        : await fetchGatewayFinplanCostsPage({
            endpoint,
            raw: window.raw,
            offset,
          });
    const rows = normalizeFinplanCostRows(payload.rows ?? payload.items ?? []);
    costs.push(...rows);
    if (rows.length < DEFAULT_PAGE_LIMIT) {
      break;
    }
    offset += DEFAULT_PAGE_LIMIT;
  }

  return {
    costs: costs.slice(0, MAX_ROWS_PER_REQUEST),
    window,
  };
}

async function buildFinplanPaymentPreview(params: {
  costs: NormalizedFinplanCost[];
  request: {
    requestCode: string;
    amount: number;
    amountWithVat?: number;
    currency?: string;
    paymentDeadline?: number;
    neededBy?: number;
    status: string;
    paymentSplits?: unknown[];
    plannedPaymentSplits?: unknown[];
    paymentPlannedAt?: number;
    actualPaidAmount?: number;
  };
}) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const requestDeadline = params.request.paymentDeadline ?? params.request.neededBy;
  const matchedCosts = params.costs.filter(
    (cost) => extractFirstAurumRequestCode(cost.comment) === params.request.requestCode,
  );
  const rows: FinplanPaymentPreviewRow[] = [];
  for (const cost of matchedCosts) {
    const paymentDateTs = parseFinplanDate(cost.paymentDate);
    const paymentDeadlineTs = parseFinplanDate(cost.paymentDeadline);
    const billPaid = isBillPaid(cost.billStatus);
    const hasPositiveAmount = cost.costSumNet !== undefined && cost.costSumNet > 0;
    const hasNegativeAmount = cost.costSumNet !== undefined && cost.costSumNet < 0;
    const isPaid = Boolean(
      hasPositiveAmount && billPaid && paymentDateTs !== undefined && paymentDateTs <= todayStart.getTime(),
    );
    const effectivePaymentDate = isPaid
      ? cost.paymentDate
      : cost.paymentDate ?? cost.paymentDeadline ?? (requestDeadline ? formatFinplanDate(requestDeadline) : undefined);
    const warnings: string[] = [];
    if (hasNegativeAmount) {
      warnings.push("В строке отрицательная сумма без НДС: строка не будет обновлять Aurum");
    } else if (cost.costSumNet === undefined || cost.costSumNet <= 0) {
      warnings.push("В строке нет суммы без НДС: затраты требуют планирования");
    }
    if (cost.paymentDate && !billPaid) {
      warnings.push("Дата оплаты заполнена, но счет не оплачен по статусу счета");
    }
    if (billPaid && paymentDateTs !== undefined && paymentDateTs > todayStart.getTime()) {
      warnings.push("Дата оплаты в будущем: решение должно быть согласовано с автором");
    }
    if (!cost.paymentDate && requestDeadline && !cost.paymentDeadline) {
      warnings.push("Дата оплаты не заполнена, оставляем дедлайн оплаты от автора");
    }
    if (paymentDateTs !== undefined && requestDeadline && paymentDateTs > requestDeadline) {
      warnings.push("Дата оплаты позже дедлайна автора: решение должно быть согласовано с автором");
    }
    rows.push({
      id: cost.id,
      comment: cost.comment,
      costDate: cost.costDate,
      paymentDeadline: cost.paymentDeadline,
      paymentDate: cost.paymentDate,
      effectivePaymentDate,
      costSum: cost.costSum,
      costSumNet: cost.costSumNet,
      payedCostSum: cost.payedCostSum,
      billStatus: cost.billStatus,
      costStatus: cost.costStatus,
      paymentState: isPaid
        ? "paid"
        : hasPositiveAmount && effectivePaymentDate
          ? "planned"
          : "needs_planning",
      warnings,
      currencyRate: undefined,
    });
  }
  const totals = rows.reduce(
    (acc, row) => {
      const amountWithoutVat = row.costSumNet && row.costSumNet > 0 ? row.costSumNet : 0;
      acc.amountWithoutVat += amountWithoutVat;
      acc.amountWithVat += row.costSum && row.costSum > 0 ? row.costSum : 0;
      if (row.paymentState === "paid") {
        acc.paidWithoutVat += amountWithoutVat;
      }
      if (row.paymentState === "planned") {
        acc.plannedWithoutVat += amountWithoutVat;
      }
      return acc;
    },
    { amountWithoutVat: 0, amountWithVat: 0, paidWithoutVat: 0, plannedWithoutVat: 0 },
  );
  const requestAmountWithoutVat = params.request.amount;
  const differenceWithoutVat = Number((totals.amountWithoutVat - requestAmountWithoutVat).toFixed(2));
  const amountMatches = Math.abs(differenceWithoutVat) < 0.005;
  const hasExistingPayments = Boolean(
    params.request.paymentSplits?.length ||
      params.request.plannedPaymentSplits?.length ||
      params.request.paymentPlannedAt ||
      params.request.actualPaidAmount,
  );
  const hasPositiveAmounts = totals.amountWithoutVat > 0;
  const suggestedStatus =
    !hasPositiveAmounts
      ? "awaiting_payment"
      : totals.paidWithoutVat >= totals.amountWithoutVat - 0.005
        ? "paid"
        : totals.paidWithoutVat > 0
          ? "partially_paid"
          : "payment_planned";
  const hasMissingAmounts = rows.some((row) => row.costSumNet === undefined || row.costSumNet <= 0);
  const warnings = [
    ...new Set(rows.flatMap((row) => row.warnings)),
  ];
  if (params.request.status === "closed" && rows.length === 0) {
    warnings.push("В Финплане нет строк по этой заявке. При сохранении закрытая заявка снова откроется в статусе «Требуется оплата»");
  }
  if (totals.amountWithoutVat > requestAmountWithoutVat) {
    warnings.push("Сумма Финплана больше суммы заявки");
  }
  if (totals.amountWithoutVat < requestAmountWithoutVat && totals.amountWithoutVat > 0) {
    warnings.push("Сумма Финплана меньше суммы заявки");
  }
  return {
    matchedRows: rows,
    finplanCostIds: rows.map((row) => row.id),
    totals,
    comparison: {
      requestAmountWithoutVat,
      requestAmountWithVat: params.request.amountWithVat,
      differenceWithoutVat,
      amountMatches,
      isOverRequestAmount: totals.amountWithoutVat > requestAmountWithoutVat,
      hasExistingPaymentConflict: hasExistingPayments && !amountMatches,
    },
    suggestedStatus,
    canApply: rows.length > 0,
    needsAmountDecision: !amountMatches,
    hasMissingAmounts,
    warnings,
  } satisfies FinplanPaymentPreview;
}

export const syncRequestFromFinplan = action({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args): Promise<FinplanRequestSyncResult> => {
    try {
      const request = await ctx.runMutation(api.requests.prepareFinplanRequestSync, {
        id: args.id,
      });
      const { costs, window } = await fetchFinplanCosts({
        createdAt: request.createdAt,
      });
      const result: FinplanSyncApplyResult = await ctx.runMutation(internal.requests.applyFinplanCostCommentMatches, {
        costs: toCommentMatchCosts(costs),
        actorEmail: request.actorEmail,
        actorName: request.actorName,
        dryRun: true,
      });
      const preview = await buildFinplanPaymentPreview({
        costs,
        request,
      });

      return {
        ok: true,
        ...result,
        period: {
          from: window.from,
          to: window.to,
        },
        currentRequestCode: request.requestCode,
        currentRequestUpdates: result.updatedRequests.filter(
          (item: FinplanSyncUpdatedRequest) => item.requestCode === request.requestCode,
        ),
        preview,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Не удалось обновить затраты из Финплана",
      };
    }
  },
});

export const syncDailyFinplanCosts = internalAction({
  args: {},
  handler: async (ctx): Promise<DailyFinplanSyncResult> => {
    if (process.env.FINPLAN_DAILY_SYNC_ENABLED === "false") {
      return {
        checkedRequests: 0,
        results: [],
      };
    }

    const createdAfter = Date.now() - 183 * 24 * 60 * 60 * 1000;
    const limit = Number(process.env.DAILY_FINPLAN_SYNC_REQUEST_LIMIT ?? 25);
    const requests: DailyFinplanSyncRequest[] = await ctx.runQuery(internal.requests.listDailyFinplanSyncRequests, {
      createdAfter,
      limit,
    });
    const results = [];

    for (const request of requests) {
      const { costs, window } = await fetchFinplanCosts({
        createdAt: request.createdAt,
      });
      const result: FinplanSyncApplyResult = await ctx.runMutation(internal.requests.applyFinplanCostCommentMatches, {
        costs: toCommentMatchCosts(costs),
        actorEmail: FINPLAN_SYNC_ACTOR_EMAIL,
        actorName: "Ежедневная проверка Финплана",
      });
      results.push({
        requestCode: request.requestCode,
        period: {
          from: window.from,
          to: window.to,
        },
        ...result,
      });
    }

    return {
      checkedRequests: requests.length,
      results,
    };
  },
});
