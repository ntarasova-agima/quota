import { normalizeContestSpecialistSource } from "./requestFields";
import {
  ACCOUNTING_REQUEST_AREA,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  PURCHASE_CATEGORY,
  normalizeRequestCategory,
} from "./requestRules";

type SpecialistLike = {
  sourceType?: string;
  contractorTypes?: string[];
  name?: string;
  department?: string;
  hours?: number | string;
  directCost?: number | string;
  taxAmount?: number | string;
  taxUnknown?: boolean;
  amountIncludesTaxes?: boolean;
  amountExcludesTaxes?: boolean;
  validationSkipped?: boolean;
};

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

function hasSpecialistContent(specialist: SpecialistLike) {
  return Boolean(
    specialist.name?.trim() ||
      specialist.department?.trim() ||
      specialist.contractorTypes?.length ||
      specialist.hours !== undefined ||
      specialist.directCost !== undefined ||
      specialist.taxAmount !== undefined ||
      specialist.taxUnknown ||
      specialist.amountIncludesTaxes ||
      specialist.amountExcludesTaxes ||
      specialist.validationSkipped,
  );
}

export function requestHasContractorSpecialists(specialists: SpecialistLike[] = []) {
  return specialists.some(
    (specialist) =>
      normalizeContestSpecialistSource(specialist.sourceType) === "contractor" &&
      hasSpecialistContent(specialist),
  );
}

export function requiresAccountingHodApproval(params: {
  category: string;
  specialists?: SpecialistLike[];
}) {
  const normalizedCategory = normalizeRequestCategory(params.category);
  return (
    ACCOUNTING_HOD_REQUIRED_CATEGORIES.includes(
      normalizedCategory as (typeof ACCOUNTING_HOD_REQUIRED_CATEGORIES)[number],
    ) ||
    requestHasContractorSpecialists(params.specialists)
  );
}

export function getAutoRequiredHodDepartmentsForRequest(params: {
  category: string;
  specialists?: SpecialistLike[];
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
