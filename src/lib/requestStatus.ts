import { resolveVatAmounts } from "./vat";

type RequestLike = {
  status:
    | "draft"
    | "hod_pending"
    | "pending"
    | "approved"
    | "rejected"
    | "awaiting_payment"
    | "payment_planned"
    | "partially_paid"
    | "paid"
    | "closed";
  isCanceled?: boolean;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  plannedPaymentSplits?: Array<{
    amountWithoutVat?: number;
    amountWithVat?: number;
    vatRate?: number;
    plannedAt?: number;
  }>;
  paymentSplits?: Array<{
    nextPaymentAt?: number;
  }>;
  paymentDeadline?: number;
  neededBy?: number;
  paymentPlannedAt?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  vatRate?: number;
  category?: string;
  specialists?: Array<{
    sourceType?: string;
    fotRecorded?: boolean;
  }>;
};

type ApprovalLike = {
  status: "pending" | "approved" | "rejected";
};

export const OPEN_PAYMENT_TASK_STATUSES = [
  "approved",
  "awaiting_payment",
  "payment_planned",
  "partially_paid",
] as const;

function isWelcomeBonusRequest(request: Pick<RequestLike, "category">) {
  return request.category === "Welcome-бонус";
}

export function hasPendingFotTask(
  request: Pick<RequestLike, "status" | "isCanceled" | "category" | "specialists">,
) {
  if (
    request.isCanceled ||
    isWelcomeBonusRequest(request) ||
    ["draft", "hod_pending", "pending", "rejected"].includes(request.status)
  ) {
    return false;
  }
  return (request.specialists ?? []).some(
    (item) => item.sourceType === "internal" && !item.fotRecorded,
  );
}

export function getPaymentDeadlineTimestamp(request: Pick<RequestLike, "paymentDeadline" | "neededBy">) {
  return request.paymentDeadline ?? request.neededBy;
}

function isUsableTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getPaymentTaskTimestamp(
  request: Pick<
    RequestLike,
    "status" | "paymentDeadline" | "neededBy" | "paymentPlannedAt" | "plannedPaymentSplits" | "paymentSplits"
  >,
) {
  if (["payment_planned", "partially_paid"].includes(request.status)) {
    const plannedDates = [
      request.paymentPlannedAt,
      ...(request.plannedPaymentSplits ?? []).map((split) => split.plannedAt),
      ...(request.paymentSplits ?? []).map((split) => split.nextPaymentAt),
    ].filter(isUsableTimestamp);
    if (plannedDates.length > 0) {
      return Math.min(...plannedDates);
    }
  }
  return getPaymentDeadlineTimestamp(request);
}

export function isOpenPaymentTask(
  request: Pick<
    RequestLike,
    | "status"
    | "isCanceled"
    | "paymentDeadline"
    | "neededBy"
    | "paymentPlannedAt"
    | "plannedPaymentSplits"
    | "paymentSplits"
    | "category"
    | "specialists"
  >,
) {
  return (
    !request.isCanceled &&
    !isWelcomeBonusRequest(request) &&
    (!(request.specialists?.length) ||
      request.specialists.some((item) => item.sourceType === "contractor")) &&
    OPEN_PAYMENT_TASK_STATUSES.includes(request.status as (typeof OPEN_PAYMENT_TASK_STATUSES)[number]) &&
    getPaymentTaskTimestamp(request) !== undefined
  );
}

