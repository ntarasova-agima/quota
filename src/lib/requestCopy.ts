import {
  FUNDING_SOURCE_CODES,
  REQUEST_CATEGORY_CODES,
  type RequestArea,
} from "./constants";
import { normalizeHodDepartment } from "./departments";
import {
  AGIMA_QUOTAS_FUNDING_SOURCE,
  getCategoriesForDepartment,
  getDefaultFundingSourceForCategory,
  normalizeFundingSource,
  normalizeRequestCategory,
} from "./requestRules";

const REQUEST_CATEGORY_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(REQUEST_CATEGORY_CODES).map(([category, code]) => [code, category]),
);

const FUNDING_SOURCE_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(FUNDING_SOURCE_CODES).map(([fundingSource, code]) => [code, fundingSource]),
);

type CopyableRequestCoreFields = {
  category?: string | null;
  department?: string | null;
  fundingSource?: string | null;
  requestArea?: string | null;
  requestCode?: string | null;
};

function getRequestCodeParts(requestCode?: string | null) {
  const [categoryCode, fundingSourceCode] = (requestCode ?? "").split("_");
  return { categoryCode, fundingSourceCode };
}

function getCopiedRequestCategory(request: CopyableRequestCoreFields) {
  const rawCategory = request.category?.trim();
  if (rawCategory) {
    return normalizeRequestCategory(rawCategory);
  }

  const { categoryCode } = getRequestCodeParts(request.requestCode);
  return normalizeRequestCategory(REQUEST_CATEGORY_BY_CODE[categoryCode] ?? "");
}

function getCopiedRequestFundingSource(request: CopyableRequestCoreFields) {
  const rawFundingSource = request.fundingSource?.trim();
  if (rawFundingSource) {
    return normalizeFundingSource(rawFundingSource);
  }

  const { fundingSourceCode } = getRequestCodeParts(request.requestCode);
  return normalizeFundingSource(FUNDING_SOURCE_BY_CODE[fundingSourceCode] ?? "");
}

export function resolveCopiedRequestCoreFields(request: CopyableRequestCoreFields) {
  const department = (
    normalizeHodDepartment(request.department) ??
    normalizeHodDepartment(request.requestArea) ??
    "Аккаунтинг"
  ) as RequestArea;
  const fallbackCategory = getCategoriesForDepartment(department)[0] ?? "Закупка";
  const category = getCopiedRequestCategory(request) || fallbackCategory;
  const fundingSource =
    getCopiedRequestFundingSource(request) ||
    getDefaultFundingSourceForCategory(category) ||
    AGIMA_QUOTAS_FUNDING_SOURCE;

  return { category, department, fundingSource };
}
