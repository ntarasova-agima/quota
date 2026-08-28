import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { getFinplanCostSyncWindow } from "../src/lib/finplanCommentMatch";

type FinplanCostRow = {
  ID?: string | number;
  id?: string | number;
  COMMENT?: string;
  comment?: string;
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
    }))
    .filter((row) => row.id);
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
  url.searchParams.set("fields", "ID,COMMENT,COST_DATE");
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
      fields: ["ID", "COMMENT", "COST_DATE"],
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
  const costs: Array<{ id: string; comment: string }> = [];
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
        costs,
        actorEmail: request.actorEmail,
        actorName: request.actorName,
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
        costs,
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
