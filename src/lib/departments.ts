export const HOD_DEPARTMENTS = [
  "Разработка",
  "Маркетинг",
  "HR",
  "Проектирование и дизайн",
  "Продуктовая аналитика",
  "Производственный менеджмент",
  "Аутстафф",
  "Финансово-юридический отдел",
] as const;

export type HodDepartment = (typeof HOD_DEPARTMENTS)[number];

const LEGACY_DEPARTMENT_MAP: Record<string, HodDepartment> = {
  PHP: "Разработка",
  Frontend: "Разработка",
  Mobile: "Разработка",
  "Python/Node.js": "Разработка",
  PR: "Маркетинг",
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
