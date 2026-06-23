export const AI_TOOLS_FUNDING_SOURCE = "Квоты на AI-инструменты";
export const LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE = "Квота на AI-подписки";
export const INTERNAL_COSTS_FUNDING_SOURCE = "Квота на внутренние затраты";
export const PRESALES_FUNDING_SOURCE = "Квота на пресейлы";
export const PROJECT_REVENUE_FUNDING_SOURCE = "Отгрузки проекта";
export const COMPANY_PROFIT_FUNDING_SOURCE = "Прибыль компании";
export const AGIMA_QUOTAS_FUNDING_SOURCE = "Квоты AGIMA";
export const UNKNOWN_FUNDING_SOURCE = "Я не знаю";
export const LEGACY_SERVICE_PURCHASE_CATEGORY = "Закупка сервисов";
export const LEGACY_EXTENDED_SERVICE_PURCHASE_CATEGORY = "Закупки сервисов (кроме AI-инструментов)";
export const LEGACY_SHORT_SERVICE_PURCHASE_CATEGORY = "Закупки сервисов (кроме AI)";
export const SERVICE_PURCHASE_CATEGORY = "Внутренние закупки (кроме AI)";
export const LEGACY_AI_TOOLS_REQUEST_CATEGORY = "AI-инструмент\\подписка";
export const AI_TOOLS_REQUEST_CATEGORY = "AI-инструмент/подписка";
export const LEGACY_CLIENT_SERVICES_TRANSIT_CATEGORY = "Сервисы/транзиты для клиентов";
export const LEGACY_PROJECT_TRANSIT_CATEGORY = "Транзиты для проектов";
export const CLIENT_SERVICES_TRANSIT_CATEGORY = "Транзит";
export const PURCHASE_CATEGORY = "Закупка";
export const CONTRACTOR_PAYMENT_CATEGORY = "Оплата подрядчика";
export const ACCOUNTING_REQUEST_AREA = "Аккаунтинг";
export const ADMINISTRATION_REQUEST_AREA = "Администрация";
export const TRANSIT_TAG_NAME = "Транзит";

export const ACCOUNTING_REQUEST_CATEGORIES = [
  "Welcome-бонус",
  PURCHASE_CATEGORY,
  "Подарки",
  "Неформальное мероприятие",
  "Совместный мерч",
  "Конкурсное задание",
] as const;

export const ADMINISTRATION_REQUEST_CATEGORIES = [
  PURCHASE_CATEGORY,
] as const;

export const TRANSIT_REQUEST_CATEGORIES = [
  CLIENT_SERVICES_TRANSIT_CATEGORY,
] as const;

export const SPECIALIST_REQUEST_CATEGORIES = [
  "Конкурсное задание",
] as const;

export const NEW_FUNDING_SOURCES = [
  AGIMA_QUOTAS_FUNDING_SOURCE,
  PROJECT_REVENUE_FUNDING_SOURCE,
  UNKNOWN_FUNDING_SOURCE,
] as const;

export const EMPTY_BUSINESS_CATEGORY = "(Пусто)";
export const DEFAULT_BUSINESS_CATEGORIES = [
  EMPTY_BUSINESS_CATEGORY,
  "Закупки",
  "Офис",
  "Продажи",
  "Развитие",
  "Прочее",
  "Инвестиции",
  "Налоги",
] as const;

export function normalizeFundingSource(fundingSource: string) {
  if (
    [
      LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE,
      AI_TOOLS_FUNDING_SOURCE,
      INTERNAL_COSTS_FUNDING_SOURCE,
      PRESALES_FUNDING_SOURCE,
      COMPANY_PROFIT_FUNDING_SOURCE,
    ].includes(fundingSource)
  ) {
    return AGIMA_QUOTAS_FUNDING_SOURCE;
  }
  return fundingSource;
}

export function normalizeRequestCategory(category: string) {
  if (
    [
      LEGACY_SERVICE_PURCHASE_CATEGORY,
      LEGACY_EXTENDED_SERVICE_PURCHASE_CATEGORY,
      LEGACY_SHORT_SERVICE_PURCHASE_CATEGORY,
      SERVICE_PURCHASE_CATEGORY,
      CONTRACTOR_PAYMENT_CATEGORY,
    ].includes(category)
  ) {
    return PURCHASE_CATEGORY;
  }
  if (category === LEGACY_AI_TOOLS_REQUEST_CATEGORY || category === AI_TOOLS_REQUEST_CATEGORY) {
    return PURCHASE_CATEGORY;
  }
  if (category === LEGACY_CLIENT_SERVICES_TRANSIT_CATEGORY || category === LEGACY_PROJECT_TRANSIT_CATEGORY) {
    return CLIENT_SERVICES_TRANSIT_CATEGORY;
  }
  return category;
}

