import { AI_TOOLS_REQUEST_CATEGORY, SERVICE_PURCHASE_CATEGORY } from "./requestRules";

export const ROLE_OPTIONS = ["NBD", "AI-BOSS", "COO", "CFD"] as const;
export const DEFAULT_REQUIRED_ROLES = ["NBD", "COO", "CFD"] as const;
export const ALL_ROLES = ["AD", "NBD", "AI-BOSS", "COO", "CFD", "BUH", "HOD", "ADMIN"] as const;
export const ALL_ROLES_WITH_HOD = [
  "AD",
  "NBD",
  "AI-BOSS",
  "COO",
  "CFD",
  "BUH",
  "HOD",
  "ADMIN",
] as const;

export const FUNDING_SOURCES = [
  "Отгрузки проекта",
  "Прибыль компании",
  "Квота на пресейлы",
  "Квоты на AI-инструменты",
  "Квота на внутренние затраты",
  "Я не знаю",
] as const;

export const EXPENSE_CATEGORIES = [
  "Welcome-бонус",
  "Подарки",
  "Конкурсное задание",
  SERVICE_PURCHASE_CATEGORY,
  AI_TOOLS_REQUEST_CATEGORY,
  "Неформальное мероприятие",
  "Совместный мерч",
] as const;

export const HOD_DEPARTMENTS = [
  "Проектирование и дизайн",
  "PHP",
  "Frontend",
  "Mobile",
  "Python/Node.js",
  "Продуктовая аналитика",
  "Маркетинг",
] as const;

export const CURRENCIES = ["RUB", "USD"] as const;

export const REQUEST_CATEGORY_CODES: Record<string, string> = {
  "Welcome-бонус": "WB",
  "Подарки": "GI",
  "Конкурсное задание": "CT",
  [SERVICE_PURCHASE_CATEGORY]: "SV",
  [AI_TOOLS_REQUEST_CATEGORY]: "AI",
  "Неформальное мероприятие": "EV",
  "Совместный мерч": "MR",
};

export const FUNDING_SOURCE_CODES: Record<string, string> = {
  "Отгрузки проекта": "RP",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квоты на AI-инструменты": "QT",
  "Квота на внутренние затраты": "QI",
  "Я не знаю": "UN",
};

export type RoleOption = (typeof ALL_ROLES_WITH_HOD)[number];
export type HodDepartment = (typeof HOD_DEPARTMENTS)[number];
