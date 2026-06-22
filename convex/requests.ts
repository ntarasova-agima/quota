import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import {
  canManageViewerAccess,
  getRoleRecord,
  hasHistoricalApprovalAccess,
  hasHodAccessToRequest,
  hasSpecialBuhAccessToRequest,
  hasViewerAccess,
  requestHasInsideSpecialists,
  requestHasOutsourceSpecialists,
  upsertViewerAccessEntry,
  REQUEST_ALL_LIST_ROLES,
  REQUEST_WIDE_VIEW_ROLES,
} from "./requestAccessHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import {
  buildApprovalTargets,
  canCategoryUseHodApproval,
  getApprovalIdentity,
  getEffectiveRequiredHodDepartments,
  getEffectiveRequiredRoles,
  getMandatoryApprovalTargets,
  getRequestApprovalStatus,
  getRequiredSpecialistHodDepartments,
  normalizeDepartmentList,
} from "./requestWorkflow";
import {
  AGIMA_QUOTAS_FUNDING_SOURCE,
  ACCOUNTING_REQUEST_AREA,
  AI_TOOLS_REQUEST_CATEGORY,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  EMPTY_BUSINESS_CATEGORY,
  PURCHASE_CATEGORY,
  PROJECT_REVENUE_FUNDING_SOURCE,
  SERVICE_PURCHASE_CATEGORY,
  TRANSIT_TAG_NAME,
  UNKNOWN_FUNDING_SOURCE,
  getRequestAreaForDepartment,
  getFundingOwnerRoles,
  isAgimaQuotaFundingSource,
  isCategoryAllowedForDepartment,
  isFundingSourceAllowedForCategory,
  isHodSelectableCategory,
  isServiceRecipientCategory,
  normalizeFundingSource,
  normalizeRequestCategory,
  shouldSkipQuotaByTag,
  supportsRequestSpecialists,
  usesServiceRecipientLabel,
} from "../src/lib/requestRules";
import {
  isKnownHodDepartment,
  normalizeHodDepartment,
} from "../src/lib/departments";
import {
  calculateIncomingRatio,
  formatMonthKeyLabel,
  getPaymentMethodOptions,
  getSpecialistEffectiveCost,
  isPaidByDateAllowed,
  isContestSpecialistValidated,
  isPaidByTimestampAllowed,
  normalizeContestSpecialistSource,
  requiresContestSpecialistValidation,
} from "../src/lib/requestFields";
import { isAgimaEmail, normalizeEmail } from "../src/lib/authRules";
import { hasAnyRole, hasFinanceApproverRole } from "../src/lib/financeRole";
import {
  OPEN_PAYMENT_TASK_STATUSES,
  getPaymentTaskTimestamp,
  isOpenPaymentTask,
} from "../src/lib/requestStatus";
import {
  getAmountWithVat,
  normalizeVatRate,
  resolveVatAmounts,
} from "../src/lib/vat";

