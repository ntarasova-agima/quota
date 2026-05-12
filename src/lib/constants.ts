import {
  AGIMA_QUOTAS_FUNDING_SOURCE,
  AI_TOOLS_REQUEST_CATEGORY,
  ACCOUNTING_REQUEST_CATEGORIES,
  ADMINISTRATION_REQUEST_CATEGORIES,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  DEFAULT_BUSINESS_CATEGORIES,
  EMPTY_BUSINESS_CATEGORY,
  NEW_FUNDING_SOURCES,
  PURCHASE_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  getCategoriesForDepartment,
} from "./requestRules";
import { HOD_DEPARTMENTS, type HodDepartment } from "./departments";

export const ROLE_OPTIONS = ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "HOD"] as const;
export const DEFAULT_REQUIRED_ROLES = ["NBD", "COO", "CFD", "BUH"] as const;
export const ALL_ROLES = [
  "AD",
  "NBD",
  "AI-BOSS",
  "COO",
  "CFD",
  "BUH",
  "BUH Payment",
  "BUH Transit",
  "BUH Inside",
  "BUH Outsource",
  "HOD",
  "ADMIN",
] as const;
export const ALL_ROLES_WITH_HOD = [
  "AD",
  "NBD",
  "AI-BOSS",
  "COO",
  "CFD",
  "BUH",
  "BUH Payment",
  "BUH Transit",
  "BUH Inside",
  "BUH Outsource",
  "HOD",
  "ADMIN",
] as const;

export const FUNDING_SOURCES = [
  ...NEW_FUNDING_SOURCES,
] as const;

export const EXPENSE_CATEGORIES = [
  "Welcome-бонус",
  "Подарки",
  "Конкурсное задание",
  SERVICE_PURCHASE_CATEGORY,
  PURCHASE_CATEGORY,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  AI_TOOLS_REQUEST_CATEGORY,
  "Неформальное мероприятие",
  "Совместный мерч",
] as const;

export const REQUEST_AREAS = HOD_DEPARTMENTS;
export const REQUEST_CATEGORIES_BY_AREA = {
  Аккаунтинг: ACCOUNTING_REQUEST_CATEGORIES,
  Администрация: ADMINISTRATION_REQUEST_CATEGORIES,
} as const;

export const CURRENCIES = ["RUB", "USD"] as const;

export const REQUEST_CATEGORY_CODES: Record<string, string> = {
  "Welcome-бонус": "WB",
  "Подарки": "GI",
  "Конкурсное задание": "CT",
  [SERVICE_PURCHASE_CATEGORY]: "SV",
  [PURCHASE_CATEGORY]: "PU",
  [CLIENT_SERVICES_TRANSIT_CATEGORY]: "TR",
  [AI_TOOLS_REQUEST_CATEGORY]: "AI",
  "Неформальное мероприятие": "EV",
  "Совместный мерч": "MR",
};

export const FUNDING_SOURCE_CODES: Record<string, string> = {
  "Отгрузки проекта": "RP",
  [AGIMA_QUOTAS_FUNDING_SOURCE]: "QA",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квоты на AI-инструменты": "QT",
  "Квота на внутренние затраты": "QI",
  "Я не знаю": "UN",
};

export type RoleOption = (typeof ALL_ROLES_WITH_HOD)[number];
export { HOD_DEPARTMENTS, type HodDepartment };
export type RequestArea = (typeof REQUEST_AREAS)[number];
export { getCategoriesForDepartment };
export { DEFAULT_BUSINESS_CATEGORIES, EMPTY_BUSINESS_CATEGORY };
