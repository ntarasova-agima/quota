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
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  vatRate?: number;
};

type ApprovalLike = {
  status: "pending" | "approved" | "rejected";
};

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
  if (planned.amountWithoutVat === undefined && planned.amountWithVat === undefined) {
    return {
      amountWithoutVat: residual.amountWithoutVat ?? 0,
      amountWithVat: residual.amountWithVat ?? 0,
    };
  }
  return {
    amountWithoutVat: Math.max((residual.amountWithoutVat ?? 0) - (planned.amountWithoutVat ?? 0), 0),
    amountWithVat: Math.max((residual.amountWithVat ?? 0) - (planned.amountWithVat ?? 0), 0),
  };
}

export function hasUnallocatedPayment(request: RequestLike) {
  if (!["payment_planned", "partially_paid"].includes(request.status)) {
    return false;
  }
  return getUnallocatedPaymentAmounts(request).amountWithoutVat > 0;
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
      label: "Новая заявка",
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
      label: "Требуется оплата",
      className: "border-indigo-200 bg-indigo-50 text-indigo-700",
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