const roleEnum = v.union(
  v.literal("AD"),
  v.literal("NBD"),
  v.literal("AI-BOSS"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("BUH"),
  v.literal("BUH Payment"),
  v.literal("BUH Transit"),
  v.literal("BUH Inside"),
  v.literal("BUH Outsource"),
  v.literal("HOD"),
  v.literal("ADMIN"),
);

const requestStatus = v.union(
  v.literal("draft"),
  v.literal("hod_pending"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("awaiting_payment"),
  v.literal("payment_planned"),
  v.literal("partially_paid"),
  v.literal("paid"),
  v.literal("closed"),
);

const SPECIALIST_BUH_ROLES = ["BUH Inside", "BUH Outsource"] as const;
type SpecialistBuhRole = (typeof SPECIALIST_BUH_ROLES)[number];

const requestCategoryCodes: Record<string, string> = {
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

const fundingSourceCodes: Record<string, string> = {
  [PROJECT_REVENUE_FUNDING_SOURCE]: "RP",
  [AGIMA_QUOTAS_FUNDING_SOURCE]: "QA",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квоты на AI-инструменты": "QT",
  "Квота на внутренние затраты": "QI",
  [UNKNOWN_FUNDING_SOURCE]: "UN",
};

function getMonthKey(timestamp?: number) {
  if (!timestamp) {
    return undefined;
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(timestamp: number, days: number) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function addBusinessDays(timestamp: number, days: number) {
  const date = new Date(timestamp);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return date.getTime();
}

function isSameMonth(left?: number, right?: number) {
  return getMonthKey(left) === getMonthKey(right);
}

function startOfDate(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getMoscowDateParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function getMoscowTimeOnDate(timestamp: number, hour: number) {
  const { year, month, day } = getMoscowDateParts(timestamp);
  return Date.UTC(year, month - 1, day, hour - 3, 0, 0, 0);
}

function isBeforeDate(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return false;
  }
  return startOfDate(left) < startOfDate(right);
}

function getEarliestAllowedExpenseExpectation(now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return date.getTime();
}

function isExpenseExpectationDateAllowed(value?: number, now = Date.now()) {
  if (value === undefined) {
    return false;
  }
  return startOfDate(value) >= getEarliestAllowedExpenseExpectation(now);
}

function normalizeSpecialists(
  specialists: Array<{
    id: string;
    name: string;
    contractorLegalEntity?: string;
    sourceType?: string;
    contractorTypes?: string[];
    department?: string;
    hours?: number;
    directCost?: number;
    taxAmount?: number;
    taxUnknown?: boolean;
    amountIncludesTaxes?: boolean;
    amountExcludesTaxes?: boolean;
    hodConfirmed?: boolean;
    buhConfirmed?: boolean;
    validationSkipped?: boolean;
  }>,
) {
  const normalized = specialists
    .map((item) => ({
      id: item.id,
      name: item.name?.trim() ?? "",
      contractorLegalEntity: item.contractorLegalEntity?.trim() || undefined,
      sourceType: normalizeContestSpecialistSource(item.sourceType),
      contractorTypes: Array.from(
        new Set(
          (item.contractorTypes ?? [])
            .map((value) => value?.trim())
            .map((value) => (value === "другое" ? "другое/не знаю" : value))
            .filter(Boolean) as string[],
        ),
      ),
      department: normalizeHodDepartment(item.department),
      hours:
        typeof item.hours === "number" && Number.isFinite(item.hours)
          ? item.hours
          : undefined,
      directCost:
        typeof item.directCost === "number" && Number.isFinite(item.directCost)
          ? item.directCost
          : undefined,
      taxAmount:
        typeof item.taxAmount === "number" && Number.isFinite(item.taxAmount)
          ? item.taxAmount
          : undefined,
      taxUnknown: item.taxUnknown ?? false,
      amountIncludesTaxes: item.amountIncludesTaxes ?? false,
      amountExcludesTaxes: item.amountExcludesTaxes ?? false,
      hodConfirmed: item.validationSkipped ? true : item.hodConfirmed ?? false,
      buhConfirmed: item.validationSkipped ? true : item.buhConfirmed ?? false,
      validationSkipped: item.validationSkipped ?? false,
    }))
    .filter(
      (item) =>
        item.name ||
        item.contractorLegalEntity ||
        item.department ||
        item.hours !== undefined ||
        item.directCost !== undefined ||
        item.taxAmount !== undefined ||
        item.contractorTypes.length > 0 ||
        item.taxUnknown ||
        item.amountIncludesTaxes ||
        item.amountExcludesTaxes ||
        item.validationSkipped,
    );
  if (normalized.some((item) => item.amountIncludesTaxes && item.amountExcludesTaxes)) {
    throw new Error("Выберите только один вариант: сумма уже с налогами или сумма не включает налоги");
  }
  return normalized;
}

function hasContestSpecialists(
  specialists: Array<{
    name: string;
    contractorLegalEntity?: string;
    department?: string;
    hours?: number;
    directCost?: number;
    taxAmount?: number;
  }>,
) {
  return specialists.some(
    (item) =>
      item.name ||
      item.contractorLegalEntity ||
      item.department ||
      item.hours !== undefined ||
      item.directCost !== undefined ||
      item.taxAmount !== undefined,
  );
}

function requestHasSpecialists(request: { specialists?: Array<unknown> }) {
  return Boolean(request.specialists?.length);
}

function getSpecialistBuhRolesForRequest(request: { specialists?: Array<unknown> }) {
  const roles = new Set<SpecialistBuhRole>();
  if (requestHasInsideSpecialists(request)) {
    roles.add("BUH Inside");
  }
  if (requestHasOutsourceSpecialists(request)) {
    roles.add("BUH Outsource");
  }
  return Array.from(roles);
}

function hasContestDepartments(
  specialists: Array<{
    sourceType?: string;
    contractorTypes?: string[];
    department?: string;
    validationSkipped?: boolean;
  }>,
) {
  return specialists.some(
    (item) => requiresContestSpecialistValidation(item),
  );
}

function isDepartmentSpecialistReady(
  specialist: {
    department?: string;
    directCost?: number;
    hodConfirmed?: boolean;
    buhConfirmed?: boolean;
    validationSkipped?: boolean;
  },
) {
  return isContestSpecialistValidated(specialist);
}

function areContestDepartmentsValidated(
  specialists: Array<{
    sourceType?: string;
    contractorTypes?: string[];
    department?: string;
    directCost?: number;
    taxAmount?: number;
    hodConfirmed?: boolean;
    buhConfirmed?: boolean;
    validationSkipped?: boolean;
  }>,
) {
  const departmentalSpecialists = specialists.filter((item) =>
    requiresContestSpecialistValidation(item),
  );
  if (!departmentalSpecialists.length) {
    return true;
  }
  return departmentalSpecialists.every(isDepartmentSpecialistReady);
}

function calculateContestAmount(
  category: string,
  specialists: Array<{ directCost?: number; taxAmount?: number; amountIncludesTaxes?: boolean }> = [],
  fallbackAmount: number,
) {
  if (!supportsRequestSpecialists(category) || !hasContestSpecialists(specialists as any)) {
    return fallbackAmount;
  }
  return specialists.reduce(
    (sum, item) =>
      sum + getSpecialistEffectiveCost(item),
    0,
  );
}

function getApprovedReviewerEmails(approvals: any[]) {
  return Array.from(
    new Set(
      approvals
        .filter((approval) => approval.status === "approved" && approval.reviewerEmail)
        .map((approval) => approval.reviewerEmail),
    ),
  );
}

function getApprovedReviewerEmailsByRoles(approvals: any[], roles: string[]) {
  return Array.from(
    new Set(
      approvals
        .filter(
          (approval) =>
            approval.status === "approved" &&
            approval.reviewerEmail &&
            roles.includes(approval.role),
        )
        .map((approval) => approval.reviewerEmail),
    ),
  );
}

function getDecidedReviewerEmailsByRoles(approvals: any[], roles: string[]) {
  return Array.from(
    new Set(
      approvals
        .filter(
          (approval) =>
            ["approved", "rejected"].includes(approval.status) &&
            approval.reviewerEmail &&
            roles.includes(approval.role),
        )
        .map((approval) => approval.reviewerEmail),
    ),
  );
}

async function getActiveRoleEmails(ctx: { db: any }, roles: string[]): Promise<string[]> {
  if (!roles.length) {
    return [];
  }
  const roleDocs = await ctx.db.query("roles").collect();
  return Array.from(
    new Set(
      roleDocs
        .filter((doc: any) => doc.active && doc.roles.some((role: string) => roles.includes(role)))
        .map((doc: any) => doc.email),
    ),
  ) as string[];
}

async function getActiveAdminEmails(ctx: { db: any }, excludedEmails: string[] = []) {
  const excluded = new Set(excludedEmails.map((email) => email.trim().toLowerCase()));
  return (await getActiveRoleEmails(ctx, ["ADMIN"])).filter(
    (email) => !excluded.has(email.trim().toLowerCase()),
  );
}

async function getRoleNotificationRecipients(
  ctx: { db: any },
  approvals: any[],
  roles: string[],
  mode: "approved" | "decided",
  excludedEmails: string[] = [],
) {
  const recipients = new Set<string>();
  const excluded = new Set(excludedEmails.map((email) => email.trim().toLowerCase()));
  for (const role of roles) {
    const emails =
      mode === "approved"
        ? getApprovedReviewerEmailsByRoles(approvals, [role])
        : getDecidedReviewerEmailsByRoles(approvals, [role]);
    if (emails.length > 0) {
      emails
        .filter((email: string) => !excluded.has(email.trim().toLowerCase()))
        .forEach((email: string) => recipients.add(email));
      continue;
    }
    const fallback = await getActiveRoleEmails(ctx, [role]);
    if (fallback.length > 0) {
      fallback
        .filter((email) => !excluded.has(email.trim().toLowerCase()))
        .forEach((email: string) => recipients.add(email));
      continue;
    }
    const adminFallback = await getActiveAdminEmails(ctx, excludedEmails);
    adminFallback.forEach((email: string) => recipients.add(email));
  }
  return Array.from(recipients);
}

function normalizeFinplanIds(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function parseFinplanIdsInput(input: string) {
  return normalizeFinplanIds(input.split(/[\s,]+/));
}

function getUnifiedFinplanCostIds(request: {
  finplanEntryIds?: string[];
  finplanCostIds?: string[];
}) {
  return normalizeFinplanIds([
    ...(request.finplanEntryIds ?? []),
    ...(request.finplanCostIds ?? []),
  ]);
}

function isPositiveFinite(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function validateOptionalMoney(value: number | undefined, label: string) {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} должна быть неотрицательной`);
  }
  if (value > 10_000_000_000) {
    throw new Error(`${label} не может быть больше 10 миллиардов`);
  }
}

function validateOptionalRate(value: number | undefined) {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Курс валюты должен быть больше нуля");
  }
}

function validateOptionalVatRate(value: number | undefined) {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Ставка НДС должна быть от 0 до 100");
  }
}

function sumPaymentSplitAmounts(paymentSplits: Array<{ amountWithoutVat?: number }>) {
  return paymentSplits.reduce((sum, split) => sum + (split.amountWithoutVat ?? 0), 0);
}

function sumPaymentSplitAmountsWithVat(
  paymentSplits: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>,
  vatRate?: number,
) {
  return paymentSplits.reduce((sum, split) => {
    const resolved = resolveVatAmounts({
      amountWithoutVat: split.amountWithoutVat,
      amountWithVat: split.amountWithVat,
      vatRate: split.vatRate ?? vatRate,
      autoCalculateAmountWithVat: split.amountWithoutVat !== undefined && split.amountWithVat === undefined,
    });
    return sum + (resolved.amountWithVat ?? 0);
  }, 0);
}

const PAYMENT_EPSILON = 0.000001;

function isSamePaymentAmount(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return false;
  }
  return Math.abs(left - right) < PAYMENT_EPSILON;
}

function sumPlannedPaymentSplitAmounts(
  plannedPaymentSplits: Array<{ amountWithoutVat?: number }> = [],
) {
  return plannedPaymentSplits.reduce((sum, split) => sum + (split.amountWithoutVat ?? 0), 0);
}

function sumPlannedPaymentSplitAmountsWithVat(
  plannedPaymentSplits: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }> = [],
  vatRate?: number,
) {
  return plannedPaymentSplits.reduce((sum, split) => {
    const resolved = resolveVatAmounts({
      amountWithoutVat: split.amountWithoutVat,
      amountWithVat: split.amountWithVat,
      vatRate: split.vatRate ?? vatRate,
      autoCalculateAmountWithVat:
        split.amountWithoutVat !== undefined && split.amountWithVat === undefined,
    });
    return sum + (resolved.amountWithVat ?? 0);
  }, 0);
}

function getNextPaymentSplitNumber(request: {
  paymentSplits?: Array<{ splitNumber?: number }>;
  plannedPaymentSplits?: Array<{ splitNumber?: number }>;
}) {
  const numbers = [
    ...(request.paymentSplits ?? []).map((split) => split.splitNumber ?? 0),
    ...(request.plannedPaymentSplits ?? []).map((split) => split.splitNumber ?? 0),
  ];
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function archiveCurrentPlannedPayment(
  request: {
    paymentPlannedAt?: number;
    paymentPlannedByEmail?: string;
    paymentPlannedByName?: string;
    plannedPaymentAmount?: number;
    plannedPaymentAmountWithVat?: number;
    plannedPaymentSplits?: Array<any>;
    paymentSplits?: Array<any>;
    finplanEntryIds?: string[];
    finplanCostIds?: string[];
    vatRate?: number;
  },
  params: {
    actorEmail: string;
    actorName?: string;
    currencyRate?: number;
    now: number;
  },
) {
  const currentPlanned = resolvePaymentAmountInput({
    amountWithoutVat: request.plannedPaymentAmount,
    amountWithVat: request.plannedPaymentAmountWithVat,
    vatRate: request.vatRate,
  });
  if (!request.paymentPlannedAt || currentPlanned.amountWithoutVat === undefined) {
    return request.plannedPaymentSplits ?? [];
  }
  return [
    ...(request.plannedPaymentSplits ?? []),
    {
      splitNumber: getNextPaymentSplitNumber(request),
      amountWithoutVat: currentPlanned.amountWithoutVat,
      amountWithVat: currentPlanned.amountWithVat,
      vatRate: request.vatRate,
      currencyRate: params.currencyRate,
      plannedAt: request.paymentPlannedAt,
      finplanCostIds: getUnifiedFinplanCostIds(request).length
        ? getUnifiedFinplanCostIds(request)
        : undefined,
      actorEmail: request.paymentPlannedByEmail ?? params.actorEmail,
      actorName: request.paymentPlannedByName ?? params.actorName,
      createdAt: params.now,
    },
  ];
}

function scaleStoredVatAmount(
  amountWithVat: number | undefined,
  nextAmountWithoutVat: number,
  currentAmountWithoutVat: number,
  vatRate?: number,
) {
  if (amountWithVat !== undefined && currentAmountWithoutVat > PAYMENT_EPSILON) {
    return Number(((amountWithVat * nextAmountWithoutVat) / currentAmountWithoutVat).toFixed(6));
  }
  return resolvePaymentAmountInput({
    amountWithoutVat: nextAmountWithoutVat,
    vatRate,
  }).amountWithVat;
}

function consumePlannedPaymentQueue(
  request: {
    plannedPaymentSplits?: Array<any>;
    paymentPlannedAt?: number;
    plannedPaymentAmount?: number;
    plannedPaymentAmountWithVat?: number;
    vatRate?: number;
  },
  amountWithoutVat: number,
) {
  let remainingToConsume = amountWithoutVat;
  const nextPlannedPaymentSplits: Array<any> = [];

  for (const split of request.plannedPaymentSplits ?? []) {
    const resolved = resolvePaymentAmountInput({
      amountWithoutVat: split.amountWithoutVat,
      amountWithVat: split.amountWithVat,
      vatRate: split.vatRate ?? request.vatRate,
    });
    const splitAmount = resolved.amountWithoutVat ?? 0;
    if (splitAmount <= PAYMENT_EPSILON) {
      continue;
    }
    if (remainingToConsume <= PAYMENT_EPSILON) {
      nextPlannedPaymentSplits.push(split);
      continue;
    }
    if (splitAmount <= remainingToConsume + PAYMENT_EPSILON) {
      remainingToConsume -= splitAmount;
      continue;
    }
    const nextAmountWithoutVat = splitAmount - remainingToConsume;
    nextPlannedPaymentSplits.push({
      ...split,
      amountWithoutVat: nextAmountWithoutVat,
      amountWithVat: scaleStoredVatAmount(
        resolved.amountWithVat,
        nextAmountWithoutVat,
        splitAmount,
        split.vatRate ?? request.vatRate,
      ),
    });
    remainingToConsume = 0;
  }

  const currentPlanned = resolvePaymentAmountInput({
    amountWithoutVat: request.plannedPaymentAmount,
    amountWithVat: request.plannedPaymentAmountWithVat,
    vatRate: request.vatRate,
  });

  let nextPaymentPlannedAt = request.paymentPlannedAt;
  let nextPlannedPaymentAmount = currentPlanned.amountWithoutVat;
  let nextPlannedPaymentAmountWithVat = currentPlanned.amountWithVat;

  if (remainingToConsume > PAYMENT_EPSILON && currentPlanned.amountWithoutVat !== undefined) {
    if (currentPlanned.amountWithoutVat <= remainingToConsume + PAYMENT_EPSILON) {
      remainingToConsume -= currentPlanned.amountWithoutVat;
      nextPaymentPlannedAt = undefined;
      nextPlannedPaymentAmount = undefined;
      nextPlannedPaymentAmountWithVat = undefined;
    } else {
      const nextAmountWithoutVat = currentPlanned.amountWithoutVat - remainingToConsume;
      nextPlannedPaymentAmount = nextAmountWithoutVat;
      nextPlannedPaymentAmountWithVat = scaleStoredVatAmount(
        currentPlanned.amountWithVat,
        nextAmountWithoutVat,
        currentPlanned.amountWithoutVat,
        request.vatRate,
      );
      remainingToConsume = 0;
    }
  }

  return {
    plannedPaymentSplits: nextPlannedPaymentSplits,
    paymentPlannedAt: nextPaymentPlannedAt,
    plannedPaymentAmount: nextPlannedPaymentAmount,
    plannedPaymentAmountWithVat: nextPlannedPaymentAmountWithVat,
    unconsumedAmountWithoutVat: remainingToConsume,
  };
}

function hasExplicitPaymentAmountInput(params: {
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
}) {
  return params.actualPaidAmount !== undefined || params.actualPaidAmountWithVat !== undefined;
}

function resolvePaymentAmountInput(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  vatRate?: number;
}) {
  return resolveVatAmounts({
    amountWithoutVat: params.amountWithoutVat,
    amountWithVat: params.amountWithVat,
    vatRate: params.vatRate,
    autoCalculateAmountWithVat:
      params.amountWithoutVat !== undefined && params.amountWithVat === undefined,
  });
}

function resolveStoredPaymentAmountInput(request: {
  amount: number;
  amountWithVat?: number;
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  vatRate?: number;
}) {
  return resolvePaymentAmountInput({
    amountWithoutVat:
      request.paymentResidualAmount ??
      request.actualPaidAmount ??
      request.amount,
    amountWithVat:
      request.paymentResidualAmountWithVat ??
      request.actualPaidAmountWithVat ??
      request.amountWithVat,
    vatRate: request.vatRate,
  });
}

function getRequestPaymentTargetAmounts(request: {
  amount: number;
  amountWithVat?: number;
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  paymentSplits?: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>;
  vatRate?: number;
}) {
  const existingSplits = request.paymentSplits ?? [];
  const splitTotal = sumPaymentSplitAmounts(existingSplits);
  const splitTotalWithVat = sumPaymentSplitAmountsWithVat(existingSplits, request.vatRate);
  const remaining = resolvePaymentAmountInput({
    amountWithoutVat: request.paymentResidualAmount,
    amountWithVat: request.paymentResidualAmountWithVat,
    vatRate: request.vatRate,
  });
  if (remaining.amountWithoutVat !== undefined || remaining.amountWithVat !== undefined) {
    return {
      amountWithoutVat: splitTotal + (remaining.amountWithoutVat ?? 0),
      amountWithVat: splitTotalWithVat + (remaining.amountWithVat ?? 0),
    };
  }
  return resolveStoredPaymentAmountInput(request);
}

function getRequestPaymentRemainingAmounts(request: {
  amount: number;
  amountWithVat?: number;
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  paymentSplits?: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>;
  vatRate?: number;
}) {
  const residual = resolvePaymentAmountInput({
    amountWithoutVat: request.paymentResidualAmount,
    amountWithVat: request.paymentResidualAmountWithVat,
    vatRate: request.vatRate,
  });
  if (residual.amountWithoutVat !== undefined || residual.amountWithVat !== undefined) {
    return residual;
  }
  return getRequestPaymentTargetAmounts(request);
}

function hasPaymentAmountDifference(
  previous: { amountWithoutVat?: number; amountWithVat?: number },
  next: { amountWithoutVat?: number; amountWithVat?: number },
) {
  return (
    previous.amountWithoutVat !== next.amountWithoutVat ||
    previous.amountWithVat !== next.amountWithVat
  );
}

function getPaymentProgressStatus(params: {
  paidSplitsCount: number;
  hasPlannedPayments: boolean;
}) {
  if (params.paidSplitsCount > 0) {
    return "partially_paid" as const;
  }
  if (params.hasPlannedPayments) {
    return "payment_planned" as const;
  }
  return "awaiting_payment" as const;
}

function resolveRequestAmounts(
  params: {
    category: string;
    amount: number;
    amountWithVat?: number;
    vatRate?: number;
  },
  specialists: Array<{ directCost?: number; taxAmount?: number; amountIncludesTaxes?: boolean }> = [],
) {
  const amountWithoutVat = calculateContestAmount(
    params.category,
    specialists,
    params.amount,
  );
  const resolved = resolveVatAmounts({
    amountWithoutVat,
    amountWithVat: params.amountWithVat,
    vatRate: params.vatRate,
  });
  return {
    amount: resolved.amountWithoutVat ?? amountWithoutVat,
    amountWithVat: resolved.amountWithVat,
    vatRate: resolved.vatRate,
  };
}

async function getNextRequestCode(ctx: { db: any }, category: string, fundingSource: string) {
  const counterKey = "requests";
  const current = await ctx.db
    .query("requestCounters")
    .withIndex("by_key", (q: any) => q.eq("key", counterKey))
    .first();
  const nextNumber = current ? current.nextNumber : 1;
  const padded = String(nextNumber).padStart(5, "0");
  const categoryCode = requestCategoryCodes[category] ?? "OT";
  const sourceCode = fundingSourceCodes[fundingSource] ?? "UN";
  if (current) {
    await ctx.db.patch(current._id, {
      nextNumber: nextNumber + 1,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("requestCounters", {
      key: counterKey,
      nextNumber: nextNumber + 1,
      updatedAt: Date.now(),
    });
  }
  return `${categoryCode}_${sourceCode}_${padded}`;
}

const specialistValidator = v.object({
  id: v.string(),
  name: v.string(),
  contractorLegalEntity: v.optional(v.string()),
  sourceType: v.optional(v.string()),
  contractorTypes: v.optional(v.array(v.string())),
  department: v.optional(v.string()),
  hours: v.optional(v.number()),
  directCost: v.optional(v.number()),
  taxAmount: v.optional(v.number()),
  taxUnknown: v.optional(v.boolean()),
  amountIncludesTaxes: v.optional(v.boolean()),
  amountExcludesTaxes: v.optional(v.boolean()),
  hodConfirmed: v.optional(v.boolean()),
  buhConfirmed: v.optional(v.boolean()),
  validationSkipped: v.optional(v.boolean()),
});

const paymentDueFilterEnum = v.union(v.literal("today"), v.literal("overdue"));

const requestPayloadValidator = {
  requestArea: v.optional(v.string()),
  department: v.optional(v.string()),
  title: v.string(),
  category: v.string(),
  amount: v.number(),
  amountWithVat: v.optional(v.number()),
  vatRate: v.optional(v.number()),
  currency: v.string(),
  fundingSource: v.string(),
  counterparty: v.string(),
  paymentMethod: v.optional(v.string()),
  contractLink: v.optional(v.string()),
  pendingContractFileCount: v.optional(v.number()),
  dueDiligenceChecked: v.optional(v.boolean()),
  dueDiligenceJiraLink: v.optional(v.string()),
  prepaymentRequired: v.optional(v.boolean()),
  prepaymentAmount: v.optional(v.number()),
  prepaymentAmountWithVat: v.optional(v.number()),
  prepaymentDate: v.optional(v.number()),
  justification: v.string(),
  details: v.optional(v.string()),
  investmentReturn: v.optional(v.string()),
  clientName: v.string(),
  contacts: v.array(v.string()),
  relatedRequests: v.optional(v.array(v.string())),
  links: v.array(v.string()),
  financePlanLinks: v.optional(v.array(v.string())),
  finplanEntered: v.optional(v.boolean()),
  finplanEntryIds: v.optional(v.array(v.string())),
  incomingAmount: v.optional(v.number()),
  incomingAmountWithVat: v.optional(v.number()),
  shipmentDate: v.optional(v.number()),
  shipmentMonth: v.optional(v.string()),
  requiredHodDepartments: v.optional(v.array(v.string())),
  specialists: v.optional(v.array(specialistValidator)),
  approvalDeadline: v.optional(v.number()),
  neededBy: v.optional(v.number()),
  paymentDeadline: v.optional(v.number()),
  paidBy: v.optional(v.number()),
  requiredRoles: v.array(roleEnum),
  submit: v.boolean(),
};

const requestFieldLabels: Record<string, string> = {
  title: "На что нужен бюджет",
  category: "Тип заявки",
  businessCategory: "Категория",
  amount: "Сумма без НДС",
  amountWithVat: "Сумма с НДС",
  vatRate: "НДС",
  currency: "Валюта",
  fundingSource: "Источник финансирования",
  counterparty: "Кому платим мы (ЮЛ подрядчика/поставщика)",
  paymentMethod: "Способ оплаты",
  requestArea: "Тип направления",
  department: "Цех",
  contractLink: "Ссылка на договор",
  dueDiligenceChecked: "Проведена должная осмотрительность",
  dueDiligenceJiraLink: "Ссылка на задачу в Jira",
  prepaymentRequired: "Требуется предоплата",
  prepaymentAmount: "Предоплата без НДС",
  prepaymentAmountWithVat: "Предоплата с НДС",
  prepaymentDate: "Дата предоплаты",
  justification: "Обоснование",
  details: "Обоснование",
  investmentReturn: "Как будем возвращать инвестиции",
  clientName: "Клиент / получатель сервиса",
  relatedRequests: "Связанные заявки",
  links: "Ссылки на материалы",
  financePlanLinks: "ID отгрузки в Финплане",
  finplanEntered: "Занесено в финплан",
  finplanEntryIds: "ID затрат в Финплане",
  incomingAmount: "Сумма отгрузки без НДС",
  incomingAmountWithVat: "Сумма отгрузки с НДС",
  incomingRatio: "Коэффициент транзита",
  shipmentDate: "Дата отгрузки по проекту",
  shipmentMonth: "Дата отгрузки по проекту",
  requiredHodDepartments: "Руководители цехов",
  specialists: "Специалисты",
  approvalDeadline: "Дедлайн согласования",
  neededBy: "Дата отгрузки",
  paymentDeadline: "Дедлайн оплаты",
  paidBy: "Когда платят нам",
  requiredRoles: "Обязательные согласующие",
  status: "Статус заявки",
};

function formatValueForHistory(field: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    if (
      field === "approvalDeadline" ||
      field === "neededBy" ||
      field === "paymentDeadline" ||
      field === "paidBy" ||
      field === "shipmentDate" ||
      field === "prepaymentDate"
    ) {
      return new Date(value).toLocaleDateString("ru-RU");
    }
    return String(value);
  }
  if (typeof value === "string") {
    if (field === "shipmentMonth") {
      return formatMonthKeyLabel(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return undefined;
    }
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const specialist = item as any;
          const parts = [
            specialist.sourceType === "contractor"
              ? "Специалист подрядчика"
              : "Штатный специалист",
            specialist.name,
            specialist.contractorLegalEntity
              ? `ЮЛ ${specialist.contractorLegalEntity}`
              : undefined,
            specialist.contractorTypes?.length ? specialist.contractorTypes.join(", ") : undefined,
            specialist.department,
            specialist.hours !== undefined ? `${specialist.hours} ч` : undefined,
            specialist.directCost !== undefined ? `${specialist.directCost}` : undefined,
            specialist.taxAmount !== undefined ? `налоги ${specialist.taxAmount}` : undefined,
            specialist.taxUnknown ? "налоги не определены" : undefined,
            specialist.amountIncludesTaxes ? "сумма уже с налогами" : undefined,
            specialist.amountExcludesTaxes ? "сумма без налогов" : undefined,
            specialist.validationSkipped ? "валидация не требуется" : undefined,
            specialist.hodConfirmed ? "подтверждено HoD" : undefined,
            specialist.buhConfirmed ? "подтверждено BUH" : undefined,
          ].filter(Boolean);
          return parts.join(" / ");
        }
        return String(item);
      })
      .join("; ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

async function recordRequestChanges(
  ctx: { db: any },
  requestId: any,
  authorEmail: string,
  authorName: string | undefined,
  changes: Array<{ field: string; fromValue?: string; toValue?: string }>,
  options?: {
    groupId?: string;
    triggeredRepeatApproval?: boolean;
    groupSummary?: string;
  },
) {
  const createdAt = Date.now();
  for (const change of changes) {
    await ctx.db.insert("requestChangeLogs", {
      requestId,
      groupId: options?.groupId,
      field: change.field,
      fromValue: change.fromValue,
      toValue: change.toValue,
      authorEmail,
      authorName,
      triggeredRepeatApproval: options?.triggeredRepeatApproval,
      groupSummary: options?.groupSummary,
      createdAt,
    });
  }
}

function diffRequestFields(previous: any, next: any) {
  const fields = [
    "title",
    "category",
    "businessCategory",
    "requestArea",
    "department",
    "amount",
    "amountWithVat",
    "vatRate",
    "currency",
    "fundingSource",
    "counterparty",
    "paymentMethod",
    "contractLink",
    "dueDiligenceChecked",
    "dueDiligenceJiraLink",
    "prepaymentRequired",
    "prepaymentAmount",
    "prepaymentAmountWithVat",
    "prepaymentDate",
    "justification",
    "details",
    "investmentReturn",
    "clientName",
    "relatedRequests",
    "links",
    "financePlanLinks",
    "finplanEntered",
    "finplanEntryIds",
    "incomingAmount",
    "incomingAmountWithVat",
    "incomingRatio",
    "shipmentDate",
    "shipmentMonth",
    "requiredHodDepartments",
    "specialists",
    "approvalDeadline",
    "neededBy",
    "paymentDeadline",
    "paidBy",
    "requiredRoles",
    "status",
  ];
  return fields
    .map((field) => {
      const prevRaw = previous[field];
      const nextRaw = next[field];
      const prevSerialized = formatValueForHistory(field, prevRaw);
      const nextSerialized = formatValueForHistory(field, nextRaw);
      if (prevSerialized === nextSerialized) {
        return null;
      }
      return {
        field: requestFieldLabels[field] ?? field,
        fromValue: prevSerialized,
        toValue: nextSerialized,
      };
    })
    .filter(Boolean) as Array<{ field: string; fromValue?: string; toValue?: string }>;
}

function summarizeEditEffects(lines: string[]) {
  return lines.length ? lines.join(" ") : "Изменения сохранены.";
}

function buildEditImpact(previous: any, next: any, approvals: any[]) {
  const approvedReviewerEmails = getApprovedReviewerEmails(approvals);
  const removedRoles = previous.requiredRoles.filter((role: string) => !next.requiredRoles.includes(role));
  const addedRoles = next.requiredRoles.filter((role: string) => !previous.requiredRoles.includes(role));
  const oldFundingOwners = getFundingOwnerRoles(previous.fundingSource);
  const newFundingOwners = getFundingOwnerRoles(next.fundingSource);
  const oldMonthKey = getMonthKey(previous.approvalDeadline);
  const newMonthKey = getMonthKey(next.approvalDeadline);
  const amountChanged =
    previous.amount !== next.amount ||
    previous.amountWithVat !== next.amountWithVat;
  const fundingChanged = previous.fundingSource !== next.fundingSource;
  const categoryChanged = previous.category !== next.category;
  const counterpartyChanged = (previous.counterparty ?? "") !== (next.counterparty ?? "");
  const neededByChanged = previous.neededBy !== next.neededBy;
  const monthChanged = oldMonthKey !== newMonthKey;
  const hadApprovalProgress = approvals.some((item) => item.status !== "pending");

  const rolesToReset = new Set<string>();
  const notifyApprovedEmails = new Set<string>();
  const lines: string[] = [];
  const infoLines: string[] = [];
  let triggerRepeatApproval = false;

  if (amountChanged && hadApprovalProgress) {
    next.requiredRoles.forEach((role: string) => rolesToReset.add(role));
    triggerRepeatApproval = true;
    lines.push("Изменение суммы отправит заявку на повторное согласование.");
  }

  if (fundingChanged) {
    [...oldFundingOwners, ...newFundingOwners]
      .filter((role, index, source) => source.indexOf(role) === index)
      .forEach((role) => rolesToReset.add(role));
    if (previous.requiredRoles.includes("CFD") || next.requiredRoles.includes("CFD")) {
      rolesToReset.add("CFD");
    }
    triggerRepeatApproval = true;
    lines.push("Изменение источника финансирования сбросит согласование держателей квоты.");
  }

  if (monthChanged && !fundingChanged) {
    [...oldFundingOwners, ...newFundingOwners]
      .filter((role, index, source) => source.indexOf(role) === index)
      .forEach((role) => rolesToReset.add(role));
    if (rolesToReset.size > 0) {
      triggerRepeatApproval = true;
      lines.push("Смена месяца дедлайна согласования сбросит согласование держателей квоты.");
    }
  }

  if (addedRoles.length > 0) {
    triggerRepeatApproval = true;
    addedRoles.forEach((role: string) => rolesToReset.add(role));
    lines.push(`Новые согласующие: ${addedRoles.join(", ")}.`);
  }

  if (removedRoles.length > 0) {
    triggerRepeatApproval = true;
    lines.push(`Из маршрута будут убраны роли: ${removedRoles.join(", ")}.`);
  }

  if (categoryChanged && !fundingChanged) {
    infoLines.push("Изменение типа заявки не сбросит согласование, но уведомит уже согласовавших.");
    approvedReviewerEmails.forEach((email) => notifyApprovedEmails.add(email));
  }

  if (neededByChanged && previous.neededBy && next.neededBy && next.neededBy < previous.neededBy) {
    approvedReviewerEmails.forEach((email) => notifyApprovedEmails.add(email));
    infoLines.push("Более ранняя дата оплаты уведомит уже согласовавших.");
  }

  if (counterpartyChanged) {
    infoLines.push("Изменение контрагента не сбросит согласование, но уведомит BUH.");
  }

  const shouldAskForConfirmation =
    rolesToReset.size > 0 || removedRoles.length > 0 || addedRoles.length > 0;
  const routeChanged = rolesToReset.size > 0 || removedRoles.length > 0 || addedRoles.length > 0;

  return {
    amountChanged,
    fundingChanged,
    categoryChanged,
    counterpartyChanged,
    monthChanged,
    removedRoles,
    addedRoles,
    rolesToReset: Array.from(rolesToReset),
    notifyApprovedEmails: Array.from(notifyApprovedEmails),
    triggerRepeatApproval,
    routeChanged,
    shouldAskForConfirmation,
    confirmationLines: lines,
    infoLines,
  };
}

function getApprovalStatusFromEntries(approvals: any[]) {
  if (approvals.length === 0) {
    return "draft";
  }
  if (approvals.some((approval) => approval.status === "rejected")) {
    return "rejected";
  }
  if (approvals.every((approval) => approval.status === "approved")) {
    return "approved";
  }
  return "pending";
}

function validateRequestPayload(args: any) {
  const rawCategory = typeof args.category === "string" ? args.category.trim() : "";
  if (!rawCategory) {
    throw new Error("Выберите тип заявки");
  }
  const normalizedCategory = normalizeRequestCategory(rawCategory);
  const isWelcomeBonus = normalizedCategory === "Welcome-бонус";
  const normalizedDepartment = normalizeHodDepartment(args.department);
  const requestArea = getRequestAreaForDepartment(normalizedDepartment);
  const normalizedFundingSource = normalizeFundingSource(args.fundingSource);
  const normalizedSpecialists = normalizeSpecialists(args.specialists ?? []);
  const effectiveRequiredHodDepartments = getEffectiveRequiredHodDepartments({
    category: args.category,
    requiredRoles: args.requiredRoles,
    requiredHodDepartments: args.requiredHodDepartments,
    specialists: normalizedSpecialists,
  });
  const effectiveRequiredRoles = getEffectiveRequiredRoles({
    requiredRoles: args.requiredRoles as any,
    requiredHodDepartments: effectiveRequiredHodDepartments,
    category: normalizedCategory,
  });
  const requestWithSpecialists =
    supportsRequestSpecialists(args.category) && hasContestSpecialists(normalizedSpecialists);
  const allowedPaymentMethods = getPaymentMethodOptions(rawCategory);
  validateOptionalVatRate(args.vatRate);
  validateOptionalMoney(args.amount, "Сумма без НДС");
  validateOptionalMoney(args.amountWithVat, "Сумма с НДС");
  validateOptionalMoney(args.incomingAmount, "Сумма отгрузки без НДС");
  validateOptionalMoney(args.prepaymentAmount, "Предоплата без НДС");
  validateOptionalMoney(args.prepaymentAmountWithVat, "Предоплата с НДС");
  validateOptionalMoney(
    args.incomingAmountWithVat,
    "Сумма отгрузки с НДС",
  );
  const incomingAmounts = resolveVatAmounts({
    amountWithoutVat: args.incomingAmount,
    amountWithVat: args.incomingAmountWithVat,
    vatRate: args.vatRate,
    autoCalculateAmountWithVat: true,
  });
  const prepaymentAmounts = resolveVatAmounts({
    amountWithoutVat: args.prepaymentAmount,
    amountWithVat: args.prepaymentAmountWithVat,
    vatRate: args.vatRate,
    autoCalculateAmountWithVat: true,
  });
  const effectiveAmounts = resolveRequestAmounts(
    {
      category: normalizedCategory,
      amount: args.amount,
      amountWithVat: args.amountWithVat,
      vatRate: args.vatRate,
    },
    normalizedSpecialists,
  );
  const effectiveAmount = effectiveAmounts.amount;
  if (
    (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) &&
    !(requestWithSpecialists && effectiveAmount === 0)
  ) {
    throw new Error("Amount must be greater than 0");
  }
  if (
    effectiveAmounts.amountWithVat !== undefined &&
    effectiveAmounts.amountWithVat < effectiveAmount
  ) {
    throw new Error("Сумма с НДС не может быть меньше суммы без НДС");
  }
  if (
    incomingAmounts.amountWithoutVat !== undefined &&
    incomingAmounts.amountWithoutVat <= 0
  ) {
    throw new Error("Сумма отгрузки должна быть больше 0");
  }
  if (
    incomingAmounts.amountWithVat !== undefined &&
    incomingAmounts.amountWithVat <= 0
  ) {
    throw new Error("Сумма отгрузки должна быть больше 0");
  }
  if (
    incomingAmounts.amountWithoutVat !== undefined &&
    incomingAmounts.amountWithVat !== undefined &&
    incomingAmounts.amountWithVat < incomingAmounts.amountWithoutVat
  ) {
    throw new Error("Сумма отгрузки с НДС не может быть меньше суммы без НДС");
  }
  if (!args.title.trim()) {
    throw new Error("Название заявки обязательно");
  }
  if (!normalizedDepartment) {
    throw new Error("Укажите цех");
  }
  if (!isKnownHodDepartment(normalizedDepartment)) {
    throw new Error("Так не бывает");
  }
  if (args.requestArea && args.requestArea !== requestArea && args.requestArea !== normalizedDepartment) {
    throw new Error("Так не бывает");
  }
  if (!isCategoryAllowedForDepartment(normalizedCategory, normalizedDepartment)) {
    throw new Error("Так не бывает");
  }
  if (
    !isWelcomeBonus &&
    args.category !== "Конкурсное задание" &&
    !args.paymentMethod
  ) {
    throw new Error("Укажите способ оплаты");
  }
  if (
    args.paymentMethod &&
    !allowedPaymentMethods.includes(args.paymentMethod as (typeof allowedPaymentMethods)[number])
  ) {
    throw new Error("Так не бывает");
  }
  if (!args.justification || !args.justification.trim()) {
    throw new Error("Обоснование обязательно");
  }
  if (!args.approvalDeadline) {
    throw new Error("Укажите дедлайн согласования");
  }
  if (!isWelcomeBonus && !args.neededBy) {
    throw new Error("Укажите дату отгрузки");
  }
  if (!isWelcomeBonus && !args.paymentDeadline) {
    throw new Error("Укажите дедлайн оплаты");
  }
  if (!isFundingSourceAllowedForCategory(normalizedCategory, normalizedFundingSource)) {
    throw new Error("Так не бывает");
  }
  if (args.approvalDeadline !== undefined) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (args.approvalDeadline < tomorrow.getTime()) {
      throw new Error("Дедлайн согласования должен быть не раньше завтрашнего дня");
    }
  }
  if (args.paidBy !== undefined && !isPaidByTimestampAllowed(args.paidBy)) {
    throw new Error("AGIMA тогда еще не было");
  }
  if (
    args.prepaymentRequired &&
    (
      prepaymentAmounts.amountWithoutVat === undefined ||
      prepaymentAmounts.amountWithVat === undefined ||
      prepaymentAmounts.amountWithoutVat <= 0 ||
      prepaymentAmounts.amountWithVat <= 0 ||
      args.prepaymentDate === undefined
    )
  ) {
    throw new Error("Укажите сумму и дату предоплаты");
  }
  if (
    prepaymentAmounts.amountWithoutVat !== undefined &&
    prepaymentAmounts.amountWithVat !== undefined &&
    prepaymentAmounts.amountWithVat < prepaymentAmounts.amountWithoutVat
  ) {
    throw new Error("Предоплата с НДС не может быть меньше суммы без НДС");
  }
  if (
    args.shipmentDate !== undefined &&
    (!Number.isFinite(args.shipmentDate) || args.shipmentDate <= 0)
  ) {
    throw new Error("Укажите дату отгрузки");
  }
  if (
    args.shipmentMonth !== undefined &&
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.shipmentMonth)
  ) {
    throw new Error("Укажите дату отгрузки");
  }
  if (
    normalizedFundingSource === PROJECT_REVENUE_FUNDING_SOURCE &&
    (!args.financePlanLinks || args.financePlanLinks.length === 0)
  ) {
    throw new Error("ID отгрузки в Финплане обязателен для отгрузок проекта");
  }
  if (
    normalizedFundingSource === PROJECT_REVENUE_FUNDING_SOURCE &&
    (incomingAmounts.amountWithoutVat === undefined || incomingAmounts.amountWithVat === undefined)
  ) {
    throw new Error("Укажите сумму отгрузки");
  }
  if (effectiveRequiredHodDepartments.length > 0 && !canCategoryUseHodApproval(args.category)) {
    throw new Error("Так не бывает");
  }
  if (
    effectiveRequiredRoles.includes("HOD") &&
    !effectiveRequiredHodDepartments.length &&
    isHodSelectableCategory(args.category)
  ) {
    throw new Error("Укажите цех для руководителя");
  }
  if (
    args.requiredRoles.includes("HOD") &&
    !isHodSelectableCategory(args.category)
  ) {
    throw new Error("Так не бывает");
  }
  if (
    normalizedCategory === CLIENT_SERVICES_TRANSIT_CATEGORY &&
    !effectiveRequiredRoles.includes("BUH Transit")
  ) {
    throw new Error("Для транзитов обязателен BUH Transit");
  }
  if (isWelcomeBonus && (!args.investmentReturn || !args.investmentReturn.trim())) {
    throw new Error("Укажите, как будем возвращать инвестиции");
  }
  if (usesServiceRecipientLabel(args.category) && (!args.clientName || !args.clientName.trim())) {
    throw new Error("Укажите получателя сервиса");
  }
  if (
    effectiveAmount > 100_000 &&
    normalizedCategory !== "Welcome-бонус" &&
    normalizedCategory !== "Конкурсное задание" &&
    !args.contractLink?.trim() &&
    (args.pendingContractFileCount ?? args.existingContractAttachmentCount ?? 0) <= 0
  ) {
    throw new Error("Для суммы больше 100 000 нужен договор с контрагентом");
  }
  if (
    effectiveAmount > 500_000 &&
    normalizedCategory !== "Welcome-бонус" &&
    normalizedCategory !== "Конкурсное задание" &&
    (!args.dueDiligenceChecked || !args.dueDiligenceJiraLink?.trim())
  ) {
    throw new Error("Проведите должную осмотрительность и укажите ссылку на Jira");
  }
}

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { start: start.getTime(), end: end.getTime() };
}

async function loadRequestsForAllList(
  ctx: any,
  args: {
    status?: string;
    statuses?: string[];
    createdByEmail?: string;
    paymentDueFilter?: "today" | "overdue";
  },
) {
  const statusSet = args.statuses?.length
    ? Array.from(new Set(args.statuses))
    : args.status
      ? [args.status]
      : [];

  if (args.createdByEmail) {
    return await ctx.db
      .query("requests")
      .withIndex("by_createdByEmail", (q: any) => q.eq("createdByEmail", args.createdByEmail))
      .collect();
  }

  if (statusSet.length > 0) {
    return (
      await Promise.all(
        statusSet.map((status) =>
          ctx.db
            .query("requests")
            .withIndex("by_status", (q: any) => q.eq("status", status))
            .collect(),
        ),
      )
    ).flat();
  }

  if (args.paymentDueFilter) {
    return (
      await Promise.all(
        OPEN_PAYMENT_TASK_STATUSES.map((status) =>
          ctx.db
            .query("requests")
            .withIndex("by_status", (q: any) => q.eq("status", status as any))
            .collect(),
        ),
      )
    ).flat();
  }

  return await ctx.db.query("requests").collect();
}

function normalizeBusinessCategory(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === EMPTY_BUSINESS_CATEGORY) {
    return undefined;
  }
  return trimmed;
}

function matchesBusinessCategoryFilter(request: any, filter?: string) {
  if (filter === undefined) {
    return true;
  }
  return normalizeBusinessCategory(request.businessCategory) === normalizeBusinessCategory(filter);
}

function getRequestPaymentDeadline(request: { paymentDeadline?: number; neededBy?: number }) {
  return request.paymentDeadline ?? request.neededBy;
}

async function schedulePaymentDeadlineReminders(ctx: any, requestId: any, paymentDeadline?: number) {
  if (!paymentDeadline) {
    return;
  }
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  await ctx.scheduler.runAfter(
    Math.max(0, startOfDate(paymentDeadline) - dayMs - now),
    internal.emails.sendPaymentDeadlineReminder,
    {
      requestId,
      paymentDeadline,
      reminderKind: "before",
    },
  );
  await ctx.scheduler.runAfter(
    Math.max(0, startOfDate(paymentDeadline) + dayMs - now),
    internal.emails.sendPaymentDeadlineReminder,
    {
      requestId,
      paymentDeadline,
      reminderKind: "overdue",
    },
  );
}

async function sendPaymentPlanningRequestedAndScheduleReminders(
  ctx: any,
  request: { _id: any; paymentDeadline?: number; neededBy?: number },
) {
  await ctx.scheduler.runAfter(0, internal.emails.sendPaymentPlanningRequested, {
    requestId: request._id,
  });
  await schedulePaymentDeadlineReminders(ctx, request._id, getRequestPaymentDeadline(request));
}

async function schedulePlannedPaymentReminder(ctx: any, requestId: any, paymentPlannedAt?: number) {
  if (!paymentPlannedAt) {
    return;
  }
  await ctx.scheduler.runAfter(
    Math.max(0, getMoscowTimeOnDate(paymentPlannedAt, 9) - Date.now()),
    internal.emails.sendPlannedPaymentReminder,
    {
      requestId,
      paymentPlannedAt,
    },
  );
}

function validateQuotaResolutionBeforePayment(request: {
  fundingSource: string;
  cfdTag?: string;
}) {
  const fundingSource = normalizeFundingSource(request.fundingSource);
  if (fundingSource === UNKNOWN_FUNDING_SOURCE) {
    throw new Error("Укажите источник финансирования");
  }
  if (
    isAgimaQuotaFundingSource(fundingSource) &&
    !shouldSkipQuotaByTag(request.cfdTag) &&
    !request.cfdTag?.trim()
  ) {
    throw new Error("Укажите тег квоты");
  }
}

async function createApprovalsForRequest(
  ctx: { db: any },
  params: {
    requestId: any;
    requiredRoles: string[];
    requiredHodDepartments?: string[];
    category?: string;
    autoApprovedRoles: string[];
    now: number;
    userId: any;
    email: string;
  },
) {
  const targets = buildApprovalTargets({
    requiredRoles: params.requiredRoles,
    requiredHodDepartments: params.requiredHodDepartments,
    category: params.category,
  });
  for (const target of targets) {
    const isAutoApproved =
      target.role !== "HOD" && params.autoApprovedRoles.includes(target.role);
    await ctx.db.insert("approvals", {
      requestId: params.requestId,
      role: target.role as any,
      department: target.department,
      status: isAutoApproved ? "approved" : "pending",
      decidedAt: isAutoApproved ? params.now : undefined,
      reviewerId: isAutoApproved ? params.userId : undefined,
      reviewerEmail: isAutoApproved ? params.email : undefined,
    });
  }
  const pendingTargets = targets.filter(
    (target) => target.role === "HOD" || !params.autoApprovedRoles.includes(target.role),
  );
  return pendingTargets.length === 0 ? "approved" : "pending";
}

export const listMyRequests = query({
  args: {
    status: v.optional(requestStatus),
    category: v.optional(v.string()),
    businessCategory: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    createdFrom: v.optional(v.number()),
    createdTo: v.optional(v.number()),
    requestCodeQuery: v.optional(v.string()),
    hasSpecialists: v.optional(v.boolean()),
    sort: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const baseQuery = ctx.db
      .query("requests")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId));
    const byUserId = args.status
      ? await baseQuery
          .filter((q) => q.eq(q.field("status"), args.status))
          .order("desc")
          .collect()
      : await baseQuery.order("desc").collect();
    const emailQuery = ctx.db
      .query("requests")
      .withIndex("by_createdByEmail", (q) => q.eq("createdByEmail", email));
    const byEmail = args.status
      ? await emailQuery
          .filter((q) => q.eq(q.field("status"), args.status))
          .order("desc")
          .collect()
      : await emailQuery.order("desc").collect();
    const merged = new Map<string, any>();
    for (const request of [...byUserId, ...byEmail]) {
      merged.set(request._id, request);
    }
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const hasExplicitDateRange = args.createdFrom !== undefined || args.createdTo !== undefined;
    const filteredRequests = Array.from(merged.values()).filter((request) => {
      if (
        args.category &&
        normalizeRequestCategory(request.category) !== normalizeRequestCategory(args.category)
      ) {
        return false;
      }
      if (args.fundingSource && request.fundingSource !== args.fundingSource) {
        return false;
      }
      if (!matchesBusinessCategoryFilter(request, args.businessCategory)) {
        return false;
      }
      if (args.createdFrom && request.createdAt < args.createdFrom) {
        return false;
      }
      if (args.createdTo && request.createdAt > args.createdTo) {
        return false;
      }
      if (
        args.requestCodeQuery &&
        !(request.requestCode ?? "").toLowerCase().includes(args.requestCodeQuery.trim().toLowerCase())
      ) {
        return false;
      }
      if (args.hasSpecialists === true && !requestHasSpecialists(request)) {
        return false;
      }
      if (!hasExplicitDateRange && (request.archivedAt || request.createdAt < oneYearAgo)) {
        return false;
      }
      return true;
    });
    const results = [];
    for (const request of filteredRequests) {
      const approvals = await ctx.db
        .query("approvals")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      results.push({ request, approvals });
    }
    const sort = args.sort ?? "created_desc";
    results.sort((a, b) => {
      if (sort === "updated_desc") return b.request.updatedAt - a.request.updatedAt;
      if (sort === "updated_asc") return a.request.updatedAt - b.request.updatedAt;
      if (sort === "created_asc") return a.request.createdAt - b.request.createdAt;
      if (sort === "business_category_asc") {
        return (a.request.businessCategory ?? "").localeCompare(b.request.businessCategory ?? "", "ru");
      }
      if (sort === "business_category_desc") {
        return (b.request.businessCategory ?? "").localeCompare(a.request.businessCategory ?? "", "ru");
      }
      if (sort === "deadline_asc") return (a.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER) - (b.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER);
      if (sort === "deadline_desc") return (b.request.approvalDeadline ?? 0) - (a.request.approvalDeadline ?? 0);
      return b.request.createdAt - a.request.createdAt;
    });
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 20, 100));
    const page = Math.max(1, args.page ?? 1);
    const totalCount = results.length;
    const start = (page - 1) * pageSize;
    return {
      items: results.slice(start, start + pageSize),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    };
  },
});

export const listAllRequests = query({
  args: {
    status: v.optional(requestStatus),
    statuses: v.optional(v.array(requestStatus)),
    createdByEmail: v.optional(v.string()),
    cfdTag: v.optional(v.string()),
    category: v.optional(v.string()),
    businessCategory: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    paymentDueFilter: v.optional(paymentDueFilterEnum),
    createdFrom: v.optional(v.number()),
    createdTo: v.optional(v.number()),
    requestCodeQuery: v.optional(v.string()),
    hasSpecialists: v.optional(v.boolean()),
    sort: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const canViewAll =
      record?.roles?.some((role: string) =>
        REQUEST_ALL_LIST_ROLES.includes(role as (typeof REQUEST_ALL_LIST_ROLES)[number]),
      ) || hasFinanceApproverRole(record);
    const hasSpecialBuhListAccess = Boolean(
      record?.roles?.some((role: string) => ["BUH Payment", "BUH Inside", "BUH Outsource"].includes(role)),
    );
    const hasReviewedAny = email
      ? (
          await ctx.db
            .query("approvals")
            .filter((q: any) => q.eq(q.field("reviewerEmail"), email))
            .take(1)
        ).length > 0
      : false;
    const hasExplicitViewerAccessAny =
      !canViewAll && !hasReviewedAny
        ? (await ctx.db.query("requests").collect()).some((req: any) => hasViewerAccess(req, email))
        : false;
    if (!canViewAll && !hasSpecialBuhListAccess && !hasReviewedAny && !hasExplicitViewerAccessAny) {
      throw new Error("Not authorized");
    }

    const statusSet = args.statuses?.length
      ? new Set(args.statuses)
      : args.status
        ? new Set([args.status])
        : undefined;
    const candidateRequests = await loadRequestsForAllList(ctx, {
      status: args.status,
      statuses: args.statuses,
      createdByEmail: args.createdByEmail,
      paymentDueFilter: args.paymentDueFilter,
    });
    const requests = statusSet
      ? candidateRequests.filter((req: any) => statusSet.has(req.status))
      : candidateRequests;
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const hasExplicitDateRange = args.createdFrom !== undefined || args.createdTo !== undefined;
    const todayBounds = getTodayBounds();
    const filtered = requests.filter((req: any) => {
      if (args.createdByEmail && req.createdByEmail !== args.createdByEmail) {
        return false;
      }
      if (
        args.category &&
        normalizeRequestCategory(req.category) !== normalizeRequestCategory(args.category)
      ) {
        return false;
      }
      if (args.fundingSource && req.fundingSource !== args.fundingSource) {
        return false;
      }
      if (!matchesBusinessCategoryFilter(req, args.businessCategory)) {
        return false;
      }
      if (args.createdFrom && req.createdAt < args.createdFrom) {
        return false;
      }
      if (args.createdTo && req.createdAt > args.createdTo) {
        return false;
      }
      if (
        args.requestCodeQuery &&
        !(req.requestCode ?? "").toLowerCase().includes(args.requestCodeQuery.trim().toLowerCase())
      ) {
        return false;
      }
      if (args.hasSpecialists === true && !requestHasSpecialists(req)) {
        return false;
      }
      if (args.paymentDueFilter === "today") {
        const paymentTaskAt = getPaymentTaskTimestamp(req);
        if (
          !isOpenPaymentTask(req) ||
          paymentTaskAt! < todayBounds.start ||
          paymentTaskAt! > todayBounds.end
        ) {
          return false;
        }
      }
      if (args.paymentDueFilter === "overdue") {
        const paymentTaskAt = getPaymentTaskTimestamp(req);
        if (!isOpenPaymentTask(req) || paymentTaskAt! >= todayBounds.start) {
          return false;
        }
      }
      if (!canViewAll && !hasExplicitDateRange && (req.archivedAt || req.createdAt < oneYearAgo)) {
        return false;
      }
      return true;
    });
    const scopedToSpecialBuhRole =
      !canViewAll && hasSpecialBuhListAccess
        ? filtered.filter((req: any) => hasSpecialBuhAccessToRequest(record, req))
        : [];
    const scopedToCurrentRole =
      record?.roles?.includes("HOD") &&
      !hasAnyRole(record, ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN"])
        ? filtered.filter((req: any) => hasHodAccessToRequest(record, req))
        : canViewAll
          ? filtered
          : [];
    const withHistorical = canViewAll
      ? scopedToCurrentRole
      : hasReviewedAny
      ? [
          ...scopedToCurrentRole,
          ...filtered.filter((req: any) => req.createdBy === userId || req.createdByEmail === email),
          ...(
            await Promise.all(
              filtered.map(async (req: any) =>
                (await hasHistoricalApprovalAccess(ctx, req._id, email)) ? req : null,
              ),
            )
          ).filter((req): req is any => Boolean(req)),
        ]
      : scopedToCurrentRole;
    const withViewerAccess = [
      ...withHistorical,
      ...scopedToSpecialBuhRole,
      ...filtered.filter((req: any) => hasViewerAccess(req, email)),
      ...filtered.filter((req: any) => req.createdBy === userId || req.createdByEmail === email),
    ];
    const deduped = Array.from(new Map(withViewerAccess.map((req) => [req._id, req])).values());
    const filteredByTag =
      args.cfdTag === undefined
        ? deduped
        : args.cfdTag === ""
          ? deduped.filter((req) => !req.cfdTag)
          : deduped.filter((req) => req.cfdTag === args.cfdTag);
    const results = [];
    for (const request of filteredByTag) {
      const approvals = await ctx.db
        .query("approvals")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      results.push({ request, approvals });
    }
    const sort = args.sort ?? "created_desc";
    results.sort((a, b) => {
      if (sort === "updated_desc") return b.request.updatedAt - a.request.updatedAt;
      if (sort === "updated_asc") return a.request.updatedAt - b.request.updatedAt;
      if (sort === "created_asc") return a.request.createdAt - b.request.createdAt;
      if (sort === "business_category_asc") {
        return (a.request.businessCategory ?? "").localeCompare(b.request.businessCategory ?? "", "ru");
      }
      if (sort === "business_category_desc") {
        return (b.request.businessCategory ?? "").localeCompare(a.request.businessCategory ?? "", "ru");
      }
      if (sort === "deadline_asc") return (a.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER) - (b.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER);
      if (sort === "deadline_desc") return (b.request.approvalDeadline ?? 0) - (a.request.approvalDeadline ?? 0);
      return b.request.createdAt - a.request.createdAt;
    });
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 20, 100));
    const page = Math.max(1, args.page ?? 1);
    const totalCount = results.length;
    const start = (page - 1) * pageSize;
    return {
      items: results.slice(start, start + pageSize),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    };
  },
});

export const canUseAllRequestsView = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const canViewAll =
      record?.roles?.some((role: string) =>
        REQUEST_ALL_LIST_ROLES.includes(role as (typeof REQUEST_ALL_LIST_ROLES)[number]),
      ) || hasFinanceApproverRole(record);
    if (canViewAll) {
      return true;
    }
    if (record?.roles?.some((role: string) => ["BUH Payment", "BUH Inside", "BUH Outsource"].includes(role))) {
      return true;
    }
    const hasReviewedAny = (
      await ctx.db
        .query("approvals")
        .filter((q: any) => q.eq(q.field("reviewerEmail"), email))
        .take(1)
    ).length > 0;
    if (hasReviewedAny) {
      return true;
    }
    const requests = await ctx.db.query("requests").collect();
    return requests.some((request: any) => hasViewerAccess(request, email));
  },
});

export const archiveOldRequests = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const requests = await ctx.db.query("requests").collect();
    const eligible = requests.filter(
      (request) => !request.archivedAt && request.createdAt < cutoff,
    );
    const archivedAt = Date.now();
    for (const request of eligible) {
      await ctx.db.patch(request._id, { archivedAt });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "request_archived",
        title: "Заявка отправлена в архив",
        description: "Автоматическая архивация заявок старше года",
        actorEmail: undefined,
        actorName: "Aurum",
      });
    }
    return { archived: eligible.length };
  },
});

export const getRequest = query({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      return null;
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const canViewAll =
      record?.roles?.some((role: string) =>
        REQUEST_WIDE_VIEW_ROLES.includes(role as (typeof REQUEST_WIDE_VIEW_ROLES)[number]),
      ) || hasFinanceApproverRole(record);
    const hasSpecialBuhAccess = hasSpecialBuhAccessToRequest(record, request);
    const canHodView = hasHodAccessToRequest(record, request);
    const canViewByHistory = await hasHistoricalApprovalAccess(ctx, args.id, email);
    const hasExplicitViewerAccess = hasViewerAccess(request, email);
    if (
      !canViewAll &&
      !hasSpecialBuhAccess &&
      !canHodView &&
      !canViewByHistory &&
      !hasExplicitViewerAccess &&
      request.createdBy !== userId &&
      request.createdByEmail !== email
    ) {
      return null;
    }
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    const mandatoryApprovalIdentities = new Set(
      getMandatoryApprovalTargets({
        category: request.category,
        specialists: request.specialists,
      }).map((target) => getApprovalIdentity(target)),
    );
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    return {
      request,
      approvals: approvals.map((approval) => ({
        ...approval,
        isMandatory: mandatoryApprovalIdentities.has(getApprovalIdentity(approval)),
      })),
      isCreator,
      canHodEditSpecialists: canHodView,
      canManageFiles: isCreator || canViewAll || canHodView || canViewByHistory,
      canManageViewerAccess: canManageViewerAccess({
        isCreator,
        roleRecord: record,
      }),
      hodDepartments: record?.hodDepartments ?? [],
    };
  },
});

export const listChangeHistory = query({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const canViewAll =
      record?.roles?.some((role: string) =>
        REQUEST_WIDE_VIEW_ROLES.includes(role as (typeof REQUEST_WIDE_VIEW_ROLES)[number]),
      ) || hasFinanceApproverRole(record);
    const hasSpecialBuhAccess = hasSpecialBuhAccessToRequest(record, request);
    const canHodView = hasHodAccessToRequest(record, request);
    const canViewByHistory = await hasHistoricalApprovalAccess(ctx, args.requestId, email);
    if (
      !canViewAll &&
      !hasSpecialBuhAccess &&
      !canHodView &&
      !canViewByHistory &&
      !hasViewerAccess(request, email) &&
      request.createdBy !== userId &&
      request.createdByEmail !== email
    ) {
      throw new Error("Not authorized");
    }
    const items = await ctx.db
      .query("requestChangeLogs")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items;
  },
});

export const grantViewerAccess = mutation({
  args: {
    id: v.id("requests"),
    targetEmail: v.string(),
    targetName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    if (!canManageViewerAccess({ isCreator, roleRecord })) {
      throw new Error("Not authorized");
    }
    const targetEmail = args.targetEmail.trim().toLowerCase();
    if (!targetEmail) {
      throw new Error("Укажите почту");
    }
    if (!isAgimaEmail(targetEmail)) {
      throw new Error("Можно выдавать доступ только на почту @agima.ru");
    }
    const targetRecord = await getRoleRecord(ctx, targetEmail);
    if (targetEmail === request.createdByEmail.trim().toLowerCase()) {
      throw new Error("Автор уже имеет доступ к заявке");
    }

    const { created, viewerAccess } = upsertViewerAccessEntry(request, {
      email: targetEmail,
      fullName: (targetRecord?.fullName ?? args.targetName?.trim()) || undefined,
      grantedByEmail: email,
      grantedByName: roleRecord?.fullName,
      source: "share",
      grantedAt: Date.now(),
    });
    if (!created) {
      return { created: false };
    }

    await ctx.db.patch(request._id, {
      viewerAccess,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "viewer_access_granted",
      title: "Выдан доступ к заявке",
      description: `${targetRecord?.fullName || args.targetName?.trim() ? `${targetRecord?.fullName || args.targetName?.trim()} · ` : ""}${targetEmail}`,
      actorEmail: email,
      actorName: roleRecord?.fullName ?? undefined,
      metadata: {
        source: "share",
        recipientEmail: targetEmail,
      },
    });
    await ctx.scheduler.runAfter(0, internal.emails.sendRequestViewerAccessGranted, {
      requestId: request._id,
      recipients: [targetEmail],
      grantedByEmail: email,
      grantedByName: roleRecord?.fullName ?? undefined,
    });
    return { created: true };
  },
});

export const revokeViewerAccess = mutation({
  args: {
    id: v.id("requests"),
    targetEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    if (!canManageViewerAccess({ isCreator, roleRecord })) {
      throw new Error("Not authorized");
    }
    const targetEmail = normalizeEmail(args.targetEmail);
    const nextViewerAccess = (request.viewerAccess ?? []).filter(
      (item: any) => normalizeEmail(item.email) !== targetEmail,
    );
    if (nextViewerAccess.length === (request.viewerAccess ?? []).length) {
      return { removed: false };
    }
    await ctx.db.patch(request._id, {
      viewerAccess: nextViewerAccess.length ? nextViewerAccess : undefined,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "viewer_access_revoked",
      title: "Доступ к заявке отозван",
      description: targetEmail,
      actorEmail: email,
      actorName: roleRecord?.fullName ?? undefined,
    });
    return { removed: true };
  },
});

export const previewEditImpact = query({
  args: {
    id: v.id("requests"),
    ...requestPayloadValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    const isAdmin = roleRecord?.roles?.includes("ADMIN");
    if (!isCreator && !isAdmin) {
      throw new Error("Not authorized");
    }

    const normalizedSpecialists = normalizeSpecialists(args.specialists ?? request.specialists ?? []);
    const normalizedCategory = normalizeRequestCategory(args.category);
    const normalizedDepartment = normalizeHodDepartment(args.department);
    const normalizedFundingSource = normalizeFundingSource(args.fundingSource);
    const requestArea = getRequestAreaForDepartment(normalizedDepartment);
    const effectiveRequiredHodDepartments = getEffectiveRequiredHodDepartments({
      category: normalizedCategory,
      requiredRoles: args.requiredRoles,
      requiredHodDepartments: args.requiredHodDepartments,
      specialists: normalizedSpecialists,
    });
    const effectiveRequiredRoles = getEffectiveRequiredRoles({
      requiredRoles: args.requiredRoles as any,
      requiredHodDepartments: effectiveRequiredHodDepartments,
      category: normalizedCategory,
    });
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: normalizedCategory,
        amount: args.amount,
        amountWithVat: args.amountWithVat,
        vatRate: args.vatRate,
      },
      normalizedSpecialists,
    );
    const incomingAmounts = resolveVatAmounts({
      amountWithoutVat: args.incomingAmount,
      amountWithVat: args.incomingAmountWithVat,
      vatRate: args.vatRate,
      autoCalculateAmountWithVat: true,
    });
    const prepaymentAmounts = resolveVatAmounts({
      amountWithoutVat: args.prepaymentAmount,
      amountWithVat: args.prepaymentAmountWithVat,
      vatRate: args.vatRate,
      autoCalculateAmountWithVat: true,
    });
    const nextBase = {
      ...request,
      requestArea,
      department: normalizedDepartment,
      title: args.title.trim(),
      category: normalizedCategory,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: args.currency,
      fundingSource: normalizedFundingSource,
      counterparty: args.counterparty,
      paymentMethod: args.paymentMethod,
      contractLink: args.contractLink?.trim() || undefined,
      dueDiligenceChecked: args.dueDiligenceChecked ?? false,
      dueDiligenceJiraLink: args.dueDiligenceJiraLink?.trim() || undefined,
      prepaymentRequired: args.prepaymentRequired ?? false,
      prepaymentAmount: args.prepaymentRequired ? prepaymentAmounts.amountWithoutVat : undefined,
      prepaymentAmountWithVat: args.prepaymentRequired ? prepaymentAmounts.amountWithVat : undefined,
      prepaymentDate: args.prepaymentRequired ? args.prepaymentDate : undefined,
      justification: args.justification,
      details: args.details?.trim() || undefined,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
      finplanEntered: args.finplanEntered ?? false,
      finplanEntryIds: args.finplanEntryIds?.map((item: string) => item.trim()).filter(Boolean) ?? undefined,
      incomingAmount: incomingAmounts.amountWithoutVat,
      incomingAmountWithVat: incomingAmounts.amountWithVat,
      incomingRatio: calculateIncomingRatio({
        incomingAmount: incomingAmounts.amountWithoutVat,
        incomingAmountWithVat: incomingAmounts.amountWithVat,
        amountWithoutVat: effectiveAmounts.amount,
        amountWithVat: effectiveAmounts.amountWithVat,
      }),
      shipmentDate: args.shipmentDate,
      shipmentMonth: args.shipmentMonth,
      requiredHodDepartments:
        effectiveRequiredHodDepartments.length ? effectiveRequiredHodDepartments : undefined,
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      approvalDeadline: args.approvalDeadline,
      neededBy: args.neededBy,
      paymentDeadline: args.paymentDeadline,
      paidBy: args.paidBy,
      requiredRoles: effectiveRequiredRoles as any,
    };
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    return buildEditImpact(request, nextBase, approvals);
  },
});

export const editRequest = mutation({
  args: {
    id: v.id("requests"),
    ...requestPayloadValidator,
    confirmWorkflowReset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    const isAdmin = roleRecord?.roles?.includes("ADMIN");
    if (!isCreator && !isAdmin) {
      throw new Error("Not authorized");
    }

    const specialistInput = args.specialists ?? request.specialists ?? [];
    validateRequestPayload({
      ...args,
      specialists: specialistInput,
      existingContractAttachmentCount: request.contractAttachmentCount ?? 0,
    });
    const normalizedCategory = normalizeRequestCategory(args.category);
    if (normalizedCategory !== "Welcome-бонус" && !isExpenseExpectationDateAllowed(args.neededBy, Date.now())) {
      throw new Error("Дата отгрузки может быть не раньше прошлого месяца");
    }
    if (args.prepaymentRequired && isBeforeDate(args.prepaymentDate, request.createdAt)) {
      throw new Error("Дата предоплаты не может быть раньше даты создания заявки");
    }

    const identity = await ctx.auth.getUserIdentity();
    const actorName = roleRecord?.fullName ?? identity?.name ?? undefined;
    const creatorRoles = roleRecord?.roles ?? [];
    const normalizedSpecialists = normalizeSpecialists(specialistInput);
    const normalizedDepartment = normalizeHodDepartment(args.department);
    const normalizedFundingSource = normalizeFundingSource(args.fundingSource);
    const requestArea = getRequestAreaForDepartment(normalizedDepartment);
    const effectiveRequiredHodDepartments = getEffectiveRequiredHodDepartments({
      category: normalizedCategory,
      requiredRoles: args.requiredRoles,
      requiredHodDepartments: args.requiredHodDepartments,
      specialists: normalizedSpecialists,
    });
    const effectiveRequiredRoles = getEffectiveRequiredRoles({
      requiredRoles: args.requiredRoles as any,
      requiredHodDepartments: effectiveRequiredHodDepartments,
      category: normalizedCategory,
    });
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: normalizedCategory,
        amount: args.amount,
        amountWithVat: args.amountWithVat,
        vatRate: args.vatRate,
      },
      normalizedSpecialists,
    );
    const incomingAmounts = resolveVatAmounts({
      amountWithoutVat: args.incomingAmount,
      amountWithVat: args.incomingAmountWithVat,
      vatRate: args.vatRate,
      autoCalculateAmountWithVat: true,
    });
    const prepaymentAmounts = resolveVatAmounts({
      amountWithoutVat: args.prepaymentAmount,
      amountWithVat: args.prepaymentAmountWithVat,
      vatRate: args.vatRate,
      autoCalculateAmountWithVat: true,
    });
    const specialistNeedsHodValidation =
      supportsRequestSpecialists(normalizedCategory) &&
      getRequiredSpecialistHodDepartments(normalizedSpecialists).length > 0 &&
      !areContestDepartmentsValidated(normalizedSpecialists);
    const now = Date.now();

    const nextBase = {
      requestArea,
      department: normalizedDepartment,
      title: args.title.trim(),
      category: normalizedCategory,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: args.currency,
      fundingSource: normalizedFundingSource,
      counterparty: args.counterparty,
      paymentMethod: args.paymentMethod,
      contractLink: args.contractLink?.trim() || undefined,
      dueDiligenceChecked: args.dueDiligenceChecked ?? false,
      dueDiligenceJiraLink: args.dueDiligenceJiraLink?.trim() || undefined,
      prepaymentRequired: args.prepaymentRequired ?? false,
      prepaymentAmount: args.prepaymentRequired ? prepaymentAmounts.amountWithoutVat : undefined,
      prepaymentAmountWithVat: args.prepaymentRequired ? prepaymentAmounts.amountWithVat : undefined,
      prepaymentDate: args.prepaymentRequired ? args.prepaymentDate : undefined,
      justification: args.justification,
      details: args.details?.trim() || undefined,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
      finplanEntered: args.finplanEntered ?? false,
      finplanEntryIds: args.finplanEntryIds?.map((item: string) => item.trim()).filter(Boolean) ?? undefined,
      incomingAmount: incomingAmounts.amountWithoutVat,
      incomingAmountWithVat: incomingAmounts.amountWithVat,
      incomingRatio: calculateIncomingRatio({
        incomingAmount: incomingAmounts.amountWithoutVat,
        incomingAmountWithVat: incomingAmounts.amountWithVat,
        amountWithoutVat: effectiveAmounts.amount,
        amountWithVat: effectiveAmounts.amountWithVat,
      }),
      shipmentDate: args.shipmentDate,
      shipmentMonth: args.shipmentMonth,
      requiredHodDepartments:
        effectiveRequiredHodDepartments.length ? effectiveRequiredHodDepartments : undefined,
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      approvalDeadline: args.approvalDeadline,
      neededBy: args.neededBy,
      paymentDeadline: args.paymentDeadline,
      paidBy: args.paidBy,
      requiredRoles: effectiveRequiredRoles as any,
    };

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    const editImpact = buildEditImpact(request, nextBase, approvals);
    const previousHodDepartments = normalizeDepartmentList(request.requiredHodDepartments ?? []);
    const hodDepartmentsChanged =
      JSON.stringify(previousHodDepartments) !== JSON.stringify(effectiveRequiredHodDepartments);
    if (hodDepartmentsChanged) {
      editImpact.triggerRepeatApproval = true;
      editImpact.routeChanged = true;
      editImpact.shouldAskForConfirmation = true;
      editImpact.confirmationLines.push("Изменение цехов для руководителя цеха обновит маршрут согласования.");
    }
    const submitDraft = request.status === "draft" && args.submit;
    const shouldResubmit = request.status !== "draft" && editImpact.triggerRepeatApproval;

    if (
      !submitDraft &&
      request.status !== "draft" &&
      editImpact.shouldAskForConfirmation &&
      !args.confirmWorkflowReset
    ) {
      throw new Error(
        `CONFIRM_EDIT_EFFECTS::${JSON.stringify({
          confirmationLines: editImpact.confirmationLines,
          infoLines: editImpact.infoLines,
        })}`,
      );
    }

    let nextStatus = request.status;
    let updatedApprovals: any[] = [...approvals];
    const autoApprovedRoles = effectiveRequiredRoles.filter((role) => creatorRoles.includes(role));
    const pendingRoles = effectiveRequiredRoles.filter((role) => !creatorRoles.includes(role));

    if (submitDraft || request.status !== "draft") {
      const shouldRecreateApprovals =
        submitDraft || shouldResubmit || hodDepartmentsChanged || request.status !== "draft";
      if (shouldRecreateApprovals) {
        for (const approval of approvals) {
          await ctx.db.delete(approval._id);
        }
        updatedApprovals = [];
        if (args.submit || request.status !== "draft") {
          await createApprovalsForRequest(ctx, {
            requestId: args.id,
            requiredRoles: effectiveRequiredRoles as any,
            requiredHodDepartments: effectiveRequiredHodDepartments,
            category: normalizedCategory,
            autoApprovedRoles,
            now,
            userId,
            email,
          });
          updatedApprovals = await ctx.db
            .query("approvals")
            .withIndex("by_request", (q) => q.eq("requestId", args.id))
            .collect();
        }
        nextStatus =
          request.status === "draft" && !args.submit
            ? "draft"
            : getRequestApprovalStatus({
                category: args.category,
                specialists: normalizedSpecialists,
                requiredRoles: effectiveRequiredRoles,
                requiredHodDepartments: effectiveRequiredHodDepartments,
                approvals: updatedApprovals,
              });
      }
      if (request.status === "draft" && args.submit && pendingRoles.length === 0 && !specialistNeedsHodValidation) {
        nextStatus = "approved";
      }
    }

    if (request.status === "draft" && !args.submit) {
      nextStatus = "draft";
    }

    const patch: Record<string, any> = {
      ...nextBase,
      status: nextStatus,
      updatedAt: now,
    };

    const approvalDeadlineChanged = request.approvalDeadline !== args.approvalDeadline;

    if (submitDraft || shouldResubmit) {
      patch.submittedAt = now;
      if (shouldResubmit || editImpact.removedRoles.length > 0 || editImpact.addedRoles.length > 0) {
        patch.awaitingPaymentAt = undefined;
        patch.awaitingPaymentByEmail = undefined;
        patch.awaitingPaymentByName = undefined;
        patch.paidAt = undefined;
        patch.paidByEmail = undefined;
        patch.paidByName = undefined;
        patch.paymentPlannedAt = undefined;
        patch.paymentPlannedByEmail = undefined;
        patch.paymentPlannedByName = undefined;
        patch.paymentResidualAmount = undefined;
        patch.plannedPaymentAmount = undefined;
        patch.plannedPaymentAmountWithVat = undefined;
        patch.paymentCurrencyRate = undefined;
        patch.actualPaidAmount = undefined;
        patch.actualPaidAmountWithVat = undefined;
        patch.finplanCostIds = undefined;
        patch.paymentSplits = undefined;
        patch.plannedPaymentSplits = undefined;
      }
    }
    if (submitDraft || shouldResubmit || approvalDeadlineChanged) {
      patch.approvalReminderSentAt = undefined;
    }

    const previousForDiff = {
      ...request,
      status: request.status,
    };
    const nextForDiff = {
      ...request,
      ...patch,
    };
    const changes = diffRequestFields(previousForDiff, nextForDiff);
    const summaryLines = changes.map(
      (change) => `${change.field}: ${change.fromValue || "—"} → ${change.toValue || "—"}`,
    );
    const specialistsChanged = changes.some(
      (change) => change.field === requestFieldLabels.specialists,
    );
    const historyGroupId = `${now}-${Math.round(Math.random() * 1_000_000)}`;
    const historySummaryLines = [
      ...editImpact.confirmationLines,
      ...editImpact.infoLines,
    ];

    await ctx.db.patch(args.id, patch);

    if (changes.length) {
      await recordRequestChanges(ctx, args.id, email, actorName, changes, {
        groupId: historyGroupId,
        triggeredRepeatApproval: shouldResubmit,
        groupSummary: summarizeEditEffects(historySummaryLines),
      });
    }
    await logTimelineEvent(ctx, {
      requestId: args.id,
      type: "request_edited",
      title: "Заявка изменена",
      description: summarizeEditEffects(historySummaryLines),
      actorEmail: email,
      actorName,
      metadata: {
        triggeredRepeatApproval: shouldResubmit,
        changedFields: changes.map((change) => change.field),
      },
    });
    if (editImpact.routeChanged) {
      await logTimelineEvent(ctx, {
        requestId: args.id,
        type: "approval_route_changed",
        title: "Маршрут согласования обновлен",
        description: [
          editImpact.rolesToReset.length
            ? `Сброшены роли: ${editImpact.rolesToReset.join(", ")}`
            : undefined,
          editImpact.addedRoles.length
            ? `Добавлены роли: ${editImpact.addedRoles.join(", ")}`
            : undefined,
          editImpact.removedRoles.length
            ? `Убраны роли: ${editImpact.removedRoles.join(", ")}`
            : undefined,
        ]
          .filter(Boolean)
          .join(". "),
        actorEmail: email,
        actorName,
        metadata: {
          rolesToReset: editImpact.rolesToReset,
          addedRoles: editImpact.addedRoles,
          removedRoles: editImpact.removedRoles,
          repeatedApproval: shouldResubmit,
        },
      });
    }

    if (submitDraft && !specialistNeedsHodValidation) {
      await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
        requestId: args.id,
      });
    }
    if (request.status !== "approved" && nextStatus === "approved") {
      await sendPaymentPlanningRequestedAndScheduleReminders(ctx, {
        _id: args.id,
        paymentDeadline: nextForDiff.paymentDeadline,
        neededBy: nextForDiff.neededBy,
      });
    }
    if (request.status !== "draft") {
      const removedRoleRecipients = await getRoleNotificationRecipients(
        ctx,
        approvals,
        editImpact.removedRoles,
        "decided",
        [request.createdByEmail],
      );
      const buhEmails = editImpact.counterpartyChanged
        ? await getActiveRoleEmails(ctx, ["BUH"])
        : [];
      const repeatApprovalRoleEmails = Array.from(
        new Set([
          ...(await getRoleNotificationRecipients(
            ctx,
            approvals,
            editImpact.rolesToReset,
            "decided",
            [request.createdByEmail],
          )),
          ...(await getRoleNotificationRecipients(
            ctx,
            approvals,
            editImpact.addedRoles,
            "decided",
            [request.createdByEmail],
          )),
        ]),
      );
      const infoRecipients = Array.from(
        new Set([...editImpact.notifyApprovedEmails, ...buhEmails]),
      );
      if (removedRoleRecipients.length > 0) {
        await ctx.scheduler.runAfter(0, internal.emails.sendApprovalCanceled, {
          requestId: args.id,
          recipients: removedRoleRecipients,
          roles: editImpact.removedRoles,
          summaryLines,
        });
      }
      if (repeatApprovalRoleEmails.length > 0 && summaryLines.length > 0 && editImpact.routeChanged) {
        await ctx.scheduler.runAfter(0, internal.emails.sendApprovalRequestedToRecipients, {
          requestId: args.id,
          recipients: repeatApprovalRoleEmails,
          summaryLines,
          repeatedApproval: shouldResubmit || editImpact.routeChanged,
        });
      }
      const pureInfoRecipients = infoRecipients.filter(
        (recipient) => !repeatApprovalRoleEmails.includes(recipient),
      );
      if (pureInfoRecipients.length > 0 && summaryLines.length > 0) {
        await ctx.scheduler.runAfter(0, internal.emails.sendRequestUpdatedSummary, {
          requestId: args.id,
          recipients: pureInfoRecipients,
          summaryLines,
          repeatedApproval: false,
        });
      }
    }
    if (specialistNeedsHodValidation) {
      await ctx.scheduler.runAfter(0, internal.emails.sendHodValidationRequest, {
        requestId: args.id,
      });
    }
    const hadInsideSpecialists = requestHasInsideSpecialists(request);
    const hasInsideSpecialists = requestHasInsideSpecialists({ specialists: normalizedSpecialists });
    const hadOutsourceSpecialists = requestHasOutsourceSpecialists(request);
    const hasOutsourceSpecialists = requestHasOutsourceSpecialists({ specialists: normalizedSpecialists });
    const specialistBuhRolesToNotify = Array.from(
      new Set([
        ...(specialistsChanged ? getSpecialistBuhRolesForRequest(request) : []),
        ...getSpecialistBuhRolesForRequest({ specialists: normalizedSpecialists }),
      ]),
    );
    const shouldNotifySpecialistBuh =
      (
        (hasInsideSpecialists || hasOutsourceSpecialists) &&
        (
          submitDraft ||
          shouldResubmit ||
          (!hadInsideSpecialists && hasInsideSpecialists) ||
          (!hadOutsourceSpecialists && hasOutsourceSpecialists)
        )
      ) ||
      (
        request.status !== "draft" &&
        specialistsChanged &&
        specialistBuhRolesToNotify.length > 0
      );
    if (shouldNotifySpecialistBuh) {
      await ctx.scheduler.runAfter(0, internal.emails.sendSpecialistBuhNotifications, {
        requestId: args.id,
        targetRoles: specialistBuhRolesToNotify,
        summaryLines:
          request.status !== "draft" && specialistsChanged && summaryLines.length
            ? summaryLines
            : undefined,
        actorEmail: request.status !== "draft" && specialistsChanged ? email : undefined,
        actorName: request.status !== "draft" && specialistsChanged ? actorName : undefined,
      });
    }
    if (nextStatus === "pending" && args.approvalDeadline && (submitDraft || shouldResubmit || approvalDeadlineChanged)) {
      await ctx.scheduler.runAfter(
        Math.max(0, addDays(args.approvalDeadline, 1) - now),
        internal.emails.sendApprovalDeadlineReminder,
        {
          requestId: args.id,
          approvalDeadline: args.approvalDeadline,
        },
      );
    }

    return { updated: true, status: nextStatus };
  },
});

export const createRequest = mutation({
  args: requestPayloadValidator,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const identity = await ctx.auth.getUserIdentity();
    const roleRecord = await getRoleRecord(ctx, email);
    const creatorRoles = roleRecord?.roles ?? [];
    const now = Date.now();
    const payloadArgs = {
      ...args,
      department: normalizeHodDepartment(args.department) ?? roleRecord?.department ?? ACCOUNTING_REQUEST_AREA,
    };
    validateRequestPayload(payloadArgs);
    const normalizedCategory = normalizeRequestCategory(payloadArgs.category);
    if (normalizedCategory !== "Welcome-бонус" && !isExpenseExpectationDateAllowed(payloadArgs.neededBy, now)) {
      throw new Error("Дата отгрузки может быть не раньше прошлого месяца");
    }
    if (payloadArgs.prepaymentRequired && isBeforeDate(payloadArgs.prepaymentDate, now)) {
      throw new Error("Дата предоплаты не может быть раньше даты создания заявки");
    }
    const normalizedDepartment = normalizeHodDepartment(payloadArgs.department);
    const normalizedFundingSource = normalizeFundingSource(payloadArgs.fundingSource);
    const requestArea = getRequestAreaForDepartment(normalizedDepartment);
    const requestCode = await getNextRequestCode(ctx, normalizedCategory, normalizedFundingSource);
    const normalizedSpecialists = normalizeSpecialists(payloadArgs.specialists ?? []);
    const effectiveRequiredHodDepartments = getEffectiveRequiredHodDepartments({
      category: normalizedCategory,
      requiredRoles: args.requiredRoles,
      requiredHodDepartments: args.requiredHodDepartments,
      specialists: normalizedSpecialists,
    });
    const effectiveRequiredRoles = getEffectiveRequiredRoles({
      requiredRoles: args.requiredRoles as any,
      requiredHodDepartments: effectiveRequiredHodDepartments,
      category: normalizedCategory,
    });
    const autoApprovedRoles = effectiveRequiredRoles.filter((role) => creatorRoles.includes(role));
    const specialistNeedsHodValidation =
      supportsRequestSpecialists(normalizedCategory) &&
      getRequiredSpecialistHodDepartments(normalizedSpecialists).length > 0 &&
      !areContestDepartmentsValidated(normalizedSpecialists);
    const approvalTargets = buildApprovalTargets({
      requiredRoles: effectiveRequiredRoles as any,
      requiredHodDepartments: effectiveRequiredHodDepartments,
      category: normalizedCategory,
    });
    const status = !payloadArgs.submit
      ? "draft"
      : getRequestApprovalStatus({
          category: normalizedCategory,
          specialists: normalizedSpecialists,
          requiredRoles: effectiveRequiredRoles,
          requiredHodDepartments: effectiveRequiredHodDepartments,
          approvals: approvalTargets.map((target) => ({
            role: target.role,
            department: target.department,
            status:
              target.role !== "HOD" && autoApprovedRoles.includes(target.role)
                ? ("approved" as const)
                : ("pending" as const),
          })),
        });
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: normalizedCategory,
        amount: payloadArgs.amount,
        amountWithVat: payloadArgs.amountWithVat,
        vatRate: payloadArgs.vatRate,
      },
      normalizedSpecialists,
    );
    const incomingAmounts = resolveVatAmounts({
      amountWithoutVat: payloadArgs.incomingAmount,
      amountWithVat: payloadArgs.incomingAmountWithVat,
      vatRate: payloadArgs.vatRate,
      autoCalculateAmountWithVat: true,
    });
    const prepaymentAmounts = resolveVatAmounts({
      amountWithoutVat: payloadArgs.prepaymentAmount,
      amountWithVat: payloadArgs.prepaymentAmountWithVat,
      vatRate: payloadArgs.vatRate,
      autoCalculateAmountWithVat: true,
    });

    const requestId = await ctx.db.insert("requests", {
      requestCode,
      requestArea,
      department: normalizedDepartment,
      title: payloadArgs.title.trim(),
      createdBy: userId,
      createdByEmail: email,
      createdByName: roleRecord?.fullName ?? identity?.name ?? undefined,
      category: normalizedCategory,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: payloadArgs.currency,
      fundingSource: normalizedFundingSource,
      counterparty: payloadArgs.counterparty,
      paymentMethod: payloadArgs.paymentMethod,
      cfdTag: undefined,
      contractLink: payloadArgs.contractLink?.trim() || undefined,
      contractAttachmentCount: 0,
      lastContractAttachmentName: undefined,
      dueDiligenceChecked: payloadArgs.dueDiligenceChecked ?? false,
      dueDiligenceJiraLink: payloadArgs.dueDiligenceJiraLink?.trim() || undefined,
      prepaymentRequired: payloadArgs.prepaymentRequired ?? false,
      prepaymentAmount: payloadArgs.prepaymentRequired ? prepaymentAmounts.amountWithoutVat : undefined,
      prepaymentAmountWithVat: payloadArgs.prepaymentRequired ? prepaymentAmounts.amountWithVat : undefined,
      prepaymentDate: payloadArgs.prepaymentRequired ? payloadArgs.prepaymentDate : undefined,
      justification: payloadArgs.justification,
      details: payloadArgs.details?.trim() || undefined,
      investmentReturn: payloadArgs.investmentReturn?.trim() || undefined,
      clientName: payloadArgs.clientName,
      contacts: payloadArgs.contacts,
      relatedRequests: payloadArgs.relatedRequests,
      links: payloadArgs.links,
      attachmentCount: 0,
      lastAttachmentName: undefined,
      financePlanLinks: payloadArgs.financePlanLinks,
      finplanEntered: payloadArgs.finplanEntered ?? false,
      finplanEntryIds: payloadArgs.finplanEntryIds?.map((item: string) => item.trim()).filter(Boolean) ?? undefined,
      incomingAmount: incomingAmounts.amountWithoutVat,
      incomingAmountWithVat: incomingAmounts.amountWithVat,
      incomingRatio: calculateIncomingRatio({
        incomingAmount: incomingAmounts.amountWithoutVat,
        incomingAmountWithVat: incomingAmounts.amountWithVat,
        amountWithoutVat: effectiveAmounts.amount,
        amountWithVat: effectiveAmounts.amountWithVat,
      }),
      shipmentDate: payloadArgs.shipmentDate,
      shipmentMonth: payloadArgs.shipmentMonth,
      requiredHodDepartments:
        effectiveRequiredHodDepartments.length ? effectiveRequiredHodDepartments : undefined,
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      requiredRoles: effectiveRequiredRoles as any,
      status,
      isCanceled: false,
      approvalDeadline: payloadArgs.approvalDeadline,
      neededBy: payloadArgs.neededBy,
      paymentDeadline: payloadArgs.paymentDeadline,
      paidBy: payloadArgs.paidBy,
      submittedAt: payloadArgs.submit ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId,
      type: "request_created",
      title: payloadArgs.submit ? "Заявка создана и отправлена" : "Создан черновик",
      description: `${normalizedCategory} · ${normalizedFundingSource}`,
      actorEmail: email,
      actorName: roleRecord?.fullName ?? identity?.name ?? undefined,
    });

    if (payloadArgs.submit && approvalTargets.length > 0) {
      await createApprovalsForRequest(ctx, {
        requestId,
        requiredRoles: effectiveRequiredRoles as any,
        requiredHodDepartments: effectiveRequiredHodDepartments,
        category: normalizedCategory,
        autoApprovedRoles,
        now,
        userId,
        email,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
        requestId,
      });
      if (payloadArgs.approvalDeadline) {
        await ctx.scheduler.runAfter(
          Math.max(0, addDays(payloadArgs.approvalDeadline, 1) - now),
          internal.emails.sendApprovalDeadlineReminder,
          {
            requestId,
            approvalDeadline: payloadArgs.approvalDeadline,
          },
        );
      }
    }
    if (payloadArgs.submit && status === "approved") {
      await sendPaymentPlanningRequestedAndScheduleReminders(ctx, {
        _id: requestId,
        paymentDeadline: payloadArgs.paymentDeadline,
        neededBy: payloadArgs.neededBy,
      });
    }
    await ctx.scheduler.runAfter(0, internal.emails.sendRequestCreatedToBuh, {
      requestId,
    });
    if (requestHasInsideSpecialists({ specialists: normalizedSpecialists }) || requestHasOutsourceSpecialists({ specialists: normalizedSpecialists })) {
      await ctx.scheduler.runAfter(0, internal.emails.sendSpecialistBuhNotifications, {
        requestId,
      });
    }

    return requestId;
  },
});

export const sendSpecialRoleBackfillNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    if (!hasAnyRole(roleRecord, ["ADMIN", "BUH", "CFD"])) {
      throw new Error("Not authorized");
    }

    const requests = await ctx.db.query("requests").collect();
    let scheduled = 0;
    for (const request of requests) {
      if (request.isCanceled || ["draft", "rejected", "closed"].includes(request.status)) {
        continue;
      }
      const targetRoles = new Set<string>();
      if (requestHasInsideSpecialists(request)) {
        targetRoles.add("BUH Inside");
      }
      if (requestHasOutsourceSpecialists(request)) {
        targetRoles.add("BUH Outsource");
      }
      if (normalizeRequestCategory(request.category) === CLIENT_SERVICES_TRANSIT_CATEGORY) {
        targetRoles.add("BUH Transit");
      }
      if (targetRoles.size === 0) {
        continue;
      }
      scheduled += 1;
      await ctx.scheduler.runAfter(0, internal.emails.sendSpecialRoleBackfillNotification, {
        requestId: request._id,
        targetRoles: Array.from(targetRoles),
      });
    }
    return { scheduled };
  },
});

export const updateContestSpecialist = mutation({
  args: {
    requestId: v.id("requests"),
    specialistId: v.string(),
    name: v.string(),
    contractorLegalEntity: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    department: v.optional(v.string()),
    contractorTypes: v.optional(v.array(v.string())),
    hours: v.optional(v.number()),
    directCost: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    taxUnknown: v.optional(v.boolean()),
    amountIncludesTaxes: v.optional(v.boolean()),
    amountExcludesTaxes: v.optional(v.boolean()),
    hodConfirmed: v.optional(v.boolean()),
    buhConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.isCanceled) {
      throw new Error("Сначала возобновите заявку");
    }
    if (!supportsRequestSpecialists(request.category)) {
      throw new Error("Редактирование специалистов доступно только для заявок со специалистами");
    }
    const isFinanceEditor = Boolean(
      roleRecord?.roles?.some((role: string) =>
        ["BUH", "BUH Inside", "BUH Outsource"].includes(role),
      ) || hasFinanceApproverRole(roleRecord),
    );
    const isAdmin = Boolean(roleRecord?.roles?.includes("ADMIN"));
    if (!hasHodAccessToRequest(roleRecord, request) && !isAdmin && !isFinanceEditor) {
      throw new Error("Not authorized");
    }
    const specialists = [...(request.specialists ?? [])];
    const index = specialists.findIndex((item) => item.id === args.specialistId);
    if (index === -1) {
      throw new Error("Специалист не найден");
    }
    const current = specialists[index];
    const hodDepartments = roleRecord?.hodDepartments ?? [];
    const nextDepartment = args.department?.trim() || undefined;
    const allowedDepartment =
      isAdmin ||
      isFinanceEditor ||
      hodDepartments.includes(current.department ?? "") ||
      Boolean(current.department === undefined && nextDepartment && hodDepartments.includes(nextDepartment));
    if (!allowedDepartment) {
      throw new Error("Можно редактировать только специалистов своего цеха");
    }
    if (
      nextDepartment &&
      !isAdmin &&
      !isFinanceEditor &&
      !hodDepartments.includes(nextDepartment)
    ) {
      throw new Error("Можно выбирать только свои цеха");
    }
    const nextSpecialist = {
      ...current,
      sourceType: normalizeContestSpecialistSource(args.sourceType ?? current.sourceType),
      name: args.name.trim(),
      department: nextDepartment,
      hours:
        typeof args.hours === "number" && Number.isFinite(args.hours)
          ? args.hours
          : undefined,
      directCost:
        typeof args.directCost === "number" && Number.isFinite(args.directCost)
          ? args.directCost
          : undefined,
      taxAmount:
        typeof args.taxAmount === "number" && Number.isFinite(args.taxAmount)
          ? args.taxAmount
          : undefined,
      taxUnknown: args.taxUnknown ?? current.taxUnknown ?? false,
      amountIncludesTaxes: args.amountIncludesTaxes ?? current.amountIncludesTaxes ?? false,
      amountExcludesTaxes: args.amountExcludesTaxes ?? current.amountExcludesTaxes ?? false,
      hodConfirmed: args.hodConfirmed ?? current.hodConfirmed ?? false,
      buhConfirmed: args.buhConfirmed ?? current.buhConfirmed ?? false,
    };
    nextSpecialist.contractorLegalEntity =
      nextSpecialist.sourceType === "contractor"
        ? args.contractorLegalEntity?.trim() || undefined
        : undefined;
    nextSpecialist.contractorTypes =
      nextSpecialist.sourceType === "contractor"
        ? Array.from(
            new Set(
              (args.contractorTypes ?? current.contractorTypes ?? [])
                .map((value) => value?.trim())
                .map((value) => (value === "другое" ? "другое/не знаю" : value))
                .filter(Boolean) as string[],
            ),
          )
        : [];
    if (nextSpecialist.amountIncludesTaxes && nextSpecialist.amountExcludesTaxes) {
      throw new Error("Выберите только один вариант: сумма уже с налогами или сумма не включает налоги");
    }
    specialists[index] = nextSpecialist;
    const nextAmount = calculateContestAmount(request.category, specialists, request.amount);
    const nextAmountWithVat = getAmountWithVat(nextAmount, undefined, request.vatRate);
    const updatedApprovals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const approvalStatus = getRequestApprovalStatus({
      category: request.category,
      specialists,
      requiredRoles: request.requiredRoles,
      requiredHodDepartments: request.requiredHodDepartments,
      approvals: updatedApprovals,
    });
    const preservesPaymentStatus = [
      "awaiting_payment",
      "payment_planned",
      "partially_paid",
      "paid",
      "closed",
    ].includes(request.status);
    const nextStatus = preservesPaymentStatus ? request.status : approvalStatus;
    const releasedFromHodPending = request.status === "hod_pending" && nextStatus !== "hod_pending";
    await ctx.db.patch(request._id, {
      specialists,
      amount: nextAmount,
      amountWithVat: nextAmountWithVat,
      status: nextStatus,
      submittedAt: releasedFromHodPending ? Date.now() : request.submittedAt,
      updatedAt: Date.now(),
    });
    const specialistChanges = diffRequestFields(
      { specialists: request.specialists ?? [] },
      { specialists },
    );
    if (specialistChanges.length) {
      const summaryLines = specialistChanges.map(
        (change) => `${change.field}: ${change.fromValue || "—"} → ${change.toValue || "—"}`,
      );
      await recordRequestChanges(
        ctx,
        request._id,
        email,
        roleRecord?.fullName ?? undefined,
        specialistChanges,
      );
      const specialistBuhRolesToNotify = Array.from(
        new Set([
          ...getSpecialistBuhRolesForRequest(request),
          ...getSpecialistBuhRolesForRequest({ specialists }),
        ]),
      );
      if (specialistBuhRolesToNotify.length > 0) {
        await ctx.scheduler.runAfter(0, internal.emails.sendSpecialistBuhNotifications, {
          requestId: request._id,
          targetRoles: specialistBuhRolesToNotify,
          summaryLines,
          actorEmail: email,
          actorName: roleRecord?.fullName ?? undefined,
        });
      }
    }
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "specialists_updated",
      title: "Обновлены специалисты",
      actorEmail: email,
      actorName: roleRecord?.fullName ?? undefined,
      description: releasedFromHodPending
        ? "Все нужные цеха провалидировали прямые затраты. Заявка отправлена на согласование."
        : undefined,
    });
    if (request.status !== "approved" && nextStatus === "approved") {
      await sendPaymentPlanningRequestedAndScheduleReminders(ctx, request);
    }
    if (request.status !== "hod_pending" && nextStatus === "hod_pending") {
      await ctx.scheduler.runAfter(0, internal.emails.sendHodValidationRequest, {
        requestId: request._id,
      });
    }
    return { updated: true };
  },
});

export const adminSendPaymentPlanningNotification = mutation({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    if (!roleRecord?.active || !roleRecord.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.status !== "approved") {
      throw new Error("Отбивку на оплату можно отправить только по согласованной заявке");
    }
    await sendPaymentPlanningRequestedAndScheduleReminders(ctx, request);
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "payment_planning_notification_queued",
      title: "Запрошена отбивка на планирование оплаты",
      actorEmail: email,
      actorName: roleRecord.fullName ?? undefined,
    });
    return { queued: true };
  },
});

export const adminBackfillPaymentDeadlineReminders = mutation({
  args: {},
  handler: async (ctx) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    if (!roleRecord?.active || !roleRecord.roles?.includes("ADMIN")) {
      throw new Error("Not authorized");
    }
    const candidates = (
      await Promise.all(
        OPEN_PAYMENT_TASK_STATUSES.map((status) =>
          ctx.db
            .query("requests")
            .withIndex("by_status", (q: any) => q.eq("status", status as any))
            .collect(),
        ),
      )
    ).flat();
    let scheduled = 0;
    for (const request of candidates) {
      if (!isOpenPaymentTask(request)) {
        continue;
      }
      const paymentDeadline = getRequestPaymentDeadline(request);
      if (!paymentDeadline) {
        continue;
      }
      await schedulePaymentDeadlineReminders(ctx, request._id, paymentDeadline);
      scheduled += 1;
    }
    return { scheduled };
  },
});

export const cancelRequest = mutation({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanManageRequestLifecycle(ctx, args.id);
    await ctx.db.patch(access.request._id, {
      isCanceled: true,
      canceledAt: Date.now(),
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: access.request._id,
      type: "request_canceled",
      title: "Заявка отменена",
      actorEmail: access.email,
    });
    return { canceled: true };
  },
});

export const resumeRequest = mutation({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanManageRequestLifecycle(ctx, args.id);
    await ctx.db.patch(access.request._id, {
      isCanceled: false,
      canceledAt: undefined,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: access.request._id,
      type: "request_resumed",
      title: "Заявка возобновлена",
      actorEmail: access.email,
    });
    return { resumed: true };
  },
});

async function ensureCanManageRequestLifecycle(ctx: any, requestId: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const email = await getCurrentEmail(ctx);
  if (!email) {
    throw new Error("Missing user email");
  }
  const request = await ctx.db.get(requestId);
  if (!request) {
    throw new Error("Request not found");
  }
  const record = await getRoleRecord(ctx, email);
  const normalizedEmail = normalizeEmail(email);
  const isCreator =
    request.createdBy === userId || normalizeEmail(request.createdByEmail) === normalizedEmail;
  const isAdmin = Boolean(record?.roles?.includes("ADMIN"));
  if (!isCreator && !isAdmin) {
    throw new Error("Not authorized");
  }
  return {
    email,
    request,
    record,
    isCreator,
    isAdmin,
  };
}

async function deleteRowsByRequestId(ctx: any, table: string, requestId: any) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_request", (q: any) => q.eq("requestId", requestId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

export const deleteRequest = mutation({
  args: {
    id: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const access = await ensureCanManageRequestLifecycle(ctx, args.id);
    const attachments = await ctx.db
      .query("requestAttachments")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    for (const attachment of attachments) {
      await ctx.db.delete(attachment._id);
      try {
        await ctx.storage.delete(attachment.storageId);
      } catch {
        // Best effort: the request should still be removable even if the file is already gone.
      }
    }
    await deleteRowsByRequestId(ctx, "comments", args.id);
    await deleteRowsByRequestId(ctx, "approvals", args.id);
    await deleteRowsByRequestId(ctx, "requestChangeLogs", args.id);
    await deleteRowsByRequestId(ctx, "requestTimelineEvents", args.id);
    await deleteRowsByRequestId(ctx, "requestEmailLogs", args.id);
    await deleteRowsByRequestId(ctx, "quotaChangeLogs", args.id);
    await ctx.db.delete(access.request._id);
    return { deleted: true };
  },
});

export const assignCfdTag = mutation({
  args: {
    id: v.id("requests"),
    tag: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    businessCategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    const requestDepartment = normalizeHodDepartment(request.department);
    const canManageClassification =
      hasFinanceApproverRole(record) ||
      record?.roles?.includes("ADMIN") ||
      record?.roles?.includes("BUH") ||
      record?.roles?.includes("BUH Transit");
    const canManageTagOnly =
      record?.roles?.includes("COO") ||
      (record?.roles?.includes("HOD") &&
        Boolean(
          requestDepartment &&
            (record.hodDepartments ?? [])
              .map((department: string) => normalizeHodDepartment(department))
              .includes(requestDepartment),
        ));
    if (!canManageClassification && !canManageTagOnly) {
      throw new Error("Not authorized");
    }
    if (
      !canManageClassification &&
      (
        (args.fundingSource !== undefined && normalizeFundingSource(args.fundingSource) !== normalizeFundingSource(request.fundingSource)) ||
        args.businessCategory !== undefined
      )
    ) {
      throw new Error("Можно изменить только тег заявки");
    }
    const nextFundingSource = args.fundingSource
      ? normalizeFundingSource(args.fundingSource)
      : normalizeFundingSource(request.fundingSource);
    if (!isFundingSourceAllowedForCategory(request.category, nextFundingSource)) {
      throw new Error("Так не бывает");
    }
    if (args.tag?.trim()) {
      const tagName = args.tag.trim();
      const existingTag = (await ctx.db.query("cfdTags").collect()).find(
        (tag: any) =>
          tag.name === tagName &&
          tag.active &&
          normalizeHodDepartment(tag.department) === requestDepartment,
      );
      if ((!existingTag || !existingTag.active) && tagName !== TRANSIT_TAG_NAME) {
        throw new Error("Тег не найден");
      }
    }
    const nextBusinessCategory =
      args.businessCategory === undefined
        ? normalizeBusinessCategory(request.businessCategory)
        : normalizeBusinessCategory(args.businessCategory);
    await ctx.db.patch(request._id, {
      cfdTag: args.tag?.trim() || undefined,
      fundingSource: nextFundingSource,
      businessCategory: nextBusinessCategory,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "cfd_tag_updated",
      title: "Изменена классификация заявки",
      description: [
        nextFundingSource,
        args.tag?.trim() ? args.tag.trim() : "тег снят",
        nextBusinessCategory ? `категория: ${nextBusinessCategory}` : undefined,
      ].filter(Boolean).join(" · "),
      actorEmail: email,
      actorName: record.fullName ?? undefined,
    });
    return { updated: true };
  },
});

export const updateOperationalFields = mutation({
  args: {
    id: v.id("requests"),
    amount: v.optional(v.number()),
    amountWithVat: v.optional(v.number()),
    paymentDeadline: v.optional(v.number()),
    shipmentDate: v.optional(v.number()),
    finplanEntered: v.optional(v.boolean()),
    finplanEntryIds: v.optional(v.array(v.string())),
    fotAllSpecialistsRecorded: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.isCanceled) {
      throw new Error("Сначала возобновите заявку");
    }
    const roles = record?.roles ?? [];
    const canManageAll =
      roles.some((role: string) =>
        ["BUH", "ADMIN", "BUH Payment", "BUH Transit"].includes(role),
      ) || hasFinanceApproverRole(record);
    const canManageInside =
      roles.includes("BUH Inside") && requestHasInsideSpecialists(request);
    const canManageOutsource =
      roles.includes("BUH Outsource") && requestHasOutsourceSpecialists(request);
    if (!canManageAll && !canManageInside && !canManageOutsource) {
      throw new Error("Not authorized");
    }
    if (args.fotAllSpecialistsRecorded !== undefined && !canManageInside && !canManageAll) {
      throw new Error("ФОТ может отметить только BUH Inside");
    }
    if (
      args.fotAllSpecialistsRecorded !== undefined &&
      ["draft", "hod_pending", "pending", "rejected"].includes(request.status)
    ) {
      throw new Error("ФОТ можно вынести после согласования заявки");
    }
    if (
      (args.amount !== undefined || args.amountWithVat !== undefined) &&
      !canManageInside &&
      !canManageOutsource &&
      !canManageAll
    ) {
      throw new Error("Not authorized");
    }
    if (
      (args.paymentDeadline !== undefined || args.shipmentDate !== undefined || args.finplanEntered !== undefined || args.finplanEntryIds !== undefined) &&
      !canManageOutsource &&
      !canManageAll
    ) {
      throw new Error("Not authorized");
    }

    validateOptionalMoney(args.amount, "Сумма без НДС");
    validateOptionalMoney(args.amountWithVat, "Сумма с НДС");
    const now = Date.now();
    const effectiveAmounts =
      args.amount !== undefined || args.amountWithVat !== undefined
        ? resolveRequestAmounts(
            {
              category: request.category,
              amount: args.amount ?? request.amount,
              amountWithVat: args.amountWithVat ?? request.amountWithVat,
              vatRate: request.vatRate,
            },
            request.specialists ?? [],
          )
        : undefined;
    const patch: Record<string, any> = {
      updatedAt: now,
    };
    if (effectiveAmounts) {
      patch.amount = effectiveAmounts.amount;
      patch.amountWithVat = effectiveAmounts.amountWithVat;
      patch.vatRate = effectiveAmounts.vatRate;
    }
    if (args.paymentDeadline !== undefined) {
      patch.paymentDeadline = args.paymentDeadline;
      patch.paymentDeadlineReminderLastDateKey = undefined;
    }
    if (args.shipmentDate !== undefined) {
      patch.shipmentDate = args.shipmentDate;
    }
    if (args.finplanEntered !== undefined) {
      patch.finplanEntered = args.finplanEntered;
    }
    if (args.finplanEntryIds !== undefined) {
      const values = normalizeFinplanIds(args.finplanEntryIds);
      patch.finplanEntryIds = values.length ? values : undefined;
      patch.finplanCostIds = undefined;
      if (values.length) {
        patch.finplanEntered = true;
      }
    }
    if (args.fotAllSpecialistsRecorded !== undefined) {
      patch.fotAllSpecialistsRecorded = args.fotAllSpecialistsRecorded;
    }

    const previousForDiff = { ...request };
    const nextForDiff = { ...request, ...patch };
    const changes = diffRequestFields(previousForDiff, nextForDiff);
    await ctx.db.patch(request._id, patch);
    if (changes.length) {
      await recordRequestChanges(
        ctx,
        request._id,
        email,
        record?.fullName ?? undefined,
        changes,
      );
    }
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "operational_fields_updated",
      title: "Обновлены финансовые поля",
      description: changes.map((change) => change.field).join(", ") || undefined,
      actorEmail: email,
      actorName: record?.fullName ?? undefined,
    });
    if (
      changes.length > 0 &&
      normalizeEmail(request.createdByEmail) !== normalizeEmail(email) &&
      (effectiveAmounts || args.paymentDeadline !== undefined || args.shipmentDate !== undefined)
    ) {
      await ctx.scheduler.runAfter(0, internal.emails.sendOperationalFieldsChanged, {
        requestId: request._id,
        summaryLines: changes.map(
          (change) => `${change.field}: ${change.fromValue || "—"} → ${change.toValue || "—"}`,
        ),
        actorEmail: email,
        actorName: record?.fullName ?? undefined,
      });
    }
    return { updated: true };
  },
});

export const updatePaymentStatus = mutation({
  args: {
    id: v.id("requests"),
    status: v.union(
      v.literal("awaiting_payment"),
      v.literal("payment_planned"),
      v.literal("partially_paid"),
      v.literal("paid"),
      v.literal("closed"),
      v.literal("reopen"),
    ),
    paymentPlannedAt: v.optional(v.number()),
    finplanEntryIdsRaw: v.optional(v.string()),
    finplanCostIdsRaw: v.optional(v.string()),
    actualPaidAmount: v.optional(v.number()),
    actualPaidAmountWithVat: v.optional(v.number()),
    actualPaidAt: v.optional(v.number()),
    plannedPaymentAmount: v.optional(v.number()),
    plannedPaymentAmountWithVat: v.optional(v.number()),
    planningMode: v.optional(v.union(v.literal("full"), v.literal("partial"))),
    paymentResidualAmount: v.optional(v.number()),
    paymentCurrencyRate: v.optional(v.number()),
    allowLatePaymentPlan: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    if (!record) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (request.isCanceled) {
      throw new Error("Сначала возобновите заявку");
    }

    const actorName = record.fullName?.trim() || undefined;
    const now = Date.now();
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    const canManagePayments =
      record.roles.some((role: string) =>
        ["BUH", "BUH Payment"].includes(role),
      ) || hasFinanceApproverRole(record);

    const canBuhReturnPaid =
      args.status === "awaiting_payment" &&
      request.status === "paid" &&
      canManagePayments;

    if (
      args.status === "awaiting_payment" &&
      !isCreator &&
      !record.roles.includes("ADMIN") &&
      !record.roles.includes("BUH Payment") &&
      !canBuhReturnPaid
    ) {
      throw new Error("Передать в оплату может только автор заявки");
    }
    if (args.status === "payment_planned" && !canManagePayments) {
      throw new Error("Только финотдел может запланировать оплату");
    }
    if (args.status === "partially_paid" && !canManagePayments) {
      throw new Error("Только финотдел может отметить частичную оплату");
    }
    if (args.status === "paid" && !canManagePayments) {
      throw new Error("Только финотдел может перевести в статус Оплачено");
    }
    if ((args.status === "closed" || args.status === "reopen") && !isCreator && !record.roles.includes("ADMIN")) {
      throw new Error("Изменить статус закрытой заявки может только автор");
    }

    if (args.status === "awaiting_payment" && !["approved", "paid"].includes(request.status)) {
      throw new Error("Передать в оплату можно только согласованную заявку");
    }
    if (
      args.status === "payment_planned" &&
      !["approved", "awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
    ) {
      throw new Error("Планировать оплату можно только по согласованной заявке");
    }
    if (
      args.status === "partially_paid" &&
      !["approved", "awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
    ) {
      throw new Error("Частичную оплату можно отметить только по согласованной заявке");
    }
    if (
      args.status === "paid" &&
      !["approved", "awaiting_payment", "payment_planned", "partially_paid", "paid"].includes(request.status)
    ) {
      throw new Error("Статус Оплачено доступен только по согласованной заявке");
    }
    if (args.status === "closed" && !["approved", "paid"].includes(request.status)) {
      throw new Error("Закрыть можно только согласованную или оплаченную заявку");
    }
    if (args.status === "reopen" && request.status !== "closed") {
      throw new Error("Открыть заново можно только закрытую заявку");
    }
    if (["payment_planned", "partially_paid", "paid"].includes(args.status)) {
      validateQuotaResolutionBeforePayment(request);
    }

    const rawFinplanIds = args.finplanEntryIdsRaw ?? args.finplanCostIdsRaw;
    const finplanCostIds =
      rawFinplanIds !== undefined
        ? parseFinplanIdsInput(rawFinplanIds)
        : getUnifiedFinplanCostIds(request);
    const requestFinplanCostPatch = {
      finplanEntryIds: finplanCostIds.length ? finplanCostIds : undefined,
      finplanCostIds: undefined,
      ...(finplanCostIds.length ? { finplanEntered: true } : {}),
    };

    validateOptionalMoney(args.actualPaidAmount, "Сумма оплаты без НДС");
    validateOptionalMoney(args.actualPaidAmountWithVat, "Сумма оплаты с НДС");
    validateOptionalMoney(args.plannedPaymentAmount, "Сумма следующего платежа без НДС");
    validateOptionalMoney(args.plannedPaymentAmountWithVat, "Сумма следующего платежа с НДС");
    validateOptionalMoney(args.paymentResidualAmount, "Остаток к оплате");
    validateOptionalRate(args.paymentCurrencyRate);
    if (args.actualPaidAt !== undefined && (!Number.isFinite(args.actualPaidAt) || args.actualPaidAt <= 0)) {
      throw new Error("Укажите дату оплаты");
    }

    const effectiveCurrencyRate = args.paymentCurrencyRate ?? request.paymentCurrencyRate;
    const previousTargetAmounts = getRequestPaymentTargetAmounts(request);
    if (
      request.currency !== "RUB" &&
      ["payment_planned", "partially_paid", "paid"].includes(args.status) &&
      !isPositiveFinite(effectiveCurrencyRate)
    ) {
      throw new Error("Для валютной заявки укажите курс валюты");
    }

    if (args.status === "awaiting_payment") {
      await ctx.db.patch(request._id, {
        status: args.status,
        awaitingPaymentAt: canBuhReturnPaid ? request.awaitingPaymentAt ?? now : now,
        awaitingPaymentByEmail: canBuhReturnPaid ? request.awaitingPaymentByEmail ?? email : email,
        awaitingPaymentByName: canBuhReturnPaid ? request.awaitingPaymentByName ?? actorName : actorName,
        paidAt: undefined,
        paidByEmail: undefined,
        paidByName: undefined,
        paymentPlannedAt: undefined,
        paymentPlannedByEmail: undefined,
        paymentPlannedByName: undefined,
        paymentResidualAmount: undefined,
        paymentResidualAmountWithVat: undefined,
        plannedPaymentAmount: undefined,
        plannedPaymentAmountWithVat: undefined,
        paymentCurrencyRate: undefined,
        ...requestFinplanCostPatch,
        paymentSplits: undefined,
        plannedPaymentSplits: undefined,
        actualPaidAmount: undefined,
        actualPaidAmountWithVat: undefined,
        paymentReminderSentAt: undefined,
        paymentDeadlineReminderLastDateKey: undefined,
        closeReminderSentAt: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_status_updated",
        title: canBuhReturnPaid ? "Статус возвращен в «Требуется оплата»" : "Заявка передана в оплату",
        actorEmail: email,
        actorName,
      });
      if (!canBuhReturnPaid) {
        if (record.roles.includes("BUH Payment")) {
          await ctx.scheduler.runAfter(0, internal.emails.sendPaymentRequestedToAuthor, {
            requestId: request._id,
            actorEmail: email,
            actorName,
          });
        } else {
          await ctx.scheduler.runAfter(0, internal.emails.sendPaymentRequested, {
            requestId: request._id,
          });
        }
        await schedulePaymentDeadlineReminders(ctx, request._id, getRequestPaymentDeadline(request));
      }
      return { status: args.status };
    }

    if (args.status === "payment_planned") {
      if (!args.paymentPlannedAt) {
        throw new Error("Укажите дату запланированной оплаты");
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (args.paymentPlannedAt < today.getTime()) {
        throw new Error("Дата оплаты не может быть раньше сегодняшнего дня");
      }
      const requestPaymentDeadline = getRequestPaymentDeadline(request);
      if (requestPaymentDeadline && args.paymentPlannedAt > requestPaymentDeadline && !args.allowLatePaymentPlan) {
        throw new Error("Дата оплаты позже даты, когда нужно оплатить");
      }
      const existingSplits = request.paymentSplits ?? [];
      const splitTotal = sumPaymentSplitAmounts(existingSplits);
      const splitTotalWithVat = sumPaymentSplitAmountsWithVat(existingSplits, request.vatRate);
      const existingPlannedSplits = request.plannedPaymentSplits ?? [];
      const archivedPlannedAmount = sumPlannedPaymentSplitAmounts(existingPlannedSplits);
      const archivedPlannedAmountWithVat = sumPlannedPaymentSplitAmountsWithVat(
        existingPlannedSplits,
        request.vatRate,
      );
      const currentPlannedAmounts = resolvePaymentAmountInput({
        amountWithoutVat: request.plannedPaymentAmount,
        amountWithVat: request.plannedPaymentAmountWithVat,
        vatRate: request.vatRate,
      });
      const nextStatus = (request.paymentSplits?.length ?? 0) > 0 ? "partially_paid" : "payment_planned";
      const explicitTargetAmounts = hasExplicitPaymentAmountInput(args)
        ? resolvePaymentAmountInput({
            amountWithoutVat: args.actualPaidAmount,
            amountWithVat: args.actualPaidAmountWithVat,
            vatRate: request.vatRate,
          })
        : null;
      const targetAmounts =
        explicitTargetAmounts?.amountWithoutVat !== undefined ||
        explicitTargetAmounts?.amountWithVat !== undefined
          ? explicitTargetAmounts
          : previousTargetAmounts;
      const targetAmount = targetAmounts.amountWithoutVat;
      const targetAmountWithVat = targetAmounts.amountWithVat;
      if (!isPositiveFinite(targetAmount)) {
        throw new Error("Укажите сумму планируемой оплаты");
      }
      if (existingSplits.length > 0 && targetAmount! <= splitTotal) {
        throw new Error("Остаток уже оплачен. Для завершения используйте кнопку «Оплачено»");
      }
      const remainingAmount = existingSplits.length > 0 ? targetAmount! - splitTotal : targetAmount!;
      const remainingAmountWithVat =
        targetAmountWithVat !== undefined
          ? existingSplits.length > 0
            ? Math.max(targetAmountWithVat - splitTotalWithVat, 0)
            : targetAmountWithVat
          : undefined;
      const unallocatedAmount = Math.max(
        remainingAmount -
          archivedPlannedAmount -
          (currentPlannedAmounts.amountWithoutVat ?? 0),
        0,
      );
      const unallocatedAmountWithVat =
        remainingAmountWithVat !== undefined
          ? Math.max(
              remainingAmountWithVat -
                archivedPlannedAmountWithVat -
                (currentPlannedAmounts.amountWithVat ?? 0),
              0,
            )
          : undefined;
      const canReplaceCurrentPlannedPayment =
        request.paymentPlannedAt !== undefined &&
        currentPlannedAmounts.amountWithoutVat !== undefined &&
        unallocatedAmount <= PAYMENT_EPSILON;
      const availablePlanningAmount = canReplaceCurrentPlannedPayment
        ? currentPlannedAmounts.amountWithoutVat ?? 0
        : unallocatedAmount;
      const availablePlanningAmountWithVat = canReplaceCurrentPlannedPayment
        ? currentPlannedAmounts.amountWithVat
        : unallocatedAmountWithVat;
      const explicitPlannedAmounts =
        args.plannedPaymentAmount !== undefined || args.plannedPaymentAmountWithVat !== undefined
          ? resolvePaymentAmountInput({
              amountWithoutVat: args.plannedPaymentAmount,
              amountWithVat: args.plannedPaymentAmountWithVat,
              vatRate: request.vatRate,
            })
          : null;
      const plannedAmount =
        explicitPlannedAmounts?.amountWithoutVat !== undefined
          ? explicitPlannedAmounts.amountWithoutVat
          : availablePlanningAmount;
      const plannedAmountWithVat =
        explicitPlannedAmounts?.amountWithVat !== undefined
          ? explicitPlannedAmounts.amountWithVat
          : availablePlanningAmountWithVat;
      const planningMode =
        args.planningMode ?? (explicitPlannedAmounts ? "partial" : "full");
      if (!isPositiveFinite(plannedAmount)) {
        throw new Error(
          planningMode === "partial"
            ? "Укажите сумму частичной оплаты"
            : "Укажите сумму планируемой оплаты",
        );
      }
      if (availablePlanningAmount <= PAYMENT_EPSILON) {
        throw new Error("Вся сумма уже распределена по платежам");
      }
      if (planningMode === "partial") {
        if (plannedAmount > availablePlanningAmount) {
          throw new Error("Сумма частичной оплаты не может быть больше остатка платежа");
        }
        if (isSamePaymentAmount(plannedAmount, availablePlanningAmount)) {
          throw new Error("Сумма совпадает с остатком платежа. Чтобы закрыть весь платеж, нажмите «Запланировать оплату»");
        }
      } else if (plannedAmount > availablePlanningAmount) {
        throw new Error("Сумма оплаты не может быть больше остатка платежа");
      }
      const nextPlannedPaymentSplits = canReplaceCurrentPlannedPayment
        ? existingPlannedSplits
        : archiveCurrentPlannedPayment(request, {
            actorEmail: email,
            actorName,
            currencyRate: effectiveCurrencyRate,
            now,
          });
      await ctx.db.patch(request._id, {
        status: nextStatus,
        paymentPlannedAt: args.paymentPlannedAt,
        paymentPlannedByEmail: email,
        paymentPlannedByName: actorName,
        plannedPaymentAmount: plannedAmount,
        plannedPaymentAmountWithVat: plannedAmountWithVat,
        paymentResidualAmount: remainingAmount,
        paymentResidualAmountWithVat: remainingAmountWithVat,
        paymentCurrencyRate: effectiveCurrencyRate,
        ...requestFinplanCostPatch,
        plannedPaymentSplits: nextPlannedPaymentSplits.length ? nextPlannedPaymentSplits : undefined,
        paymentReminderSentAt: undefined,
        paymentDeadlineReminderLastDateKey: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_planned",
        title: nextStatus === "partially_paid" ? "Обновлен следующий транш" : "Оплата запланирована",
        description: new Date(args.paymentPlannedAt).toLocaleDateString("ru-RU"),
        actorEmail: email,
        actorName,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendPaymentPlanned, {
        requestId: request._id,
      });
      await schedulePaymentDeadlineReminders(ctx, request._id, getRequestPaymentDeadline(request));
      await schedulePlannedPaymentReminder(ctx, request._id, args.paymentPlannedAt);
      if (hasPaymentAmountDifference(previousTargetAmounts, targetAmounts)) {
        await ctx.scheduler.runAfter(0, internal.emails.sendPaymentAmountChanged, {
          requestId: request._id,
          previousAmount: previousTargetAmounts.amountWithoutVat,
          previousAmountWithVat: previousTargetAmounts.amountWithVat,
          nextAmount: targetAmounts.amountWithoutVat,
          nextAmountWithVat: targetAmounts.amountWithVat,
          actorEmail: email,
          actorName,
          changedAt: now,
        });
      }
      return { status: nextStatus };
    }

    if (args.status === "partially_paid") {
      const resolvedCurrentPayment = resolvePaymentAmountInput({
        amountWithoutVat: args.actualPaidAmount,
        amountWithVat: args.actualPaidAmountWithVat,
        vatRate: request.vatRate,
      });
      const fallbackCurrentPayment =
        resolvedCurrentPayment.amountWithoutVat !== undefined ||
        resolvedCurrentPayment.amountWithVat !== undefined
          ? resolvedCurrentPayment
          : resolvePaymentAmountInput({
              amountWithoutVat: request.plannedPaymentAmount,
              amountWithVat: request.plannedPaymentAmountWithVat,
              vatRate: request.vatRate,
            });
      if (!isPositiveFinite(fallbackCurrentPayment.amountWithoutVat)) {
        throw new Error("Укажите сумму текущего платежа");
      }
      const existingSplits = request.paymentSplits ?? [];
      if (existingSplits.length >= 5) {
        throw new Error("Можно указать не более 5 траншей");
      }
      const currentTargetAmounts = getRequestPaymentTargetAmounts(request);
      const remainingBeforePayment = getRequestPaymentRemainingAmounts(request);
      if (
        remainingBeforePayment.amountWithoutVat === undefined ||
        remainingBeforePayment.amountWithoutVat <= 0
      ) {
        throw new Error("Остаток уже оплачен. Для завершения используйте кнопку «Оплачено»");
      }
      if (fallbackCurrentPayment.amountWithoutVat! > remainingBeforePayment.amountWithoutVat) {
        throw new Error("Сумма частичной оплаты не может быть больше остатка платежа");
      }
      if (fallbackCurrentPayment.amountWithoutVat! === remainingBeforePayment.amountWithoutVat) {
        throw new Error("Сумма совпадает с остатком платежа. Чтобы закрыть весь платеж, нажмите «Оплачено»");
      }
      const paidAt = args.actualPaidAt ?? now;
      if (args.paymentPlannedAt) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (args.paymentPlannedAt < today.getTime()) {
          throw new Error("Дата оплаты не может быть раньше сегодняшнего дня");
        }
        const requestPaymentDeadline = getRequestPaymentDeadline(request);
        if (requestPaymentDeadline && args.paymentPlannedAt > requestPaymentDeadline && !args.allowLatePaymentPlan) {
          throw new Error("Дата оплаты позже даты, когда нужно оплатить");
        }
      }
      const splitTotal = sumPaymentSplitAmounts(existingSplits);
      const splitTotalWithVat = sumPaymentSplitAmountsWithVat(existingSplits, request.vatRate);
      const cumulativePaid = splitTotal + fallbackCurrentPayment.amountWithoutVat!;
      const cumulativePaidWithVat = splitTotalWithVat + (fallbackCurrentPayment.amountWithVat ?? 0);
      const nextResidualAmount = Math.max(
        (currentTargetAmounts.amountWithoutVat ?? 0) - cumulativePaid,
        0,
      );
      const nextResidualAmountWithVat =
        currentTargetAmounts.amountWithVat !== undefined
          ? Math.max(currentTargetAmounts.amountWithVat - cumulativePaidWithVat, 0)
          : undefined;
      const updatedPlannedQueue = consumePlannedPaymentQueue(
        request,
        fallbackCurrentPayment.amountWithoutVat!,
      );
      const nextSplit = {
        splitNumber: getNextPaymentSplitNumber({
          paymentSplits: existingSplits,
          plannedPaymentSplits: updatedPlannedQueue.plannedPaymentSplits,
        }),
        amountWithoutVat: fallbackCurrentPayment.amountWithoutVat!,
        amountWithVat: fallbackCurrentPayment.amountWithVat,
        vatRate: request.vatRate,
        currencyRate: effectiveCurrencyRate,
        paidAt,
        nextPaymentAt: args.paymentPlannedAt,
        remainingAmountWithoutVat: nextResidualAmount,
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        actorEmail: email,
        actorName,
        createdAt: now,
      };
      const updatedSplits = [...existingSplits, nextSplit];
      await ctx.db.patch(request._id, {
        status: "partially_paid",
        paymentSplits: updatedSplits,
        plannedPaymentSplits: updatedPlannedQueue.plannedPaymentSplits.length
          ? updatedPlannedQueue.plannedPaymentSplits
          : undefined,
        paymentPlannedAt: updatedPlannedQueue.paymentPlannedAt,
        paymentPlannedByEmail: updatedPlannedQueue.paymentPlannedAt ? request.paymentPlannedByEmail : undefined,
        paymentPlannedByName: updatedPlannedQueue.paymentPlannedAt ? request.paymentPlannedByName : undefined,
        paymentResidualAmount: nextResidualAmount,
        paymentResidualAmountWithVat: nextResidualAmountWithVat,
        plannedPaymentAmount: updatedPlannedQueue.plannedPaymentAmount,
        plannedPaymentAmountWithVat: updatedPlannedQueue.plannedPaymentAmountWithVat,
        paymentCurrencyRate: effectiveCurrencyRate,
        ...requestFinplanCostPatch,
        actualPaidAmount: cumulativePaid,
        actualPaidAmountWithVat: cumulativePaidWithVat > 0 ? cumulativePaidWithVat : undefined,
        paymentReminderSentAt: undefined,
        paymentDeadlineReminderLastDateKey: undefined,
        closeReminderSentAt: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_partially_paid",
        title: "Отмечена частичная оплата",
        description: `${fallbackCurrentPayment.amountWithoutVat} ${request.currency} без НДС, остаток ${nextResidualAmount} ${request.currency}`,
        actorEmail: email,
        actorName,
      });
      if (args.paymentPlannedAt) {
        await schedulePaymentDeadlineReminders(ctx, request._id, getRequestPaymentDeadline(request));
        await schedulePlannedPaymentReminder(ctx, request._id, args.paymentPlannedAt);
      }
      return { status: "partially_paid" };
    }

    if (args.status === "paid") {
      const existingSplits = request.paymentSplits ?? [];
      const splitTotal = sumPaymentSplitAmounts(existingSplits);
      const splitTotalWithVat = sumPaymentSplitAmountsWithVat(existingSplits, request.vatRate);
      const currentTargetAmounts = getRequestPaymentTargetAmounts(request);
      const remainingBeforePayment = getRequestPaymentRemainingAmounts(request);
      const explicitFinalPayment = hasExplicitPaymentAmountInput(args)
        ? resolvePaymentAmountInput({
            amountWithoutVat: args.actualPaidAmount,
            amountWithVat: args.actualPaidAmountWithVat,
            vatRate: request.vatRate,
          })
        : null;
      const resolvedFinalPayment =
        explicitFinalPayment?.amountWithoutVat !== undefined ||
        explicitFinalPayment?.amountWithVat !== undefined
          ? explicitFinalPayment
          : remainingBeforePayment;
      const finalPaidAmount =
        existingSplits.length > 0
          ? splitTotal + (resolvedFinalPayment.amountWithoutVat ?? 0)
          : resolvedFinalPayment.amountWithoutVat;
      const finalPaidAmountWithVat =
        existingSplits.length > 0
          ? splitTotalWithVat + (resolvedFinalPayment.amountWithVat ?? 0)
          : resolvedFinalPayment.amountWithVat;
      if (!isPositiveFinite(finalPaidAmount)) {
        throw new Error("Укажите сумму оплаты");
      }
      if (
        remainingBeforePayment.amountWithoutVat !== undefined &&
        resolvedFinalPayment.amountWithoutVat !== undefined &&
        resolvedFinalPayment.amountWithoutVat > remainingBeforePayment.amountWithoutVat &&
        !hasPaymentAmountDifference(currentTargetAmounts, {
          amountWithoutVat: finalPaidAmount,
          amountWithVat: finalPaidAmountWithVat,
        })
      ) {
        throw new Error("Сумма оплаты превышает остаток");
      }
      const paidAt = args.actualPaidAt ?? now;
      await ctx.db.patch(request._id, {
        status: args.status,
        paidAt,
        paidByEmail: email,
        paidByName: actorName,
        ...requestFinplanCostPatch,
        actualPaidAmount: finalPaidAmount,
        actualPaidAmountWithVat: finalPaidAmountWithVat,
        paymentResidualAmount: undefined,
        paymentResidualAmountWithVat: undefined,
        plannedPaymentAmount: finalPaidAmount,
        plannedPaymentAmountWithVat: finalPaidAmountWithVat,
        paymentCurrencyRate: effectiveCurrencyRate,
        paymentPlannedAt: undefined,
        paymentPlannedByEmail: undefined,
        paymentPlannedByName: undefined,
        plannedPaymentSplits: undefined,
        closeReminderSentAt: undefined,
        paymentReminderSentAt: undefined,
        paymentDeadlineReminderLastDateKey: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_paid",
        title: "Заявка отмечена как оплаченная",
        actorEmail: email,
        actorName,
        description:
          finalPaidAmount !== undefined
            ? `${finalPaidAmount} ${request.currency} без НДС`
            : undefined,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendPaidNotification, {
        requestId: request._id,
      });
      if (
        hasPaymentAmountDifference(currentTargetAmounts, {
          amountWithoutVat: finalPaidAmount,
          amountWithVat: finalPaidAmountWithVat,
        })
      ) {
        await ctx.scheduler.runAfter(0, internal.emails.sendPaymentAmountChanged, {
          requestId: request._id,
          previousAmount: currentTargetAmounts.amountWithoutVat,
          previousAmountWithVat: currentTargetAmounts.amountWithVat,
          nextAmount: finalPaidAmount,
          nextAmountWithVat: finalPaidAmountWithVat,
          actorEmail: email,
          actorName,
          changedAt: now,
        });
      }
      await ctx.scheduler.runAfter(
        Math.max(0, addBusinessDays(now, 2) - now),
        internal.emails.sendCloseDeadlineReminder,
        {
          requestId: request._id,
          paidAt,
        },
      );
      return { status: args.status };
    }

    if (args.status === "reopen") {
      const nextStatus = request.previousClosedStatus;
      if (!nextStatus) {
        throw new Error("Не удалось определить предыдущий статус заявки");
      }
      await ctx.db.patch(request._id, {
        status: nextStatus,
        previousClosedStatus: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "request_reopened",
        title: "Заявка открыта заново",
        description:
          nextStatus === "approved"
            ? "Заявка возвращена в статус «Согласовано»"
            : "Заявка возвращена в статус «Оплачено»",
        actorEmail: email,
        actorName,
      });
      return { status: nextStatus };
    }

    await ctx.db.patch(request._id, {
      status: "closed",
      previousClosedStatus: request.status === "paid" ? "paid" : "approved",
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "request_closed",
      title: request.status === "approved" ? "Заявка закрыта без оплаты" : "Заявка закрыта",
      actorEmail: email,
      actorName,
    });
    return { status: "closed" };
  },
});

export const cancelPaymentEntry = mutation({
  args: {
    id: v.id("requests"),
    entryType: v.union(
      v.literal("planned_current"),
      v.literal("planned_split"),
      v.literal("paid_split"),
    ),
    splitNumber: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const record = await getRoleRecord(ctx, email);
    if (
      !record ||
      (!record.roles.some((role: string) => ["BUH", "ADMIN", "BUH Payment"].includes(role)) &&
        !hasFinanceApproverRole(record))
    ) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (!["awaiting_payment", "payment_planned", "partially_paid", "paid"].includes(request.status)) {
      throw new Error("Отменять платежи можно только в оплате");
    }

    const actorName = record.fullName?.trim() || undefined;
    const now = Date.now();

    if (args.entryType === "planned_current") {
      const currentPlanned = resolvePaymentAmountInput({
        amountWithoutVat: request.plannedPaymentAmount,
        amountWithVat: request.plannedPaymentAmountWithVat,
        vatRate: request.vatRate,
      });
      if (!request.paymentPlannedAt || currentPlanned.amountWithoutVat === undefined) {
        throw new Error("Текущий запланированный платеж не найден");
      }
      const nextStatus = getPaymentProgressStatus({
        paidSplitsCount: (request.paymentSplits ?? []).length,
        hasPlannedPayments: (request.plannedPaymentSplits?.length ?? 0) > 0,
      });
      await ctx.db.patch(args.id, {
        status: nextStatus,
        paymentPlannedAt: undefined,
        paymentPlannedByEmail: undefined,
        paymentPlannedByName: undefined,
        plannedPaymentAmount: undefined,
        plannedPaymentAmountWithVat: undefined,
        paymentReminderSentAt: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_plan_canceled",
        title: "Отменен запланированный платеж",
        actorEmail: email,
        actorName,
      });
      return { canceled: true };
    }

    if (args.entryType === "planned_split") {
      if (!args.splitNumber) {
        throw new Error("Не указан номер запланированного платежа");
      }
      const nextPlannedSplits = (request.plannedPaymentSplits ?? []).filter(
        (split) => split.splitNumber !== args.splitNumber,
      );
      if (nextPlannedSplits.length === (request.plannedPaymentSplits?.length ?? 0)) {
        throw new Error("Запланированный платеж не найден");
      }
      const nextStatus = getPaymentProgressStatus({
        paidSplitsCount: (request.paymentSplits ?? []).length,
        hasPlannedPayments:
          nextPlannedSplits.length > 0 ||
          (request.paymentPlannedAt !== undefined &&
            request.plannedPaymentAmount !== undefined),
      });
      await ctx.db.patch(args.id, {
        status: nextStatus,
        plannedPaymentSplits: nextPlannedSplits.length ? nextPlannedSplits : undefined,
        paymentReminderSentAt: undefined,
        updatedAt: now,
      });
      await logTimelineEvent(ctx, {
        requestId: request._id,
        type: "payment_plan_canceled",
        title: `Отменен платеж ${args.splitNumber}`,
        actorEmail: email,
        actorName,
      });
      return { canceled: true };
    }

    if (!args.splitNumber) {
      throw new Error("Не указан номер проведенного платежа");
    }
    const nextPaidSplits = (request.paymentSplits ?? []).filter(
      (split) => split.splitNumber !== args.splitNumber,
    );
    if (nextPaidSplits.length === (request.paymentSplits?.length ?? 0)) {
      throw new Error("Проведенный платеж не найден");
    }
    const targetAmounts = getRequestPaymentTargetAmounts(request);
    const paidTotalWithoutVat = sumPaymentSplitAmounts(nextPaidSplits);
    const paidTotalWithVat = sumPaymentSplitAmountsWithVat(nextPaidSplits, request.vatRate);
    const nextResidualAmount = Math.max((targetAmounts.amountWithoutVat ?? 0) - paidTotalWithoutVat, 0);
    const nextResidualAmountWithVat =
      targetAmounts.amountWithVat !== undefined
        ? Math.max(targetAmounts.amountWithVat - paidTotalWithVat, 0)
        : undefined;
    const nextStatus = getPaymentProgressStatus({
      paidSplitsCount: nextPaidSplits.length,
      hasPlannedPayments:
        (request.plannedPaymentSplits?.length ?? 0) > 0 ||
        (request.paymentPlannedAt !== undefined && request.plannedPaymentAmount !== undefined),
    });

    await ctx.db.patch(args.id, {
      status: nextStatus,
      paymentSplits: nextPaidSplits.length ? nextPaidSplits : undefined,
      actualPaidAmount: paidTotalWithoutVat > 0 ? paidTotalWithoutVat : undefined,
      actualPaidAmountWithVat: paidTotalWithVat > 0 ? paidTotalWithVat : undefined,
      paymentResidualAmount: nextResidualAmount > 0 ? nextResidualAmount : undefined,
      paymentResidualAmountWithVat:
        nextResidualAmountWithVat !== undefined && nextResidualAmountWithVat > 0
          ? nextResidualAmountWithVat
          : undefined,
      paidAt: undefined,
      paidByEmail: undefined,
      paidByName: undefined,
      closeReminderSentAt: undefined,
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "payment_canceled",
      title: `Отменен проведенный платеж ${args.splitNumber}`,
      actorEmail: email,
      actorName,
    });
    return { canceled: true };
  },
});

export const remindPayment = mutation({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await getCurrentEmail(ctx);
    if (!email) {
      throw new Error("Missing user email");
    }
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }
    const roleRecord = await getRoleRecord(ctx, email);
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    const canRemind =
      isCreator ||
      roleRecord?.roles?.includes("ADMIN") ||
      hasFinanceApproverRole(roleRecord) ||
      roleRecord?.roles?.includes("BUH") ||
      roleRecord?.roles?.includes("BUH Payment");
    if (!canRemind) {
      throw new Error("Not authorized");
    }
    if (!isOpenPaymentTask(request)) {
      throw new Error("Напоминание об оплате можно отправить только по заявке, ожидающей оплаты");
    }
    await ctx.scheduler.runAfter(0, internal.emails.sendManualPaymentReminder, {
      requestId: args.requestId,
      remindedByEmail: email,
      remindedByName: roleRecord?.fullName ?? undefined,
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "payment_reminder_sent",
      title: "Отправлено напоминание об оплате",
      actorEmail: email,
      actorName: roleRecord?.fullName ?? undefined,
    });
    return { reminded: true };
  },
});

export const markReminderSent = internalMutation({
  args: {
    requestId: v.id("requests"),
    kind: v.union(v.literal("approval"), v.literal("payment"), v.literal("close")),
    expectedAt: v.number(),
    dateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return;
    }
    if (args.kind === "approval" && request.approvalDeadline === args.expectedAt) {
      await ctx.db.patch(args.requestId, { approvalReminderSentAt: Date.now() });
      return;
    }
    if (args.kind === "payment" && request.paymentPlannedAt === args.expectedAt) {
      await ctx.db.patch(args.requestId, { paymentReminderSentAt: Date.now() });
      return;
    }
    if (args.kind === "payment" && args.dateKey) {
      await ctx.db.patch(args.requestId, {
        paymentReminderSentAt: Date.now(),
        paymentDeadlineReminderLastDateKey: args.dateKey,
      });
      return;
    }
    if (args.kind === "close" && request.paidAt === args.expectedAt) {
      await ctx.db.patch(args.requestId, { closeReminderSentAt: Date.now() });
    }
  },
});
