import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";
import {
  AI_TOOLS_REQUEST_CATEGORY,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  COMPANY_PROFIT_FUNDING_SOURCE,
  INTERNAL_COSTS_FUNDING_SOURCE,
  PRESALES_FUNDING_SOURCE,
  SERVICE_PURCHASE_CATEGORY,
  getFundingOwnerRoles,
  isFundingSourceAllowedForCategory,
  isServiceRecipientCategory,
  normalizeRequestCategory,
} from "../src/lib/requestRules";
import {
  calculateIncomingRatio,
  formatMonthKeyLabel,
  getPaymentMethodOptions,
  isContestSpecialistValidated,
  isPaidByTimestampAllowed,
  normalizeContestSpecialistSource,
  requiresContestSpecialistValidation,
} from "../src/lib/requestFields";
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

const requestCategoryCodes: Record<string, string> = {
  "Welcome-бонус": "WB",
  "Подарки": "GI",
  "Конкурсное задание": "CT",
  [SERVICE_PURCHASE_CATEGORY]: "SV",
  [CLIENT_SERVICES_TRANSIT_CATEGORY]: "TR",
  [AI_TOOLS_REQUEST_CATEGORY]: "AI",
  "Неформальное мероприятие": "EV",
  "Совместный мерч": "MR",
};

const fundingSourceCodes: Record<string, string> = {
  "Отгрузки проекта": "RP",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квоты на AI-инструменты": "QT",
  "Квота на внутренние затраты": "QI",
  "Я не знаю": "UN",
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

async function getRoleRecord(ctx: { db: any }, email: string) {
  return await ctx.db
    .query("roles")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();
}

function normalizeSpecialists(
  specialists: Array<{
    id: string;
    name: string;
    sourceType?: string;
    department?: string;
    hours?: number;
    directCost?: number;
    hodConfirmed?: boolean;
    validationSkipped?: boolean;
  }>,
) {
  return specialists
    .map((item) => ({
      id: item.id,
      name: item.name?.trim() ?? "",
      sourceType: normalizeContestSpecialistSource(item.sourceType),
      department: item.department?.trim() || undefined,
      hours:
        typeof item.hours === "number" && Number.isFinite(item.hours)
          ? item.hours
          : undefined,
      directCost:
        typeof item.directCost === "number" && Number.isFinite(item.directCost)
          ? item.directCost
          : undefined,
      hodConfirmed: item.validationSkipped ? true : item.hodConfirmed ?? false,
      validationSkipped: item.validationSkipped ?? false,
    }))
    .filter(
      (item) =>
        item.name ||
        item.department ||
        item.hours !== undefined ||
        item.directCost !== undefined ||
        item.validationSkipped,
    );
}

function hasContestSpecialists(specialists: Array<{ name: string; department?: string; hours?: number; directCost?: number }>) {
  return specialists.some(
    (item) =>
      item.name ||
      item.department ||
      item.hours !== undefined ||
      item.directCost !== undefined,
  );
}

function hasContestDepartments(
  specialists: Array<{ department?: string; validationSkipped?: boolean }>,
) {
  return specialists.some((item) => requiresContestSpecialistValidation(item));
}

function isDepartmentSpecialistReady(
  specialist: {
    department?: string;
    directCost?: number;
    hodConfirmed?: boolean;
    validationSkipped?: boolean;
  },
) {
  return isContestSpecialistValidated(specialist);
}

function areContestDepartmentsValidated(
  specialists: Array<{
    department?: string;
    directCost?: number;
    hodConfirmed?: boolean;
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
  specialists: Array<{ directCost?: number }> = [],
  fallbackAmount: number,
) {
  if (category !== "Конкурсное задание" || !hasContestSpecialists(specialists as any)) {
    return fallbackAmount;
  }
  return specialists.reduce(
    (sum, item) =>
      sum +
      (typeof item.directCost === "number" && Number.isFinite(item.directCost) ? item.directCost : 0),
    0,
  );
}

function hasHodAccessToRequest(roleRecord: any, request: any) {
  if (!roleRecord?.roles?.includes("HOD")) {
    return false;
  }
  const departments = roleRecord.hodDepartments ?? [];
  if (!departments.length) {
    return false;
  }
  const specialists = request.specialists ?? [];
  return specialists.some(
    (item: any) =>
      requiresContestSpecialistValidation(item) && departments.includes(item.department),
  );
}

async function hasHistoricalApprovalAccess(ctx: { db: any }, requestId: any, email: string) {
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_request", (q: any) => q.eq("requestId", requestId))
    .collect();
  return approvals.some((approval: any) => approval.reviewerEmail === email);
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

function parseFinplanCostIds(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /^\d+$/.test(item)),
    ),
  );
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
      finplanCostIds: request.finplanCostIds?.length ? request.finplanCostIds : undefined,
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

function resolveRequestAmounts(
  params: {
    category: string;
    amount: number;
    amountWithVat?: number;
    vatRate?: number;
  },
  specialists: Array<{ directCost?: number }> = [],
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
  sourceType: v.optional(v.string()),
  department: v.optional(v.string()),
  hours: v.optional(v.number()),
  directCost: v.optional(v.number()),
  hodConfirmed: v.optional(v.boolean()),
  validationSkipped: v.optional(v.boolean()),
});

