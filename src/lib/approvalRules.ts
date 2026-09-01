import {
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  normalizeRequestCategory,
} from "./requestRules";
import { normalizeContestSpecialistSource } from "./requestFields";

const NBD_REQUIRED_CATEGORIES = [
  "Welcome-бонус",
  "Конкурсное задание",
] as const;

function hasSpecialistContent(item: {
  name?: string;
  contractorLegalEntity?: string;
  department?: string;
  hours?: number;
  directCost?: number;
  taxAmount?: number;
  contractorTypes?: string[];
  taxUnknown?: boolean;
  amountIncludesTaxes?: boolean;
  amountExcludesTaxes?: boolean;
  validationSkipped?: boolean;
}) {
  return Boolean(
    item.name?.trim() ||
      item.contractorLegalEntity?.trim() ||
      item.department ||
      item.hours !== undefined ||
      item.directCost !== undefined ||
      item.taxAmount !== undefined ||
      (item.contractorTypes?.length ?? 0) > 0 ||
      item.taxUnknown ||
      item.amountIncludesTaxes ||
      item.amountExcludesTaxes ||
      item.validationSkipped,
  );
}

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
  specialists?: unknown[];
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
  const hasContractorSpecialists =
    normalizedCategory === "Конкурсное задание" &&
    (params.specialists ?? []).some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        normalizeContestSpecialistSource((item as { sourceType?: string }).sourceType) === "contractor" &&
        hasSpecialistContent(item),
    );
  if (hasContractorSpecialists) {
    roles.add("COO");
  }
  return Array.from(roles);
}
