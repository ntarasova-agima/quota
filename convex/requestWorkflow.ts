import {
  normalizeContestSpecialistSource,
  requiresContestSpecialistValidation,
} from "../src/lib/requestFields";
import { normalizeHodDepartment } from "../src/lib/departments";
import {
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  isHodSelectableCategory,
  normalizeRequestCategory,
  supportsRequestSpecialists,
} from "../src/lib/requestRules";
import {
  getAutoRequiredHodDepartmentsForRequest,
  getAutoRequiredRolesForRequest,
} from "../src/lib/approvalRules";

export type ApprovalEntryLike = {
  role: string;
  department?: string;
  status: "pending" | "approved" | "rejected";
};

export type SpecialistEntryLike = {
  sourceType?: string;
  contractorTypes?: string[];
  department?: string;
  directCost?: number;
  taxAmount?: number;
  taxUnknown?: boolean;
  amountIncludesTaxes?: boolean;
  amountExcludesTaxes?: boolean;
  hodConfirmed?: boolean;
  buhConfirmed?: boolean;
  validationSkipped?: boolean;
};

export function normalizeDepartmentList(departments: Array<string | undefined | null> = []): string[] {
  const normalized: string[] = [];
  for (const department of departments) {
    const value = normalizeHodDepartment(department);
    if (value) {
      normalized.push(value);
    }
  }
  return Array.from(new Set(normalized));
}

export function getRequiredSpecialistHodDepartments(
  specialists: SpecialistEntryLike[] = [],
) {
  const departments = specialists
    .filter((item) => normalizeContestSpecialistSource(item.sourceType) === "internal")
    .filter((item) => requiresContestSpecialistValidation(item))
    .map((item) => item.department);
  return normalizeDepartmentList(departments);
}

export function getEffectiveRequiredHodDepartments(params: {
  category: string;
  requiredRoles?: string[];
  requiredHodDepartments?: string[];
  specialists?: SpecialistEntryLike[];
}) {
  const normalizedCategory = normalizeRequestCategory(params.category);
  if (!isHodSelectableCategory(normalizedCategory)) {
    return [];
  }
  const includeManualHodDepartments = params.requiredRoles?.includes("HOD") ?? true;
  return normalizeDepartmentList([
    ...(includeManualHodDepartments ? params.requiredHodDepartments ?? [] : []),
    ...getAutoRequiredHodDepartmentsForRequest({
      category: normalizedCategory,
      specialists: params.specialists,
    }),
    ...(supportsRequestSpecialists(normalizedCategory)
      ? getRequiredSpecialistHodDepartments(params.specialists)
      : []),
  ]);
}

export function getEffectiveRequiredRoles(params: {
  requiredRoles: string[];
  requiredHodDepartments?: string[];
  category?: string;
  enforceFinanceRole?: boolean;
}) {
  const roles = new Set(params.requiredRoles);
  const normalizedCategory = normalizeRequestCategory(params.category ?? "");
  if (params.enforceFinanceRole !== false) {
    if (normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY) {
      roles.delete("BUH");
    }
    getAutoRequiredRolesForRequest({ category: normalizedCategory }).forEach((role) =>
      roles.add(role),
    );
  }
  if (!isHodSelectableCategory(normalizedCategory)) {
    roles.delete("HOD");
  } else if ((params.requiredHodDepartments?.length ?? 0) > 0) {
    roles.add("HOD");
  }
  return Array.from(roles);
}

export function getApprovalIdentity(approval: { role: string; department?: string }) {
  return approval.role === "HOD"
    ? `${approval.role}:${approval.department ?? ""}`
    : approval.role;
}

export function buildApprovalTargets(params: {
  requiredRoles: string[];
  requiredHodDepartments?: string[];
  category?: string;
  enforceFinanceRole?: boolean;
}) {
  const roles = getEffectiveRequiredRoles(params);
  const targets: Array<{ role: string; department?: string }> = [];
  for (const role of roles) {
    if (role === "HOD") {
      for (const department of normalizeDepartmentList(params.requiredHodDepartments)) {
        targets.push({ role, department });
      }
      continue;
    }
    targets.push({ role });
  }
  return targets;
}

export function getMandatoryApprovalTargets(params: {
  category: string;
  specialists?: SpecialistEntryLike[];
}) {
  const requiredHodDepartments = getEffectiveRequiredHodDepartments({
    category: params.category,
    requiredRoles: [],
    requiredHodDepartments: [],
    specialists: params.specialists,
  });
  return buildApprovalTargets({
    requiredRoles: [],
    requiredHodDepartments,
    category: params.category,
  });
}

export function isMandatoryApproval(
  request: { category: string; specialists?: SpecialistEntryLike[] },
  approval: { role: string; department?: string },
) {
  const approvalIdentity = getApprovalIdentity(approval);
  return getMandatoryApprovalTargets({
    category: request.category,
    specialists: request.specialists,
  }).some((target) => getApprovalIdentity(target) === approvalIdentity);
}

export function canDepartmentValidateSpecialist(
  specialist: SpecialistEntryLike,
  department: string,
) {
  const normalizedDepartment = normalizeHodDepartment(department);
  if (!normalizedDepartment || specialist.validationSkipped) {
    return false;
  }
  if (!requiresContestSpecialistValidation(specialist)) {
    return false;
  }
  if (
    normalizeContestSpecialistSource(specialist.sourceType) === "internal" &&
    normalizeHodDepartment(specialist.department) === normalizedDepartment
  ) {
    return true;
  }
  return false;
}

export function hasPendingSpecialistValidationForDepartment(
  request: { category: string; specialists?: SpecialistEntryLike[] },
  department: string,
) {
  if (!supportsRequestSpecialists(request.category)) {
    return false;
  }
  return (request.specialists ?? []).some(
    (item) =>
      canDepartmentValidateSpecialist(item, department) &&
      (!(item.hodConfirmed || item.buhConfirmed) || item.directCost === undefined),
  );
}

export function getPendingSpecialistValidationDepartments(
  request: {
    category: string;
    specialists?: SpecialistEntryLike[];
    requiredRoles?: string[];
    requiredHodDepartments?: string[];
  },
) {
  const relevantDepartments = getEffectiveRequiredHodDepartments({
    category: request.category,
    requiredRoles: request.requiredRoles,
    requiredHodDepartments: request.requiredHodDepartments,
    specialists: request.specialists,
  });
  return relevantDepartments.filter((department) =>
    hasPendingSpecialistValidationForDepartment(request, department),
  );
}

export function getRequestApprovalStatus(params: {
  category: string;
  specialists?: SpecialistEntryLike[];
  requiredRoles?: string[];
  requiredHodDepartments?: string[];
  approvals: ApprovalEntryLike[];
}) {
  if (params.approvals.some((approval) => approval.status === "rejected")) {
    return "rejected" as const;
  }
  if (
    supportsRequestSpecialists(params.category) &&
    getPendingSpecialistValidationDepartments({
      category: params.category,
      specialists: params.specialists,
      requiredRoles: params.requiredRoles,
      requiredHodDepartments: params.requiredHodDepartments,
    }).length > 0
  ) {
    return "hod_pending" as const;
  }
  if (params.approvals.length === 0) {
    return "approved" as const;
  }
  if (params.approvals.every((approval) => approval.status === "approved")) {
    return "approved" as const;
  }
  return "pending" as const;
}

export function canCategoryUseHodApproval(category: string) {
  const normalizedCategory = normalizeRequestCategory(category);
  return isHodSelectableCategory(normalizedCategory);
}
