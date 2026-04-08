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

export function resolveVatAmounts(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  vatRate?: number;
  autoCalculateAmountWithVat?: boolean;
}) {
  const vatRate = normalizeVatRate(params.vatRate);
  const amountWithoutVat = getAmountWithoutVat(
    params.amountWithoutVat,
    params.amountWithVat,
    vatRate,
  );
  const amountWithVat =
    params.autoCalculateAmountWithVat && isFiniteMoney(amountWithoutVat)
      ? calculateAmountWithVat(amountWithoutVat, vatRate)
      : getAmountWithVat(amountWithoutVat, params.amountWithVat, vatRate);

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
