import { normalizeContestSpecialistSource, requiresContestSpecialistValidation } from "../src/lib/requestFields";
import {
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  isHodSelectableCategory,
  normalizeRequestCategory,
} from "../src/lib/requestRules";

export type ApprovalEntryLike = {
  role: string;
  department?: string;
  status: "pending" | "approved" | "rejected";
};

export type SpecialistEntryLike = {
  sourceType?: string;
  department?: string;
  directCost?: number;
  hodConfirmed?: boolean;
  validationSkipped?: boolean;
};

export function normalizeDepartmentList(departments: Array<string | undefined | null> = []) {
  return Array.from(
    new Set(
      departments
        .map((department) => department?.trim())
        .filter((department): department is string => Boolean(department)),
    ),
  );
}

export function getRequiredContestHodDepartments(
  specialists: SpecialistEntryLike[] = [],
) {
  return normalizeDepartmentList(
    specialists
      .filter((item) => normalizeContestSpecialistSource(item.sourceType) === "internal")
      .filter((item) => requiresContestSpecialistValidation(item))
      .map((item) => item.department),
  );
}

export function getEffectiveRequiredHodDepartments(params: {
  category: string;
  requiredHodDepartments?: string[];
  specialists?: SpecialistEntryLike[];
}) {
  const normalizedCategory = normalizeRequestCategory(params.category);
  if (!isHodSelectableCategory(normalizedCategory)) {
    return [];
  }
  return normalizeDepartmentList([
    ...(params.requiredHodDepartments ?? []),
    ...(normalizedCategory === "Конкурсное задание"
      ? getRequiredContestHodDepartments(params.specialists)
      : []),
  ]);
}

export function getEffectiveRequiredRoles(params: {
  requiredRoles: string[];
  requiredHodDepartments?: string[];
}) {
  const roles = new Set(params.requiredRoles);
  if ((params.requiredHodDepartments?.length ?? 0) > 0) {
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

export function hasPendingContestValidationForDepartment(
  request: { category: string; specialists?: SpecialistEntryLike[] },
  department: string,
) {
  if (normalizeRequestCategory(request.category) !== "Конкурсное задание") {
    return false;
  }
  return (request.specialists ?? []).some(
    (item) =>
      normalizeContestSpecialistSource(item.sourceType) === "internal" &&
      requiresContestSpecialistValidation(item) &&
      item.department === department &&
      (!item.hodConfirmed || item.directCost === undefined),
  );
}

export function getPendingContestValidationDepartments(
  request: { category: string; specialists?: SpecialistEntryLike[]; requiredHodDepartments?: string[] },
) {
  const relevantDepartments = getEffectiveRequiredHodDepartments({
    category: request.category,
    requiredHodDepartments: request.requiredHodDepartments,
    specialists: request.specialists,
  });
  return relevantDepartments.filter((department) =>
    hasPendingContestValidationForDepartment(request, department),
  );
}

export function getRequestApprovalStatus(params: {
  category: string;
  specialists?: SpecialistEntryLike[];
  requiredHodDepartments?: string[];
  approvals: ApprovalEntryLike[];
}) {
  if (params.approvals.some((approval) => approval.status === "rejected")) {
    return "rejected" as const;
  }
  if (
    normalizeRequestCategory(params.category) === "Конкурсное задание" &&
    getPendingContestValidationDepartments({
      category: params.category,
      specialists: params.specialists,
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
  return [
    "Конкурсное задание",
    CLIENT_SERVICES_TRANSIT_CATEGORY,
    SERVICE_PURCHASE_CATEGORY,
  ].includes(normalizedCategory);
}