export function getRequestAreaForCategory(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  if (
    TRANSIT_REQUEST_CATEGORIES.includes(
      normalizedCategory as (typeof TRANSIT_REQUEST_CATEGORIES)[number],
    )
  ) {
    return ACCOUNTING_REQUEST_AREA;
  }
  if (
    ACCOUNTING_REQUEST_CATEGORIES.includes(
      normalizedCategory as (typeof ACCOUNTING_REQUEST_CATEGORIES)[number],
    )
  ) {
    return ACCOUNTING_REQUEST_AREA;
  }
  if (
    ADMINISTRATION_REQUEST_CATEGORIES.includes(
      normalizedCategory as (typeof ADMINISTRATION_REQUEST_CATEGORIES)[number],
    )
  ) {
    return ADMINISTRATION_REQUEST_AREA;
  }
  return ACCOUNTING_REQUEST_AREA;
}

export function isAdministrationRequestCategory(category: string) {
  return getRequestAreaForCategory(category) === ADMINISTRATION_REQUEST_AREA;
}

export function isAiToolsFundingSource(fundingSource: string) {
  return fundingSource === AI_TOOLS_FUNDING_SOURCE || fundingSource === LEGACY_AI_SUBSCRIPTIONS_FUNDING_SOURCE;
}

export function isAiToolsRequestCategory(category: string) {
  return category === AI_TOOLS_REQUEST_CATEGORY || category === LEGACY_AI_TOOLS_REQUEST_CATEGORY;
}

export function isServiceRecipientCategory(category: string) {
  return [
    LEGACY_SERVICE_PURCHASE_CATEGORY,
    LEGACY_EXTENDED_SERVICE_PURCHASE_CATEGORY,
    LEGACY_SHORT_SERVICE_PURCHASE_CATEGORY,
    SERVICE_PURCHASE_CATEGORY,
    AI_TOOLS_REQUEST_CATEGORY,
    LEGACY_AI_TOOLS_REQUEST_CATEGORY,
  ].includes(category);
}

export function usesServiceRecipientLabel(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  return normalizedCategory === PURCHASE_CATEGORY || isServiceRecipientCategory(category);
}

export function supportsRequestSpecialists(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  return SPECIALIST_REQUEST_CATEGORIES.includes(
    normalizedCategory as (typeof SPECIALIST_REQUEST_CATEGORIES)[number],
  );
}

export function isHodSelectableCategory(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  return [
    ...ACCOUNTING_REQUEST_CATEGORIES,
    ...ADMINISTRATION_REQUEST_CATEGORIES,
  ].includes(normalizedCategory as any);
}

export function getDefaultFundingSourceForCategory(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
    return PROJECT_REVENUE_FUNDING_SOURCE;
  }
  return AGIMA_QUOTAS_FUNDING_SOURCE;
}

export function getFundingOwnerRoles(fundingSource: string) {
  const normalizedFundingSource = normalizeFundingSource(fundingSource);
  void normalizedFundingSource;
  return [] as const;
}

export function getEnforcedRolesForFundingSource(fundingSource: string) {
  return Array.from(new Set(getFundingOwnerRoles(fundingSource)));
}

export function isFundingSourceAllowedForCategory(category: string, fundingSource: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  const normalizedFundingSource = normalizeFundingSource(fundingSource);
  if (normalizedFundingSource === UNKNOWN_FUNDING_SOURCE) {
    return true;
  }
  if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
    return normalizedFundingSource === PROJECT_REVENUE_FUNDING_SOURCE;
  }
  return NEW_FUNDING_SOURCES.includes(normalizedFundingSource as (typeof NEW_FUNDING_SOURCES)[number]);
}

export function getCategoriesForDepartment(department: string) {
  if (department === ACCOUNTING_REQUEST_AREA) {
    return [...ACCOUNTING_REQUEST_CATEGORIES, ...TRANSIT_REQUEST_CATEGORIES] as const;
  }
  return [...ADMINISTRATION_REQUEST_CATEGORIES, ...TRANSIT_REQUEST_CATEGORIES] as const;
}

export function getRequestAreaForDepartment(department?: string | null) {
  if (department === ACCOUNTING_REQUEST_AREA) {
    return ACCOUNTING_REQUEST_AREA;
  }
  return ADMINISTRATION_REQUEST_AREA;
}

export function isCategoryAllowedForDepartment(category: string, department?: string | null) {
  if (!department) {
    return false;
  }
  return (getCategoriesForDepartment(department) as readonly string[]).includes(
    normalizeRequestCategory(category),
  );
}

export function isAgimaQuotaFundingSource(fundingSource: string) {
  return normalizeFundingSource(fundingSource) === AGIMA_QUOTAS_FUNDING_SOURCE;
}

export function shouldSkipQuotaByTag(tag?: string | null) {
  return tag?.trim() === TRANSIT_TAG_NAME;
}
