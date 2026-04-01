export const ROLE_OPTIONS = ["NBD", "COO", "CFD"] as const;
export const ALL_ROLES = ["AD", "NBD", "COO", "CFD", "BUH", "HOD", "ADMIN"] as const;
export const ALL_ROLES_WITH_HOD = [
  "AD",
  "NBD",
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
  "Квота на AI-подписки",
  "Квота на внутренние затраты",
  "Я не знаю",
] as const;

export const EXPENSE_CATEGORIES = [
  "Welcome-бонус",
  "Подарки",
  "Конкурсное задание",
  "Закупка сервисов",
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
  "Закупка сервисов": "SV",
  "Неформальное мероприятие": "EV",
  "Совместный мерч": "MR",
};

export const FUNDING_SOURCE_CODES: Record<string, string> = {
  "Отгрузки проекта": "RP",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квота на AI-подписки": "QA",
  "Квота на внутренние затраты": "QI",
  "Я не знаю": "UN",
};

export type RoleOption = (typeof ALL_ROLES_WITH_HOD)[number];
export type HodDepartment = (typeof HOD_DEPARTMENTS)[number];
