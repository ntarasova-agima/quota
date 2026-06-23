import {
  ACCOUNTING_REQUEST_AREA,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  PURCHASE_CATEGORY,
  normalizeRequestCategory,
} from "./requestRules";

const ACCOUNTING_HOD_REQUIRED_CATEGORIES = [
  PURCHASE_CATEGORY,
  "Подарки",
  "Неформальное мероприятие",
  "Совместный мерч",
] as const;

const NBD_REQUIRED_CATEGORIES = [
  "Welcome-бонус",
  "Конкурсное задание",
] as const;

export function requiresAccountingHodApproval(params: {
  category: string;
}) {
  const normalizedCategory = normalizeRequestCategory(params.category);
  return ACCOUNTING_HOD_REQUIRED_CATEGORIES.includes(
    normalizedCategory as (typeof ACCOUNTING_HOD_REQUIRED_CATEGORIES)[number],
  );
}

export function getAutoRequiredHodDepartmentsForRequest(params: {
  category: string;
  specialists?: unknown[];
}) {
  return requiresAccountingHodApproval(params) ? [ACCOUNTING_REQUEST_AREA] : [];
}

export function getAutoRequiredRolesForRequest(params: {
  category?: string;
}) {
  const normalizedCategory = normalizeRequestCategory(params.category ?? "");
  const roles = new Set<string>();
  if (
    NBD_REQUIRED_CATEGORIES.includes(
      normalizedCategory as (typeof NBD_REQUIRED_CATEGORIES)[number],
    )
  ) {
    roles.add("NBD");
  }
  if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
    roles.add("BUH Transit");
  }
  return Array.from(roles);
}