const paymentDueFilterEnum = v.union(v.literal("today"), v.literal("overdue"));

const requestPayloadValidator = {
  title: v.string(),
  category: v.string(),
  amount: v.number(),
  amountWithVat: v.optional(v.number()),
  vatRate: v.optional(v.number()),
  currency: v.string(),
  fundingSource: v.string(),
  counterparty: v.string(),
  paymentMethod: v.optional(v.string()),
  justification: v.string(),
  details: v.optional(v.string()),
  investmentReturn: v.optional(v.string()),
  clientName: v.string(),
  contacts: v.array(v.string()),
  relatedRequests: v.optional(v.array(v.string())),
  links: v.array(v.string()),
  financePlanLinks: v.optional(v.array(v.string())),
  incomingAmount: v.optional(v.number()),
  incomingAmountWithVat: v.optional(v.number()),
  shipmentDate: v.optional(v.number()),
  shipmentMonth: v.optional(v.string()),
  specialists: v.optional(v.array(specialistValidator)),
  approvalDeadline: v.optional(v.number()),
  neededBy: v.optional(v.number()),
  paidBy: v.optional(v.number()),
  requiredRoles: v.array(roleEnum),
  submit: v.boolean(),
};

const requestFieldLabels: Record<string, string> = {
  title: "На что нужен бюджет",
  category: "Категория",
  amount: "Сумма без НДС",
  amountWithVat: "Сумма с НДС",
  vatRate: "НДС",
  currency: "Валюта",
  fundingSource: "Источник финансирования",
  counterparty: "Кому платим мы",
  paymentMethod: "Способ оплаты",
  justification: "Обоснование",
  details: "Детали заявки",
  investmentReturn: "Как будем возвращать инвестиции",
  clientName: "Клиент / получатель сервиса",
  contacts: "Контакты клиента",
  relatedRequests: "Связанные заявки",
  links: "Ссылки на материалы",
  financePlanLinks: "ID и название отгрузки в финплане",
  incomingAmount: "Сумма отгрузки без НДС",
  incomingAmountWithVat: "Сумма отгрузки с НДС",
  incomingRatio: "Коэффициент транзита",
  shipmentDate: "Дата отгрузки",
  shipmentMonth: "Дата отгрузки",
  specialists: "Участники конкурсного задания",
  approvalDeadline: "Дедлайн согласования",
  neededBy: "Когда нужно оплатить",
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
      field === "paidBy" ||
      field === "shipmentDate"
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
            specialist.sourceType === "contractor" ? "Подрядчик" : "Внутренний специалист",
            specialist.name,
            specialist.department,
            specialist.hours !== undefined ? `${specialist.hours} ч` : undefined,
            specialist.directCost !== undefined ? `${specialist.directCost}` : undefined,
            specialist.validationSkipped ? "валидация не требуется" : undefined,
            specialist.hodConfirmed ? "подтверждено HoD" : undefined,
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
    "amount",
    "amountWithVat",
    "vatRate",
    "currency",
    "fundingSource",
    "counterparty",
    "paymentMethod",
    "justification",
    "details",
    "investmentReturn",
    "clientName",
    "contacts",
    "relatedRequests",
    "links",
    "financePlanLinks",
    "incomingAmount",
    "incomingAmountWithVat",
    "incomingRatio",
    "shipmentDate",
    "shipmentMonth",
    "specialists",
    "approvalDeadline",
    "neededBy",
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
    infoLines.push("Изменение категории не сбросит согласование, но уведомит уже согласовавших.");
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
  const normalizedSpecialists = normalizeSpecialists(args.specialists ?? []);
  const contestWithSpecialists =
    args.category === "Конкурсное задание" && hasContestSpecialists(normalizedSpecialists);
  const allowedPaymentMethods = getPaymentMethodOptions(args.category);
  validateOptionalVatRate(args.vatRate);
  validateOptionalMoney(args.amount, "Сумма без НДС");
  validateOptionalMoney(args.amountWithVat, "Сумма с НДС");
  validateOptionalMoney(args.incomingAmount, "Сумма отгрузки без НДС");
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
  const effectiveAmounts = resolveRequestAmounts(
    {
      category: args.category,
      amount: args.amount,
      amountWithVat: args.amountWithVat,
      vatRate: args.vatRate,
    },
    normalizedSpecialists,
  );
  const effectiveAmount = effectiveAmounts.amount;
  if (
    (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) &&
    !(contestWithSpecialists && effectiveAmount === 0)
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
  if (
    args.category !== "Welcome-бонус" &&
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
  if (!args.neededBy) {
    throw new Error("Укажите, когда нужно оплатить");
  }
  if (!isFundingSourceAllowedForCategory(args.category, args.fundingSource)) {
    throw new Error("Так не бывает");
  }
  if (
    args.approvalDeadline !== undefined &&
    args.neededBy !== undefined &&
    args.approvalDeadline > args.neededBy
  ) {
    throw new Error("Дедлайн согласования должен быть не позже даты, когда нужно оплатить");
  }
  if (args.approvalDeadline !== undefined) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (args.approvalDeadline < tomorrow.getTime()) {
      throw new Error("Дедлайн согласования должен быть не раньше завтрашнего дня");
    }
  }
  if (args.neededBy !== undefined) {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (args.neededBy < tomorrow.getTime()) {
      throw new Error("Дата оплаты должна быть не раньше завтрашнего дня");
    }
  }
  if (args.paidBy !== undefined && !isPaidByTimestampAllowed(args.paidBy)) {
    throw new Error("AGIMA тогда еще не было");
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
    args.category !== "Конкурсное задание" &&
    args.category !== "Welcome-бонус" &&
    args.fundingSource === "Отгрузки проекта" &&
    (!args.financePlanLinks || args.financePlanLinks.length === 0)
  ) {
    throw new Error("Финплан обязателен для отгрузок проекта");
  }
  if (args.fundingSource === PRESALES_FUNDING_SOURCE && !args.requiredRoles.includes("NBD")) {
    throw new Error("Для квот NBD обязателен NBD");
  }
  if (
    args.fundingSource === "Квоты на AI-инструменты" &&
    !args.requiredRoles.includes("AI-BOSS")
  ) {
    throw new Error("Для квот на AI-инструменты обязателен AI-BOSS");
  }
  if (
    args.fundingSource === INTERNAL_COSTS_FUNDING_SOURCE &&
    !args.requiredRoles.includes("COO")
  ) {
    throw new Error("Для квоты на внутренние затраты обязателен COO");
  }
  if (
    args.fundingSource === COMPANY_PROFIT_FUNDING_SOURCE &&
    (!args.requiredRoles.includes("COO") || !args.requiredRoles.includes("CFD"))
  ) {
    throw new Error("Для прибыли компании обязательны COO и CFD");
  }
  if (args.category === "Welcome-бонус" && (!args.investmentReturn || !args.investmentReturn.trim())) {
    throw new Error("Укажите, как будем возвращать инвестиции");
  }
  if (isServiceRecipientCategory(args.category) && (!args.clientName || !args.clientName.trim())) {
    throw new Error("Укажите получателя сервиса");
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

function isOpenPaymentTask(request: { status: string; neededBy?: number; isCanceled?: boolean }) {
  return (
    !request.isCanceled &&
    request.neededBy !== undefined &&
    ["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
  );
}

async function createApprovalsForRequest(
  ctx: { db: any },
  params: {
    requestId: any;
    requiredRoles: string[];
    autoApprovedRoles: string[];
    now: number;
    userId: any;
    email: string;
  },
) {
  for (const role of params.requiredRoles) {
    await ctx.db.insert("approvals", {
      requestId: params.requestId,
      role,
      status: params.autoApprovedRoles.includes(role) ? "approved" : "pending",
      decidedAt: params.autoApprovedRoles.includes(role) ? params.now : undefined,
      reviewerId: params.autoApprovedRoles.includes(role) ? params.userId : undefined,
      reviewerEmail: params.autoApprovedRoles.includes(role) ? params.email : undefined,
    });
  }
  const pendingRoles = params.requiredRoles.filter(
    (role) => !params.autoApprovedRoles.includes(role),
  );
  return pendingRoles.length === 0 ? "approved" : "pending";
}

export const listMyRequests = query({
  args: {
    status: v.optional(requestStatus),
    category: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    createdFrom: v.optional(v.number()),
    createdTo: v.optional(v.number()),
    requestCodeQuery: v.optional(v.string()),
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
    createdByEmail: v.optional(v.string()),
    cfdTag: v.optional(v.string()),
    category: v.optional(v.string()),
    fundingSource: v.optional(v.string()),
    paymentDueFilter: v.optional(paymentDueFilterEnum),
    createdFrom: v.optional(v.number()),
    createdTo: v.optional(v.number()),
    requestCodeQuery: v.optional(v.string()),
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
    const canViewAll = record?.roles?.some((role: string) =>
      ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN", "HOD"].includes(role),
    );
    const hasReviewedAny = email
      ? (
          await ctx.db
            .query("approvals")
            .filter((q: any) => q.eq(q.field("reviewerEmail"), email))
            .take(1)
        ).length > 0
      : false;
    if (!canViewAll && !hasReviewedAny) {
      throw new Error("Not authorized");
    }

    const baseQuery = args.status
      ? ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", args.status!))
      : ctx.db.query("requests");
    const requests = await baseQuery.order("desc").collect();
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const hasExplicitDateRange = args.createdFrom !== undefined || args.createdTo !== undefined;
    const todayBounds = getTodayBounds();
    const filtered = requests.filter((req) => {
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
      if (args.paymentDueFilter === "today") {
        if (
          !isOpenPaymentTask(req) ||
          req.neededBy! < todayBounds.start ||
          req.neededBy! > todayBounds.end
        ) {
          return false;
        }
      }
      if (args.paymentDueFilter === "overdue") {
        if (!isOpenPaymentTask(req) || req.neededBy! >= todayBounds.start) {
          return false;
        }
      }
      if (!hasExplicitDateRange && (req.archivedAt || req.createdAt < oneYearAgo)) {
        return false;
      }
      return true;
    });
    const scopedToCurrentRole =
      record?.roles?.includes("HOD") &&
      !record.roles.some((role: string) => ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN"].includes(role))
        ? filtered.filter((req) => hasHodAccessToRequest(record, req))
        : canViewAll
          ? filtered
          : [];
    const withHistorical = hasReviewedAny
      ? [
          ...scopedToCurrentRole,
          ...filtered.filter((req) => req.createdBy === userId || req.createdByEmail === email),
          ...(
            await Promise.all(
              filtered.map(async (req) =>
                (await hasHistoricalApprovalAccess(ctx, req._id, email)) ? req : null,
              ),
            )
          ).filter((req): req is any => Boolean(req)),
        ]
      : scopedToCurrentRole;
    const deduped = Array.from(new Map(withHistorical.map((req) => [req._id, req])).values());
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
    const canViewAll = record?.roles?.some((role: string) =>
      ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN"].includes(role),
    );
    const canHodView = hasHodAccessToRequest(record, request);
    const canViewByHistory = await hasHistoricalApprovalAccess(ctx, args.id, email);
    if (
      !canViewAll &&
      !canHodView &&
      !canViewByHistory &&
      request.createdBy !== userId &&
      request.createdByEmail !== email
    ) {
      throw new Error("Not authorized");
    }
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    const isCreator = request.createdBy === userId || request.createdByEmail === email;
    return {
      request,
      approvals,
      isCreator,
      canHodEditSpecialists: canHodView,
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
    const canViewAll = record?.roles?.some((role: string) =>
      ["NBD", "AI-BOSS", "COO", "CFD", "BUH", "ADMIN"].includes(role),
    );
    const canHodView = hasHodAccessToRequest(record, request);
    const canViewByHistory = await hasHistoricalApprovalAccess(ctx, args.requestId, email);
    if (
      !canViewAll &&
      !canHodView &&
      !canViewByHistory &&
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

    const normalizedSpecialists = normalizeSpecialists(args.specialists ?? []);
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: args.category,
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
    const nextBase = {
      ...request,
      title: args.title.trim(),
      category: args.category,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      paymentMethod: args.paymentMethod,
      justification: args.justification,
      details: args.details?.trim() || undefined,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
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
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      approvalDeadline: args.approvalDeadline,
      neededBy: args.neededBy,
      paidBy: args.paidBy,
      requiredRoles: args.requiredRoles,
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

    validateRequestPayload(args);

    const identity = await ctx.auth.getUserIdentity();
    const actorName = roleRecord?.fullName ?? identity?.name ?? undefined;
    const creatorRoles = roleRecord?.roles ?? [];
    const normalizedSpecialists = normalizeSpecialists(args.specialists ?? []);
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: args.category,
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
    const contestNeedsHodValidation =
      args.category === "Конкурсное задание" &&
      hasContestDepartments(normalizedSpecialists) &&
      !areContestDepartmentsValidated(normalizedSpecialists);
    const now = Date.now();

    const nextBase = {
      title: args.title.trim(),
      category: args.category,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      paymentMethod: args.paymentMethod,
      justification: args.justification,
      details: args.details?.trim() || undefined,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
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
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      approvalDeadline: args.approvalDeadline,
      neededBy: args.neededBy,
      paidBy: args.paidBy,
      requiredRoles: args.requiredRoles,
    };

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .collect();
    const editImpact = buildEditImpact(request, nextBase, approvals);
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
    const autoApprovedRoles = args.requiredRoles.filter((role) => creatorRoles.includes(role));
    const pendingRoles = args.requiredRoles.filter((role) => !creatorRoles.includes(role));

    if (submitDraft) {
      nextStatus = contestNeedsHodValidation
        ? "hod_pending"
        : pendingRoles.length === 0
          ? "approved"
          : "pending";
      for (const approval of approvals) {
        await ctx.db.delete(approval._id);
      }
      updatedApprovals = [];
      if (!contestNeedsHodValidation) {
        for (const role of args.requiredRoles) {
          const entry = {
            requestId: args.id,
            role,
            status: autoApprovedRoles.includes(role)
              ? ("approved" as const)
              : ("pending" as const),
            decidedAt: autoApprovedRoles.includes(role) ? now : undefined,
            reviewerId: autoApprovedRoles.includes(role) ? userId : undefined,
            reviewerEmail: autoApprovedRoles.includes(role) ? email : undefined,
          };
          const approvalId = await ctx.db.insert("approvals", entry);
          updatedApprovals.push({ _id: approvalId, ...entry });
        }
      }
    } else if (request.status !== "draft") {
      if (contestNeedsHodValidation) {
        for (const approval of approvals) {
          await ctx.db.delete(approval._id);
        }
        updatedApprovals = [];
        nextStatus = "hod_pending";
      } else {
        const existingByRole = new Map(updatedApprovals.map((approval) => [approval.role, approval]));

        for (const role of editImpact.removedRoles) {
          const existing = existingByRole.get(role);
          if (existing) {
            await ctx.db.delete(existing._id);
            updatedApprovals = updatedApprovals.filter((approval) => approval._id !== existing._id);
            existingByRole.delete(role);
          }
        }

        for (const role of editImpact.rolesToReset) {
          if (!args.requiredRoles.includes(role as any)) {
            continue;
          }
          const existing = existingByRole.get(role);
          const nextApprovalPatch = autoApprovedRoles.includes(role as any)
            ? {
                status: "approved" as const,
                comment: undefined,
                decidedAt: now,
                reviewerId: userId,
                reviewerEmail: email,
              }
            : {
                status: "pending" as const,
                comment: undefined,
                decidedAt: undefined,
                reviewerId: undefined,
                reviewerEmail: undefined,
              };
          if (existing) {
            await ctx.db.patch(existing._id, nextApprovalPatch);
            updatedApprovals = updatedApprovals.map((approval) =>
              approval._id === existing._id ? { ...approval, ...nextApprovalPatch } : approval,
            );
          } else {
            const entry = {
              requestId: args.id,
              role: role as any,
              ...nextApprovalPatch,
            };
            const approvalId = await ctx.db.insert("approvals", entry);
            updatedApprovals.push({ _id: approvalId, ...entry });
            existingByRole.set(role, { _id: approvalId, ...entry });
          }
        }

        for (const role of editImpact.addedRoles) {
          if (existingByRole.has(role)) {
            continue;
          }
          const entry = {
            requestId: args.id,
            role: role as any,
            status: autoApprovedRoles.includes(role as any) ? ("approved" as const) : ("pending" as const),
            comment: undefined,
            decidedAt: autoApprovedRoles.includes(role as any) ? now : undefined,
            reviewerId: autoApprovedRoles.includes(role as any) ? userId : undefined,
            reviewerEmail: autoApprovedRoles.includes(role as any) ? email : undefined,
          };
          const approvalId = await ctx.db.insert("approvals", entry);
          updatedApprovals.push({ _id: approvalId, ...entry });
          existingByRole.set(role, { _id: approvalId, ...entry });
        }

        updatedApprovals = updatedApprovals.filter((approval) => args.requiredRoles.includes(approval.role));
        nextStatus = getApprovalStatusFromEntries(updatedApprovals);
        if (nextStatus === "draft") {
          nextStatus = "pending";
        }
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

    if (submitDraft && !contestNeedsHodValidation) {
      await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
        requestId: args.id,
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
      const summaryLines = changes.map(
        (change) => `${change.field}: ${change.fromValue || "—"} → ${change.toValue || "—"}`,
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
    if (contestNeedsHodValidation) {
      await ctx.scheduler.runAfter(0, internal.emails.sendHodValidationRequest, {
        requestId: args.id,
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
    validateRequestPayload(args);
    const now = Date.now();
    const requestCode = await getNextRequestCode(ctx, args.category, args.fundingSource);
    const normalizedSpecialists = normalizeSpecialists(args.specialists ?? []);
    const autoApprovedRoles = args.requiredRoles.filter((role) => creatorRoles.includes(role));
    const contestNeedsHodValidation =
      args.category === "Конкурсное задание" &&
      hasContestDepartments(normalizedSpecialists) &&
      !areContestDepartmentsValidated(normalizedSpecialists);
    const status = !args.submit
      ? "draft"
      : contestNeedsHodValidation
        ? "hod_pending"
        : args.requiredRoles.some((role) => !creatorRoles.includes(role))
          ? "pending"
          : "approved";
    const effectiveAmounts = resolveRequestAmounts(
      {
        category: args.category,
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

    const requestId = await ctx.db.insert("requests", {
      requestCode,
      title: args.title.trim(),
      createdBy: userId,
      createdByEmail: email,
      createdByName: roleRecord?.fullName ?? identity?.name ?? undefined,
      category: args.category,
      amount: effectiveAmounts.amount,
      amountWithVat: effectiveAmounts.amountWithVat,
      vatRate: effectiveAmounts.vatRate,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      paymentMethod: args.paymentMethod,
      cfdTag: undefined,
      justification: args.justification,
      details: args.details?.trim() || undefined,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      attachmentCount: 0,
      lastAttachmentName: undefined,
      financePlanLinks: args.financePlanLinks,
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
      specialists: normalizedSpecialists.length ? normalizedSpecialists : undefined,
      requiredRoles: args.requiredRoles,
      status,
      isCanceled: false,
      approvalDeadline: args.approvalDeadline,
      neededBy: args.neededBy,
      paidBy: args.paidBy,
      submittedAt: args.submit ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await logTimelineEvent(ctx, {
      requestId,
      type: "request_created",
      title: args.submit ? "Заявка создана и отправлена" : "Создан черновик",
      description: `${args.category} · ${args.fundingSource}`,
      actorEmail: email,
      actorName: roleRecord?.fullName ?? identity?.name ?? undefined,
    });

    if (args.submit && args.requiredRoles.length > 0 && !contestNeedsHodValidation) {
      await createApprovalsForRequest(ctx, {
        requestId,
        requiredRoles: args.requiredRoles,
        autoApprovedRoles,
        now,
        userId,
        email,
      });
      await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
        requestId,
      });
      if (args.approvalDeadline) {
        await ctx.scheduler.runAfter(
          Math.max(0, addDays(args.approvalDeadline, 1) - now),
          internal.emails.sendApprovalDeadlineReminder,
          {
            requestId,
            approvalDeadline: args.approvalDeadline,
          },
        );
      }
    }
    if (args.submit && contestNeedsHodValidation) {
      await ctx.scheduler.runAfter(0, internal.emails.sendHodValidationRequest, {
        requestId,
      });
    }

    return requestId;
  },
});

export const updateContestSpecialist = mutation({
  args: {
    requestId: v.id("requests"),
    specialistId: v.string(),
    name: v.string(),
    department: v.optional(v.string()),
    hours: v.optional(v.number()),
    directCost: v.optional(v.number()),
    hodConfirmed: v.optional(v.boolean()),
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
    if (request.category !== "Конкурсное задание") {
      throw new Error("Редактирование специалистов доступно только для конкурсного задания");
    }
    if (!hasHodAccessToRequest(roleRecord, request) && !roleRecord?.roles?.includes("ADMIN")) {
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
      roleRecord?.roles?.includes("ADMIN") ||
      hodDepartments.includes(current.department ?? "") ||
      (current.department === undefined && nextDepartment && hodDepartments.includes(nextDepartment));
    if (!allowedDepartment) {
      throw new Error("Можно редактировать только специалистов своего цеха");
    }
    if (
      nextDepartment &&
      !roleRecord?.roles?.includes("ADMIN") &&
      !hodDepartments.includes(nextDepartment)
    ) {
      throw new Error("Можно выбирать только свои цеха");
    }
    const nextSpecialist = {
      ...current,
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
      hodConfirmed: args.hodConfirmed ?? current.hodConfirmed ?? false,
    };
    specialists[index] = nextSpecialist;
    const nextAmount = calculateContestAmount("Конкурсное задание", specialists, request.amount);
    const nextAmountWithVat = getAmountWithVat(nextAmount, undefined, request.vatRate);
    const shouldReleaseToApprovals =
      request.status === "hod_pending" && areContestDepartmentsValidated(specialists);
    let nextStatus = request.status;
    if (shouldReleaseToApprovals) {
      const creatorRoles = (
        await getRoleRecord(ctx, request.createdByEmail)
      )?.roles ?? [];
      const autoApprovedRoles = request.requiredRoles.filter((role: string) =>
        creatorRoles.includes(role),
      );
      for (const approval of await ctx.db
        .query("approvals")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect()) {
        await ctx.db.delete(approval._id);
      }
      nextStatus = await createApprovalsForRequest(ctx, {
        requestId: request._id,
        requiredRoles: request.requiredRoles,
        autoApprovedRoles,
        now: Date.now(),
        userId: request.createdBy,
        email: request.createdByEmail,
      });
    }
    await ctx.db.patch(request._id, {
      specialists,
      amount: nextAmount,
      amountWithVat: nextAmountWithVat,
      status: nextStatus,
      submittedAt: shouldReleaseToApprovals ? Date.now() : request.submittedAt,
      updatedAt: Date.now(),
    });
    const specialistChanges = diffRequestFields(
      { specialists: request.specialists ?? [] },
      { specialists },
    );
    if (specialistChanges.length) {
      await recordRequestChanges(
        ctx,
        request._id,
        email,
        roleRecord?.fullName ?? undefined,
        specialistChanges,
      );
    }
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "specialists_updated",
      title: "Обновлены специалисты",
      actorEmail: email,
      actorName: roleRecord?.fullName ?? undefined,
      description: shouldReleaseToApprovals
        ? "Все нужные цеха провалидировали прямые затраты. Заявка отправлена на согласование."
        : undefined,
    });
    if (shouldReleaseToApprovals) {
      await ctx.scheduler.runAfter(0, internal.emails.sendRequestSubmitted, {
        requestId: request._id,
      });
      if (request.approvalDeadline) {
        await ctx.scheduler.runAfter(
          Math.max(0, addDays(request.approvalDeadline, 1) - Date.now()),
          internal.emails.sendApprovalDeadlineReminder,
          {
            requestId: request._id,
            approvalDeadline: request.approvalDeadline,
          },
        );
      }
    }
    return { updated: true };
  },
});

export const cancelRequest = mutation({
  args: {
    id: v.id("requests"),
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
    if (request.createdBy !== userId && request.createdByEmail !== email) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(request._id, {
      isCanceled: true,
      canceledAt: Date.now(),
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "request_canceled",
      title: "Заявка отменена",
      actorEmail: email,
    });
    return { canceled: true };
  },
});

export const resumeRequest = mutation({
  args: {
    id: v.id("requests"),
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
    if (request.createdBy !== userId && request.createdByEmail !== email) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(request._id, {
      isCanceled: false,
      canceledAt: undefined,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "request_resumed",
      title: "Заявка возобновлена",
      actorEmail: email,
    });
    return { resumed: true };
  },
});

export const assignCfdTag = mutation({
  args: {
    id: v.id("requests"),
    tag: v.optional(v.string()),
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
    if (
      !record?.roles?.includes("CFD") &&
      !record?.roles?.includes("ADMIN") &&
      !record?.roles?.includes("BUH") &&
      !record?.roles?.includes("NBD")
    ) {
      throw new Error("Not authorized");
    }
    const request = await ctx.db.get(args.id);
    if (!request) {
      throw new Error("Request not found");
    }
    if (
      record?.roles?.includes("NBD") &&
      !["approved", "awaiting_payment", "payment_planned", "partially_paid", "paid", "closed"].includes(
        request.status,
      )
    ) {
      throw new Error("NBD может назначать тег только после согласования");
    }
    if (args.tag?.trim()) {
      const existingTag = await ctx.db
        .query("cfdTags")
        .withIndex("by_name", (q: any) => q.eq("name", args.tag!.trim()))
        .first();
      if (!existingTag || !existingTag.active) {
        throw new Error("Тег не найден");
      }
    }
    await ctx.db.patch(request._id, {
      cfdTag: args.tag?.trim() || undefined,
      updatedAt: Date.now(),
    });
    await logTimelineEvent(ctx, {
      requestId: request._id,
      type: "cfd_tag_updated",
      title: "Изменен тег заявки",
      description: args.tag?.trim() || "Тег снят",
      actorEmail: email,
      actorName: record.fullName ?? undefined,
    });
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

    const actorName = record.fullName?.trim() || undefined;
    const now = Date.now();
    const isCreator = request.createdBy === userId || request.createdByEmail === email;

    const canBuhReturnPaid =
      args.status === "awaiting_payment" &&
      request.status === "paid" &&
      record.roles.includes("BUH");

    if (
      args.status === "awaiting_payment" &&
      !isCreator &&
      !record.roles.includes("ADMIN") &&
      !canBuhReturnPaid
    ) {
      throw new Error("Передать в оплату может только автор заявки");
    }
    if (args.status === "payment_planned" && !record.roles.includes("BUH")) {
      throw new Error("Только BUH может запланировать оплату");
    }
    if (args.status === "partially_paid" && !record.roles.includes("BUH")) {
      throw new Error("Только BUH может отметить частичную оплату");
    }
    if (args.status === "paid" && !record.roles.includes("BUH")) {
      throw new Error("Только BUH может перевести в статус Оплачено");
    }
    if ((args.status === "closed" || args.status === "reopen") && !isCreator && !record.roles.includes("ADMIN")) {
      throw new Error("Изменить статус закрытой заявки может только автор");
    }

    if (args.status === "awaiting_payment" && !["approved", "paid"].includes(request.status)) {
      throw new Error("Передать в оплату можно только согласованную заявку");
    }
    if (
      args.status === "payment_planned" &&
      !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
    ) {
      throw new Error("Планировать оплату можно только после передачи в оплату");
    }
    if (
      args.status === "partially_paid" &&
      !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
    ) {
      throw new Error("Частичную оплату можно отметить только после передачи в оплату");
    }
    if (
      args.status === "paid" &&
      !["awaiting_payment", "payment_planned", "partially_paid", "paid"].includes(request.status)
    ) {
      throw new Error("Статус Оплачено доступен только после передачи в оплату");
    }
    if (args.status === "closed" && !["approved", "paid"].includes(request.status)) {
      throw new Error("Закрыть можно только согласованную или оплаченную заявку");
    }
    if (args.status === "reopen" && request.status !== "closed") {
      throw new Error("Открыть заново можно только закрытую заявку");
    }

    const finplanCostIds = args.finplanCostIdsRaw
      ? parseFinplanCostIds(args.finplanCostIdsRaw)
      : request.finplanCostIds ?? [];

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
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        paymentSplits: undefined,
        plannedPaymentSplits: undefined,
        actualPaidAmount: undefined,
        actualPaidAmountWithVat: undefined,
        paymentReminderSentAt: undefined,
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
        await ctx.scheduler.runAfter(0, internal.emails.sendPaymentRequested, {
          requestId: request._id,
        });
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
      if (request.neededBy && args.paymentPlannedAt > request.neededBy && !args.allowLatePaymentPlan) {
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
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        plannedPaymentSplits: nextPlannedPaymentSplits.length ? nextPlannedPaymentSplits : undefined,
        paymentReminderSentAt: undefined,
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
      const delay = Math.max(0, args.paymentPlannedAt - now);
      await ctx.scheduler.runAfter(0, internal.emails.sendPaymentPlanned, {
        requestId: request._id,
      });
      await ctx.scheduler.runAfter(delay + 24 * 60 * 60 * 1000, internal.emails.sendPaymentDeadlineReminder, {
        requestId: request._id,
        plannedAt: args.paymentPlannedAt,
      });
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
        if (request.neededBy && args.paymentPlannedAt > request.neededBy && !args.allowLatePaymentPlan) {
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
        finplanCostIds: finplanCostIds.length
          ? Array.from(new Set([...(request.finplanCostIds ?? []), ...finplanCostIds]))
          : request.finplanCostIds,
        actualPaidAmount: cumulativePaid,
        actualPaidAmountWithVat: cumulativePaidWithVat > 0 ? cumulativePaidWithVat : undefined,
        paymentReminderSentAt: undefined,
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
        const delay = Math.max(0, args.paymentPlannedAt - now);
        await ctx.scheduler.runAfter(delay + 24 * 60 * 60 * 1000, internal.emails.sendPaymentDeadlineReminder, {
          requestId: request._id,
          plannedAt: args.paymentPlannedAt,
        });
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
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
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

export const markReminderSent = internalMutation({
  args: {
    requestId: v.id("requests"),
    kind: v.union(v.literal("approval"), v.literal("payment"), v.literal("close")),
    expectedAt: v.number(),
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
    if (args.kind === "close" && request.paidAt === args.expectedAt) {
      await ctx.db.patch(args.requestId, { closeReminderSentAt: Date.now() });
    }
  },
});
