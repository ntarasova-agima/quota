import {
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  normalizeRequestCategory,
} from "./requestRules";

const NBD_REQUIRED_CATEGORIES = [
  "Welcome-бонус",
  "Конкурсное задание",
] as const;

export function requiresAccountingHodApproval(params: {
  category: string;
}) {
  void params;
  return false;
}

export function getAutoRequiredHodDepartmentsForRequest(params: {
  category: string;
  specialists?: unknown[];
}) {
  void params;
  return [];
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
