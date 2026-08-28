const REQUEST_CODE_PATTERN = /(^|[^A-Z0-9_])([A-Z]{2}_[A-Z]{2}_[0-9]{5})(?=$|[^A-Z0-9_])/g;
const FINPLAN_COST_BASE_URL = "https://finplan.agimagroup.ru/finance/costs/";

export function extractFirstAurumRequestCode(comment?: string | null) {
  if (!comment) {
    return null;
  }
  REQUEST_CODE_PATTERN.lastIndex = 0;
  const match = REQUEST_CODE_PATTERN.exec(comment.toUpperCase());
  return match?.[2] ?? null;
}

export function getFinplanCostUrl(costId: string) {
  const params = new URLSearchParams({
    "arFilter[ID]": costId,
  });
  return `${FINPLAN_COST_BASE_URL}?${params.toString()}`;
}

function formatFinplanDate(date: Date) {
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()),
  ].join(".");
}

export function getFinplanCostSyncWindow(createdAt: number) {
  const from = new Date(createdAt);
  from.setMonth(from.getMonth() - 2);
  from.setDate(1);
  const to = new Date(createdAt);
  to.setMonth(to.getMonth() + 2);
  to.setMonth(to.getMonth() + 1, 0);

  return {
    from: formatFinplanDate(from),
    to: formatFinplanDate(to),
    raw: {
      "arFilter[>=COST_DATE]": formatFinplanDate(from),
      "arFilter[<=COST_DATE]": formatFinplanDate(to),
    },
  };
}