function resolvePaymentAmountPair(params: {
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

function sumPlannedPaymentAmounts(
  plannedPaymentSplits: RequestLike["plannedPaymentSplits"] = [],
  vatRate?: number,
) {
  return plannedPaymentSplits.reduce(
    (sum, split) => {
      const resolved = resolvePaymentAmountPair({
        amountWithoutVat: split.amountWithoutVat,
        amountWithVat: split.amountWithVat,
        vatRate: split.vatRate ?? vatRate,
      });
      return {
        amountWithoutVat: (sum.amountWithoutVat ?? 0) + (resolved.amountWithoutVat ?? 0),
        amountWithVat: (sum.amountWithVat ?? 0) + (resolved.amountWithVat ?? 0),
      };
    },
    { amountWithoutVat: 0, amountWithVat: 0 },
  );
}

export function getUnallocatedPaymentAmounts(request: RequestLike) {
  if (!["payment_planned", "partially_paid"].includes(request.status)) {
    return {
      amountWithoutVat: 0,
      amountWithVat: 0,
    };
  }
  const residual = resolvePaymentAmountPair({
    amountWithoutVat: request.paymentResidualAmount,
    amountWithVat: request.paymentResidualAmountWithVat,
    vatRate: request.vatRate,
  });
  if (residual.amountWithoutVat === undefined && residual.amountWithVat === undefined) {
    return {
      amountWithoutVat: 0,
      amountWithVat: 0,
    };
  }
  const planned = resolvePaymentAmountPair({
    amountWithoutVat: request.plannedPaymentAmount,
    amountWithVat: request.plannedPaymentAmountWithVat,
    vatRate: request.vatRate,
  });
  const archivedPlanned = sumPlannedPaymentAmounts(request.plannedPaymentSplits, request.vatRate);
  return {
    amountWithoutVat: Math.max(
        (residual.amountWithoutVat ?? 0) -
        (planned.amountWithoutVat ?? 0) -
        (archivedPlanned.amountWithoutVat ?? 0),
      0,
    ),
    amountWithVat: Math.max(
      (residual.amountWithVat ?? 0) -
        (planned.amountWithVat ?? 0) -
        (archivedPlanned.amountWithVat ?? 0),
      0,
    ),
  };
}

export function hasUnallocatedPayment(request: RequestLike) {
  if (!["payment_planned", "partially_paid"].includes(request.status)) {
    return false;
  }
  return getUnallocatedPaymentAmounts(request).amountWithoutVat > 0;
}

export type PaymentTaskFilter =
  | "open"
  | "needs_action"
  | "payment_planned"
  | "partially_paid"
  | "unallocated"
  | "fot"
  | "today"
  | "overdue";

export function matchesPaymentTaskFilter(
  request: RequestLike,
  filter: PaymentTaskFilter,
  todayStart: number,
  todayEnd: number,
) {
  if (filter === "fot") {
    return hasPendingFotTask(request);
  }
  if (filter === "open") {
    return isOpenPaymentTask(request) || hasPendingFotTask(request);
  }
  if (!isOpenPaymentTask(request)) {
    return false;
  }
  const paymentTaskAt = getPaymentTaskTimestamp(request);

  if (filter === "needs_action") {
    return request.status === "approved" || request.status === "awaiting_payment";
  }
  if (filter === "payment_planned") {
    return request.status === "payment_planned";
  }
  if (filter === "partially_paid") {
    return request.status === "partially_paid";
  }
  if (filter === "unallocated") {
    return hasUnallocatedPayment(request);
  }
  if (filter === "today") {
    return paymentTaskAt !== undefined && paymentTaskAt >= todayStart && paymentTaskAt <= todayEnd;
  }
  return paymentTaskAt !== undefined && paymentTaskAt < todayStart;
}

export function getPaymentActionHint(request: RequestLike) {
  if (!isOpenPaymentTask(request)) {
    return null;
  }

  if (hasUnallocatedPayment(request)) {
    return {
      label: "Есть нераспределенный платеж",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (request.status === "approved" || request.status === "awaiting_payment") {
    return {
      label: "Нужно запланировать или оплатить",
      className: "border-indigo-200 bg-indigo-50 text-indigo-700",
    };
  }

  return null;
}

export function getFotActionHint(request: RequestLike) {
  if (!hasPendingFotTask(request)) {
    return null;
  }
  return {
    label: "Нужно вынести ФОТ",
    className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  };
}

export function getBuhPaymentStatusSummary(request: RequestLike) {
  if (hasUnallocatedPayment(request)) {
    return {
      label: "Есть нераспределенный платеж",
      className: "border-amber-200 bg-amber-100 text-amber-800",
    };
  }

  if (request.status === "partially_paid") {
    return {
      label: "Есть остаток к оплате",
      className: "border-cyan-200 bg-cyan-50 text-cyan-700",
    };
  }

  if (request.status === "payment_planned") {
    return {
      label: "Оплата запланирована",
      className: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }

  return {
    label: "Нужно запланировать или оплатить",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  };
}

export function getRequestStatusSummary(
  request: RequestLike,
  approvals: ApprovalLike[] = [],
) {
  if (request.isCanceled) {
    return {
      label: "Отменена",
      className: "border-rose-100 bg-rose-50/70 text-rose-600",
    };
  }

  if (request.status === "draft") {
    return {
      label: "Черновик",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    };
  }

  if (request.status === "hod_pending") {
    return {
      label: "Ждет валидации цеха",
      className: "border-violet-200 bg-violet-50 text-violet-700",
    };
  }

  if (request.status === "approved") {
    return {
      label: "Согласовано",
      className: "border-emerald-200 bg-emerald-600 text-white",
    };
  }

  if (request.status === "awaiting_payment") {
    return {
      label: "Согласовано",
      className: "border-emerald-200 bg-emerald-600 text-white",
    };
  }

  if (request.status === "payment_planned") {
    return {
      label: "Запланирована оплата",
      className: "border-blue-200 bg-blue-50 text-blue-700",
    };
  }

  if (request.status === "partially_paid") {
    return {
      label: "Частично оплачено",
      className: "border-cyan-200 bg-cyan-50 text-cyan-700",
    };
  }

  if (request.status === "paid") {
    return {
      label: "Оплачено",
      className: "border-teal-200 bg-teal-50 text-teal-700",
    };
  }

  if (request.status === "closed") {
    return {
      label: "Заявка закрыта",
      className: "border-zinc-300 bg-zinc-100 text-zinc-700",
    };
  }

  if (request.status === "rejected") {
    return {
      label: "Не согласовано",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  const rejected = approvals.some((item) => item.status === "rejected");
  if (rejected) {
    return {
      label: "Не согласовано",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  const approvedCount = approvals.filter((item) => item.status === "approved").length;
  if (approvedCount > 0) {
    const total = approvals.length;
    if (total > 0 && approvedCount < total) {
      return {
        label: `Частично согласовано: ${approvedCount}/${total}`,
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }
    return {
      label: "Частично согласовано",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "Ожидает согласования",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  };
}

export function getApprovalStatusClass(status: "pending" | "approved" | "rejected") {
  if (status === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}
