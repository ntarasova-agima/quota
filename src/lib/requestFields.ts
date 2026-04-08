import { AI_TOOLS_REQUEST_CATEGORY } from "./requestRules";

export const AGIMA_START_YEAR = 2006;

export const PAYMENT_METHOD_OPTIONS = ["Безналичные", "Наличные", "Карта"] as const;
export type PaymentMethodOption = (typeof PAYMENT_METHOD_OPTIONS)[number];

export const CONTEST_SPECIALIST_SOURCES = ["internal", "contractor"] as const;
export type ContestSpecialistSource = (typeof CONTEST_SPECIALIST_SOURCES)[number];

export const CONTEST_SPECIALIST_SOURCE_LABELS: Record<ContestSpecialistSource, string> = {
  internal: "Внутренние специалисты",
  contractor: "Подрядчики",
};

export const SHIPMENT_MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

export function getPaymentMethodOptions(category: string): PaymentMethodOption[] {
  if (category === AI_TOOLS_REQUEST_CATEGORY) {
    return PAYMENT_METHOD_OPTIONS.filter((item) => item !== "Наличные");
  }
  return [...PAYMENT_METHOD_OPTIONS];
}

export function normalizeContestSpecialistSource(
  source?: string,
): ContestSpecialistSource {
  return source === "contractor" ? "contractor" : "internal";
}

export function requiresContestSpecialistValidation(item: {
  department?: string;
  validationSkipped?: boolean;
}) {
  return Boolean(item.department && !item.validationSkipped);
}

export function isContestSpecialistValidated(item: {
  department?: string;
  directCost?: number;
  hodConfirmed?: boolean;
  validationSkipped?: boolean;
}) {
  if (!requiresContestSpecialistValidation(item)) {
    return true;
  }
  return Boolean(
    item.hodConfirmed &&
      typeof item.directCost === "number" &&
      Number.isFinite(item.directCost),
  );
}

export function calculateIncomingRatio(params: {
  incomingAmount?: number;
  amountWithoutVat?: number;
  amountWithVat?: number;
}) {
  if (
    params.incomingAmount === undefined ||
    !Number.isFinite(params.incomingAmount) ||
    params.incomingAmount <= 0
  ) {
    return undefined;
  }
  const outgoingAmount =
    typeof params.amountWithVat === "number" && Number.isFinite(params.amountWithVat) && params.amountWithVat > 0
      ? params.amountWithVat
      : typeof params.amountWithoutVat === "number" &&
          Number.isFinite(params.amountWithoutVat) &&
          params.amountWithoutVat > 0
        ? params.amountWithoutVat
        : undefined;
  if (!outgoingAmount) {
    return undefined;
  }
  return Number((params.incomingAmount / outgoingAmount).toFixed(4));
}

export function formatIncomingRatio(value?: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(4).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

export function isPaidByDateAllowed(value?: string) {
  if (!value) {
    return true;
  }
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) && year >= AGIMA_START_YEAR;
}

export function isPaidByTimestampAllowed(value?: number) {
  if (value === undefined) {
    return true;
  }
  return new Date(value).getFullYear() >= AGIMA_START_YEAR;
}

export function splitShipmentMonth(monthKey?: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey ?? "");
  if (!match) {
    return { year: "", month: "" };
  }
  return { year: match[1], month: match[2] };
}

export function buildShipmentMonthKey(year: string, month: string) {
  if (!year || !month) {
    return undefined;
  }
  return `${year}-${month}`;
}

export function buildShipmentYearOptions(currentYear: number, selectedYear?: string) {
  const selected = Number(selectedYear);
  const startYear = Number.isFinite(selected)
    ? Math.min(AGIMA_START_YEAR, selected, currentYear - 1)
    : Math.min(AGIMA_START_YEAR, currentYear - 1);
  const endYear = Number.isFinite(selected)
    ? Math.max(currentYear + 5, selected)
    : currentYear + 5;
  return Array.from({ length: endYear - startYear + 1 }, (_, index) =>
    String(startYear + index),
  );
}

export function formatMonthKeyLabel(monthKey?: string) {
  if (!monthKey) {
    return "";
  }
  const { year, month } = splitShipmentMonth(monthKey);
  const monthIndex = Number(month);
  if (!year || !monthIndex || monthIndex < 1 || monthIndex > 12) {
    return monthKey;
  }
  return `${SHIPMENT_MONTH_NAMES[monthIndex - 1]} ${year}`;
}
