export const DEFAULT_VAT_RATE = 22;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeVatRate(vatRate?: number) {
  if (typeof vatRate === "number" && Number.isFinite(vatRate) && vatRate >= 0) {
    return vatRate;
  }
  return DEFAULT_VAT_RATE;
}

export function isFiniteMoney(value?: number): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseMoneyInput(value?: string | null) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseVatRateInput(value?: string | null) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function calculateAmountWithVat(amountWithoutVat: number, vatRate?: number) {
  return roundMoney(amountWithoutVat * (1 + normalizeVatRate(vatRate) / 100));
}

export function calculateAmountWithoutVat(amountWithVat: number, vatRate?: number) {
  return roundMoney(amountWithVat / (1 + normalizeVatRate(vatRate) / 100));
}

export function getAmountWithVat(
  amountWithoutVat?: number,
  amountWithVat?: number,
  vatRate?: number,
) {
  if (isFiniteMoney(amountWithVat)) {
    return amountWithVat;
  }
  if (isFiniteMoney(amountWithoutVat)) {
    return calculateAmountWithVat(amountWithoutVat, vatRate);
  }
  return undefined;
}

export function getAmountWithoutVat(
  amountWithoutVat?: number,
  amountWithVat?: number,
  vatRate?: number,
) {
  if (isFiniteMoney(amountWithoutVat)) {
    return amountWithoutVat;
  }
  if (isFiniteMoney(amountWithVat)) {
    return calculateAmountWithoutVat(amountWithVat, vatRate);
  }
  return undefined;
}

export function fillMissingVatAmounts(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  vatRate?: number;
}) {
  if (isFiniteMoney(params.amountWithoutVat) && !isFiniteMoney(params.amountWithVat)) {
    return {
      amountWithoutVat: params.amountWithoutVat,
      amountWithVat: calculateAmountWithVat(params.amountWithoutVat, params.vatRate),
    };
  }
  if (!isFiniteMoney(params.amountWithoutVat) && isFiniteMoney(params.amountWithVat)) {
    return {
      amountWithoutVat: calculateAmountWithoutVat(params.amountWithVat, params.vatRate),
      amountWithVat: params.amountWithVat,
    };
  }
  return {
    amountWithoutVat: params.amountWithoutVat,
    amountWithVat: params.amountWithVat,
  };
}

export function resolveVatAmounts(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  vatRate?: number;
  autoCalculateAmountWithVat?: boolean;
}) {
  const vatRate = normalizeVatRate(params.vatRate);
  const filledAmounts = params.autoCalculateAmountWithVat
    ? fillMissingVatAmounts({
        amountWithoutVat: params.amountWithoutVat,
        amountWithVat: params.amountWithVat,
        vatRate,
      })
    : {
        amountWithoutVat: params.amountWithoutVat,
        amountWithVat: params.amountWithVat,
      };
  const amountWithoutVat = getAmountWithoutVat(
    filledAmounts.amountWithoutVat,
    filledAmounts.amountWithVat,
    vatRate,
  );
  const amountWithVat = getAmountWithVat(
    amountWithoutVat,
    filledAmounts.amountWithVat,
    vatRate,
  );

  return {
    amountWithoutVat,
    amountWithVat,
    vatRate,
  };
}

export function matchesCalculatedAmountWithVat(
  amountWithoutVat?: number,
  amountWithVat?: number,
  vatRate?: number,
) {
  if (!isFiniteMoney(amountWithoutVat) || !isFiniteMoney(amountWithVat)) {
    return false;
  }
  return Math.abs(calculateAmountWithVat(amountWithoutVat, vatRate) - amountWithVat) < 0.01;
}

export function formatAmount(value?: number) {
  if (!isFiniteMoney(value)) {
    return "—";
  }
  return value.toLocaleString("ru-RU");
}

export function formatAmountPair(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  currency?: string;
  vatRate?: number;
}) {
  const amountWithoutVat = getAmountWithoutVat(
    params.amountWithoutVat,
    params.amountWithVat,
    params.vatRate,
  );
  const amountWithVat = getAmountWithVat(
    amountWithoutVat,
    params.amountWithVat,
    params.vatRate,
  );
  const currency = params.currency ?? "";
  return `${formatAmount(amountWithoutVat)} ${currency} без НДС / ${formatAmount(amountWithVat)} ${currency} с НДС`;
}
