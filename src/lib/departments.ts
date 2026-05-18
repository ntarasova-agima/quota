export const FINANCE_LEGAL_DEPARTMENT = "Финансово-юридический отдел" as const;

export const HOD_DEPARTMENTS = [
  "Аккаунтинг",
  "AI RnD",
  "Администрация",
  "Разработка",
  "Маркетинг",
  "HR",
  "Отдел кадров",
  "Проектирование и дизайн",
  "Продуктовая аналитика",
  "Производственный менеджмент",
  "Outstaff",
  FINANCE_LEGAL_DEPARTMENT,
] as const;

export type HodDepartment = (typeof HOD_DEPARTMENTS)[number];

export const HOD_APPROVAL_DEPARTMENTS = HOD_DEPARTMENTS.filter(
  (department) => department !== FINANCE_LEGAL_DEPARTMENT,
);

const LEGACY_DEPARTMENT_MAP: Record<string, HodDepartment> = {
  Транзит: "Аккаунтинг",
  PHP: "Разработка",
  Frontend: "Разработка",
  Mobile: "Разработка",
  "Python/Node.js": "Разработка",
  PR: "Маркетинг",
  Аутстафф: "Outstaff",
  "Юр. отдел": "Финансово-юридический отдел",
  "Юридический отдел": "Финансово-юридический отдел",
};

export function normalizeHodDepartment(department?: string | null) {
  const trimmed = department?.trim();
  if (!trimmed) {
    return undefined;
  }
  return LEGACY_DEPARTMENT_MAP[trimmed] ?? trimmed;
}

export function isKnownHodDepartment(department?: string | null) {
  const normalized = normalizeHodDepartment(department);
  return Boolean(
    normalized &&
      HOD_DEPARTMENTS.includes(normalized as HodDepartment),
  );
}
