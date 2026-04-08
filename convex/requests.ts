import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentEmail } from "./authHelpers";
import { logTimelineEvent } from "./timelineHelpers";

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
  "Закупка сервисов": "SV",
  "Неформальное мероприятие": "EV",
  "Совместный мерч": "MR",
};

const fundingSourceCodes: Record<string, string> = {
  "Отгрузки проекта": "RP",
  "Прибыль компании": "PC",
  "Квота на пресейлы": "QS",
  "Квота на AI-подписки": "QA",
  "Квоты на AI-инструменты": "QT",
  "Квота на внутренние затраты": "QI",
  "Я не знаю": "UN",
};

function getFundingOwnerRoles(fundingSource: string) {
  if (fundingSource === "Квота на пресейлы" || fundingSource === "Квота на AI-подписки") {
    return ["NBD"] as const;
  }
  if (fundingSource === "Квоты на AI-инструменты") {
    return ["AI-BOSS"] as const;
  }
  if (fundingSource === "Квота на внутренние затраты") {
    return ["COO"] as const;
  }
  if (fundingSource === "Прибыль компании") {
    return ["COO", "CFD"] as const;
  }
  return [] as const;
}

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
    department?: string;
    hours?: number;
    directCost?: number;
    hodConfirmed?: boolean;
  }>,
) {
  return specialists
    .map((item) => ({
      id: item.id,
      name: item.name?.trim() ?? "",
      department: item.department?.trim() || undefined,
      hours:
        typeof item.hours === "number" && Number.isFinite(item.hours)
          ? item.hours
          : undefined,
      directCost:
        typeof item.directCost === "number" && Number.isFinite(item.directCost)
          ? item.directCost
          : undefined,
      hodConfirmed: item.hodConfirmed ?? false,
    }))
    .filter(
      (item) =>
        item.name ||
        item.department ||
        item.hours !== undefined ||
        item.directCost !== undefined,
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
  specialists: Array<{ department?: string }>,
) {
  return specialists.some((item) => Boolean(item.department));
}

function isDepartmentSpecialistReady(
  specialist: { department?: string; directCost?: number; hodConfirmed?: boolean },
) {
  return Boolean(
    specialist.department &&
      specialist.hodConfirmed &&
      typeof specialist.directCost === "number" &&
      Number.isFinite(specialist.directCost),
  );
}

function areContestDepartmentsValidated(
  specialists: Array<{ department?: string; directCost?: number; hodConfirmed?: boolean }>,
) {
  const departmentalSpecialists = specialists.filter((item) => item.department);
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
  return specialists.some((item: any) => item.department && departments.includes(item.department));
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

async function getRoleNotificationRecipients(
  ctx: { db: any },
  approvals: any[],
  roles: string[],
  mode: "approved" | "decided",
) {
  const recipients = new Set<string>();
  for (const role of roles) {
    const emails =
      mode === "approved"
        ? getApprovedReviewerEmailsByRoles(approvals, [role])
        : getDecidedReviewerEmailsByRoles(approvals, [role]);
    if (emails.length > 0) {
      emails.forEach((email: string) => recipients.add(email));
      continue;
    }
    const fallback = await getActiveRoleEmails(ctx, [role]);
    fallback.forEach((email: string) => recipients.add(email));
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

function sumPaymentSplitAmounts(paymentSplits: Array<{ amountWithoutVat?: number }>) {
  return paymentSplits.reduce((sum, split) => sum + (split.amountWithoutVat ?? 0), 0);
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
  department: v.optional(v.string()),
  hours: v.optional(v.number()),
  directCost: v.optional(v.number()),
  hodConfirmed: v.optional(v.boolean()),
});

const requestPayloadValidator = {
  title: v.string(),
  category: v.string(),
  amount: v.number(),
  currency: v.string(),
  fundingSource: v.string(),
  counterparty: v.string(),
  justification: v.string(),
  investmentReturn: v.optional(v.string()),
  clientName: v.string(),
  contacts: v.array(v.string()),
  relatedRequests: v.optional(v.array(v.string())),
  links: v.array(v.string()),
  financePlanLinks: v.optional(v.array(v.string())),
  specialists: v.optional(v.array(specialistValidator)),
  approvalDeadline: v.optional(v.number()),
  neededBy: v.optional(v.number()),
  paidBy: v.optional(v.number()),
  requiredRoles: v.array(roleEnum),
  submit: v.boolean(),
};

const requestFieldLabels: Record<string, string> = {
  title: "Название заявки",
  category: "Категория",
  amount: "Сумма",
  currency: "Валюта",
  fundingSource: "Источник финансирования",
  counterparty: "Контрагент",
  justification: "Обоснование",
  investmentReturn: "Как будем возвращать инвестиции",
  clientName: "Клиент / получатель сервиса",
  contacts: "Контакты клиента",
  relatedRequests: "Связана с заявками",
  links: "Ссылки на материалы",
  financePlanLinks: "Ссылки на финплан",
  specialists: "Специалисты",
  approvalDeadline: "Дедлайн согласования",
  neededBy: "Нужны деньги к",
  paidBy: "Когда заплатят нам",
  requiredRoles: "Обязательные согласующие",
  status: "Статус заявки",
};

function formatValueForHistory(field: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    if (field === "approvalDeadline" || field === "neededBy" || field === "paidBy") {
      return new Date(value).toLocaleDateString("ru-RU");
    }
    return String(value);
  }
  if (typeof value === "string") {
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
            specialist.name,
            specialist.department,
            specialist.hours !== undefined ? `${specialist.hours} ч` : undefined,
            specialist.directCost !== undefined ? `${specialist.directCost}` : undefined,
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
    "currency",
    "fundingSource",
    "counterparty",
    "justification",
    "investmentReturn",
    "clientName",
    "contacts",
    "relatedRequests",
    "links",
    "financePlanLinks",
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
  const amountChanged = previous.amount !== next.amount;
  const fundingChanged = previous.fundingSource !== next.fundingSource;
  const categoryChanged = previous.category !== next.category;
  const counterpartyChanged = (previous.counterparty ?? "") !== (next.counterparty ?? "");
  const neededByChanged = previous.neededBy !== next.neededBy;
  const paidByChanged = previous.paidBy !== next.paidBy;
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
    infoLines.push("Более ранняя дата получения денег уведомит уже согласовавших.");
  }

  if (paidByChanged && previous.paidBy && next.paidBy && next.paidBy > previous.paidBy) {
    approvedReviewerEmails.forEach((email) => notifyApprovedEmails.add(email));
    infoLines.push("Более поздняя дата оплаты от клиента уведомит уже согласовавших.");
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
  const effectiveAmount = calculateContestAmount(
    args.category,
    normalizedSpecialists,
    args.amount,
  );
  if (
    (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) &&
    !(contestWithSpecialists && effectiveAmount === 0)
  ) {
    throw new Error("Amount must be greater than 0");
  }
  if (!args.title.trim()) {
    throw new Error("Название заявки обязательно");
  }
  if (!args.justification || !args.justification.trim()) {
    throw new Error("Обоснование обязательно");
  }
  if (!args.approvalDeadline) {
    throw new Error("Укажите дедлайн согласования");
  }
  if (!args.neededBy) {
    throw new Error("Укажите дату, когда нужны деньги");
  }
  if (
    args.fundingSource === "Отгрузки проекта" &&
    ["Welcome-бонус", "Конкурсное задание"].includes(args.category)
  ) {
    throw new Error("Так не бывает");
  }
  if (
    args.category === "Закупка сервисов" &&
    !["Квота на внутренние затраты", "Квота на AI-подписки", "Квоты на AI-инструменты"].includes(args.fundingSource)
  ) {
    throw new Error(
      "Для закупки сервисов доступны только источники Квота на внутренние затраты, Квота на AI-подписки и Квоты на AI-инструменты",
    );
  }
  if (
    args.approvalDeadline !== undefined &&
    args.neededBy !== undefined &&
    args.approvalDeadline > args.neededBy
  ) {
    throw new Error("Дедлайн согласования должен быть не позже даты, когда нужны деньги");
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
      throw new Error("Дата получения денег должна быть не раньше завтрашнего дня");
    }
  }
  if (
    args.category !== "Конкурсное задание" &&
    args.category !== "Welcome-бонус" &&
    args.fundingSource === "Отгрузки проекта" &&
    (!args.financePlanLinks || args.financePlanLinks.length === 0)
  ) {
    throw new Error("Финплан обязателен для отгрузок проекта");
  }
  if (args.fundingSource === "Отгрузки проекта" && !args.paidBy) {
    throw new Error("Укажите дату, когда заплатят нам");
  }
  if (
    ["Квота на пресейлы", "Квота на AI-подписки"].includes(args.fundingSource) &&
    !args.requiredRoles.includes("NBD")
  ) {
    throw new Error("Для квот NBD обязателен NBD");
  }
  if (
    args.fundingSource === "Квоты на AI-инструменты" &&
    !args.requiredRoles.includes("AI-BOSS")
  ) {
    throw new Error("Для квот на AI-инструменты обязателен AI-BOSS");
  }
  if (
    args.fundingSource === "Квота на внутренние затраты" &&
    !args.requiredRoles.includes("COO")
  ) {
    throw new Error("Для квоты на внутренние затраты обязателен COO");
  }
  if (
    args.fundingSource === "Прибыль компании" &&
    (!args.requiredRoles.includes("COO") || !args.requiredRoles.includes("CFD"))
  ) {
    throw new Error("Для прибыли компании обязательны COO и CFD");
  }
  if (args.category === "Welcome-бонус" && (!args.investmentReturn || !args.investmentReturn.trim())) {
    throw new Error("Укажите, как будем возвращать инвестиции");
  }
  if (args.category === "Закупка сервисов" && (!args.clientName || !args.clientName.trim())) {
    throw new Error("Укажите получателя сервиса");
  }
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
      if (args.category && request.category !== args.category) {
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
    const filtered = requests.filter((req) => {
      if (args.createdByEmail && req.createdByEmail !== args.createdByEmail) {
        return false;
      }
      if (args.category && req.category !== args.category) {
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
    const effectiveAmount = calculateContestAmount(
      args.category,
      normalizedSpecialists,
      args.amount,
    );
    const nextBase = {
      ...request,
      title: args.title.trim(),
      category: args.category,
      amount: effectiveAmount,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      justification: args.justification,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
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
    const effectiveAmount = calculateContestAmount(
      args.category,
      normalizedSpecialists,
      args.amount,
    );
    const contestNeedsHodValidation =
      args.category === "Конкурсное задание" &&
      hasContestDepartments(normalizedSpecialists) &&
      !areContestDepartmentsValidated(normalizedSpecialists);
    const now = Date.now();

    const nextBase = {
      title: args.title.trim(),
      category: args.category,
      amount: effectiveAmount,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      justification: args.justification,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      financePlanLinks: args.financePlanLinks,
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
      );
      const buhEmails = editImpact.counterpartyChanged
        ? await getActiveRoleEmails(ctx, ["BUH"])
        : [];
      const repeatApprovalRoleEmails = Array.from(
        new Set([
          ...getDecidedReviewerEmailsByRoles(approvals, editImpact.rolesToReset),
          ...(await getActiveRoleEmails(ctx, editImpact.addedRoles)),
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
    const effectiveAmount = calculateContestAmount(
      args.category,
      normalizedSpecialists,
      args.amount,
    );

    const requestId = await ctx.db.insert("requests", {
      requestCode,
      title: args.title.trim(),
      createdBy: userId,
      createdByEmail: email,
      createdByName: roleRecord?.fullName ?? identity?.name ?? undefined,
      category: args.category,
      amount: effectiveAmount,
      currency: args.currency,
      fundingSource: args.fundingSource,
      counterparty: args.counterparty,
      cfdTag: undefined,
      justification: args.justification,
      investmentReturn: args.investmentReturn?.trim() || undefined,
      clientName: args.clientName,
      contacts: args.contacts,
      relatedRequests: args.relatedRequests,
      links: args.links,
      attachmentCount: 0,
      lastAttachmentName: undefined,
      financePlanLinks: args.financePlanLinks,
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
    validateOptionalMoney(args.paymentResidualAmount, "Остаток к оплате");
    validateOptionalRate(args.paymentCurrencyRate);

    const effectiveCurrencyRate = args.paymentCurrencyRate ?? request.paymentCurrencyRate;
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
        plannedPaymentAmount: undefined,
        plannedPaymentAmountWithVat: undefined,
        paymentCurrencyRate: undefined,
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        paymentSplits: undefined,
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
        throw new Error("Дата оплаты позже даты, когда нужны деньги");
      }
      const nextStatus = (request.paymentSplits?.length ?? 0) > 0 ? "partially_paid" : "payment_planned";
      const plannedAmount =
        args.actualPaidAmount !== undefined
          ? args.actualPaidAmount
          : request.paymentResidualAmount ?? request.plannedPaymentAmount ?? request.amount;
      await ctx.db.patch(request._id, {
        status: nextStatus,
        paymentPlannedAt: args.paymentPlannedAt,
        paymentPlannedByEmail: email,
        paymentPlannedByName: actorName,
        plannedPaymentAmount: plannedAmount,
        plannedPaymentAmountWithVat:
          args.actualPaidAmountWithVat !== undefined
            ? args.actualPaidAmountWithVat
            : request.plannedPaymentAmountWithVat,
        paymentCurrencyRate: effectiveCurrencyRate,
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
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
      return { status: nextStatus };
    }

    if (args.status === "partially_paid") {
      if (!isPositiveFinite(args.actualPaidAmount)) {
        throw new Error("Укажите сумму текущего платежа");
      }
      if (!isPositiveFinite(args.paymentResidualAmount)) {
        throw new Error("Укажите остаток к оплате");
      }
      if (!args.paymentPlannedAt) {
        throw new Error("Укажите дату следующей оплаты");
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (args.paymentPlannedAt < today.getTime()) {
        throw new Error("Дата оплаты не может быть раньше сегодняшнего дня");
      }
      if (request.neededBy && args.paymentPlannedAt > request.neededBy && !args.allowLatePaymentPlan) {
        throw new Error("Дата оплаты позже даты, когда нужны деньги");
      }
      const existingSplits = request.paymentSplits ?? [];
      if (existingSplits.length >= 5) {
        throw new Error("Можно указать не более 5 траншей");
      }
      const nextSplit = {
        splitNumber: existingSplits.length + 1,
        amountWithoutVat: args.actualPaidAmount!,
        amountWithVat: args.actualPaidAmountWithVat,
        currencyRate: effectiveCurrencyRate,
        paidAt: now,
        nextPaymentAt: args.paymentPlannedAt,
        remainingAmountWithoutVat: args.paymentResidualAmount,
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        actorEmail: email,
        actorName,
        createdAt: now,
      };
      const updatedSplits = [...existingSplits, nextSplit];
      const cumulativePaid = sumPaymentSplitAmounts(updatedSplits);
      const cumulativePaidWithVat = updatedSplits.reduce(
        (sum, split) => sum + (split.amountWithVat ?? 0),
        0,
      );
      await ctx.db.patch(request._id, {
        status: "partially_paid",
        paymentSplits: updatedSplits,
        paymentPlannedAt: args.paymentPlannedAt,
        paymentPlannedByEmail: email,
        paymentPlannedByName: actorName,
        paymentResidualAmount: args.paymentResidualAmount,
        plannedPaymentAmount: args.paymentResidualAmount,
        plannedPaymentAmountWithVat: undefined,
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
        description: `${args.actualPaidAmount} ${request.currency} без НДС, остаток ${args.paymentResidualAmount} ${request.currency}`,
        actorEmail: email,
        actorName,
      });
      const delay = Math.max(0, args.paymentPlannedAt - now);
      await ctx.scheduler.runAfter(delay + 24 * 60 * 60 * 1000, internal.emails.sendPaymentDeadlineReminder, {
        requestId: request._id,
        plannedAt: args.paymentPlannedAt,
      });
      return { status: "partially_paid" };
    }

    if (args.status === "paid") {
      const existingSplits = request.paymentSplits ?? [];
      const splitTotal = sumPaymentSplitAmounts(existingSplits);
      const finalPaidAmount =
        args.actualPaidAmount !== undefined
          ? existingSplits.length > 0
            ? splitTotal + args.actualPaidAmount
            : args.actualPaidAmount
          : request.paymentResidualAmount !== undefined
            ? splitTotal + request.paymentResidualAmount
            : request.plannedPaymentAmount ?? request.actualPaidAmount ?? request.amount;
      const finalPaidAmountWithVat =
        args.actualPaidAmountWithVat !== undefined
          ? existingSplits.reduce((sum, split) => sum + (split.amountWithVat ?? 0), 0) +
            args.actualPaidAmountWithVat
          : request.actualPaidAmountWithVat;
      await ctx.db.patch(request._id, {
        status: args.status,
        paidAt: now,
        paidByEmail: email,
        paidByName: actorName,
        finplanCostIds: finplanCostIds.length ? finplanCostIds : undefined,
        actualPaidAmount: finalPaidAmount,
        actualPaidAmountWithVat: finalPaidAmountWithVat,
        paymentResidualAmount: undefined,
        plannedPaymentAmount: finalPaidAmount,
        plannedPaymentAmountWithVat: finalPaidAmountWithVat,
        paymentCurrencyRate: effectiveCurrencyRate,
        closeReminderSentAt: undefined,
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
      await ctx.scheduler.runAfter(
        Math.max(0, addBusinessDays(now, 2) - now),
        internal.emails.sendCloseDeadlineReminder,
        {
          requestId: request._id,
          paidAt: now,
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
