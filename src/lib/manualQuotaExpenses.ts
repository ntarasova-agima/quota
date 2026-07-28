import { roundQuotaAmount } from "./quotaTransfers";

export type ManualExpenseCounterparty = {
  id?: string;
  name: string;
  amount: number;
};

export function prepareManualExpenseCounterparties(
  existing: ManualExpenseCounterparty[],
  updates: ManualExpenseCounterparty[],
  idSeed: string,
) {
  if (!updates.length) {
    throw new Error("Добавьте хотя бы одного контрагента");
  }
  const existingIds = new Set(
    existing.map((counterparty, index) => counterparty.id?.trim() || `counterparty:${index}`),
  );
  const counterparties = updates.map((counterparty, index) => ({
    id: counterparty.id && existingIds.has(counterparty.id)
      ? counterparty.id
      : `manual-${idSeed}-${index}`,
    name: counterparty.name.trim(),
    amount: roundQuotaAmount(counterparty.amount),
  }));
  if (counterparties.some((counterparty) => !counterparty.name)) {
    throw new Error("Укажите имя каждого контрагента");
  }
  if (counterparties.some((counterparty) => !Number.isFinite(counterparty.amount) || counterparty.amount <= 0)) {
    throw new Error("Укажите положительную сумму для каждого контрагента");
  }
  if (new Set(counterparties.map((counterparty) => counterparty.id)).size !== counterparties.length) {
    throw new Error("Контрагент указан несколько раз");
  }
  return {
    counterparties,
    amount: roundQuotaAmount(
      counterparties.reduce((sum, counterparty) => sum + counterparty.amount, 0),
    ),
  };
}
