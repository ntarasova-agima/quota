import {
  FINANCE_LEGAL_DEPARTMENT,
  normalizeHodDepartment,
} from "./departments";

type RoleRecordLike = {
  roles?: readonly string[] | null;
  hodDepartments?: readonly string[] | null;
} | null | undefined;

export const LEGACY_CFD_ROLE = "CFD";
export const FINANCE_HOD_LABEL = "Руководитель финансового отдела";

export function getNormalizedHodDepartments(record: RoleRecordLike) {
  const departments = (record?.hodDepartments ?? [])
    .map((department) => normalizeHodDepartment(department))
    .filter(
      (department): department is NonNullable<ReturnType<typeof normalizeHodDepartment>> =>
        Boolean(department),
    )
    .map((department) => String(department));
  return Array.from(new Set(departments));
}

export function hasFinanceDepartmentHod(record: RoleRecordLike) {
  return Boolean(
    record?.roles?.includes("HOD") &&
      getNormalizedHodDepartments(record).includes(FINANCE_LEGAL_DEPARTMENT),
  );
}

export function hasFinanceApproverRole(record: RoleRecordLike) {
  return Boolean(
    record?.roles?.includes(LEGACY_CFD_ROLE) ||
      hasFinanceDepartmentHod(record),
  );
}

export function hasAnyRole(record: RoleRecordLike, roles: readonly string[]) {
  return roles.some((role) =>
    role === LEGACY_CFD_ROLE
      ? hasFinanceApproverRole(record)
      : Boolean(record?.roles?.includes(role)),
  );
}

export function getActingHodDepartments(record: RoleRecordLike) {
  const departments = new Set(getNormalizedHodDepartments(record));
  if (hasFinanceApproverRole(record)) {
    departments.add(FINANCE_LEGAL_DEPARTMENT);
  }
  return Array.from(departments);
}

export function canActAsApprovalRole(
  record: RoleRecordLike,
  role: string,
  department?: string | null,
) {
  if (role === LEGACY_CFD_ROLE) {
    return hasFinanceApproverRole(record);
  }
  if (role !== "HOD") {
    return Boolean(record?.roles?.includes(role));
  }
  const normalizedDepartment = normalizeHodDepartment(department);
  return Boolean(
    normalizedDepartment &&
      getActingHodDepartments(record).includes(normalizedDepartment),
  );
}
