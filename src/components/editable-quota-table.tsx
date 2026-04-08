"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_VAT_RATE,
  formatAmount,
  parseMoneyInput,
  resolveVatAmounts,
  sanitizeNumericInput,
  syncVatInputPair,
  type VatAmountSource,
} from "@/lib/vat";

type EditableQuotaRow = {
  monthKey: string;
  year: number;
  month: number;
  quota: number;
  quotaWithVat?: number;
  adjustedQuota?: number;
  adjustedQuotaWithVat?: number;
  spent: number;
  spentWithVat?: number;
  vatRate?: number;
};

type EditableQuotaTableProps = {
  title: string;
  description?: string;
  rows?: EditableQuotaRow[];
  onLoadMore?: () => void;
  onSave: (params: {
    monthKey: string;
    quota: number;
    quotaWithVat: number;
    adjustedQuota?: number;
    adjustedQuotaWithVat?: number;
    vatRate: number;
  }) => Promise<void>;
};

const MONTH_NAMES = [
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
];

function formatMonth(year: number, month: number) {
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

export default function EditableQuotaTable({
  title,
  description,
  rows,
  onLoadMore,
  onSave,
}: EditableQuotaTableProps) {
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<
    Record<
      string,
      {
        quota?: string;
        quotaWithVat?: string;
        adjusted?: string;
        adjustedWithVat?: string;
        quotaSource?: VatAmountSource;
        adjustedSource?: VatAmountSource;
      }
    >
  >({});
  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {!rows ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : (
          <>
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_1.45fr_1.45fr_0.95fr_0.95fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Месяц и год</div>
                <div>Изначальная квота</div>
                <div>Измененная квота</div>
                <div>Потрачено</div>
                <div>Остаток</div>
              </div>
              {rows.map((row) => {
                const vatRate = row.vatRate ?? DEFAULT_VAT_RATE;
                const quotaSource = values[row.monthKey]?.quotaSource ?? "without";
                const adjustedSource = values[row.monthKey]?.adjustedSource ?? "without";
                const quotaValue = values[row.monthKey]?.quota ?? String(row.quota);
                const quotaWithVatValue =
                  values[row.monthKey]?.quotaWithVat ?? String(row.quotaWithVat ?? row.quota);
                const adjustedValue =
                  values[row.monthKey]?.adjusted ??
                  (row.adjustedQuota !== undefined ? String(row.adjustedQuota) : "");
                const adjustedWithVatValue =
                  values[row.monthKey]?.adjustedWithVat ??
                  (row.adjustedQuotaWithVat !== undefined
                    ? String(row.adjustedQuotaWithVat)
                    : row.adjustedQuota !== undefined
                      ? String(row.adjustedQuota)
                      : "");

                const resolvedQuota = resolveVatAmounts({
                  amountWithoutVat: parseMoneyInput(quotaValue),
                  amountWithVat: parseMoneyInput(quotaWithVatValue),
                  vatRate,
                  autoCalculateAmountWithVat: true,
                });
                const hasAdjustedInput = Boolean(adjustedValue || adjustedWithVatValue);
                const resolvedAdjusted = hasAdjustedInput
                  ? resolveVatAmounts({
                      amountWithoutVat: parseMoneyInput(adjustedValue),
                      amountWithVat: parseMoneyInput(adjustedWithVatValue),
                      vatRate,
                      autoCalculateAmountWithVat: true,
                    })
                  : {
                      amountWithoutVat: undefined,
                      amountWithVat: undefined,
                    };
                const effectiveQuota = resolvedQuota.amountWithoutVat ?? row.quota;
                const effectiveQuotaWithVat =
                  resolvedQuota.amountWithVat ?? row.quotaWithVat ?? row.quota;
                const effectiveAdjusted = hasAdjustedInput
                  ? resolvedAdjusted.amountWithoutVat
                  : row.adjustedQuota;
                const effectiveAdjustedWithVat = hasAdjustedInput
                  ? resolvedAdjusted.amountWithVat
                  : row.adjustedQuotaWithVat ?? row.adjustedQuota;
                const spentWithVat = row.spentWithVat ?? row.spent;
                const remainingBase = effectiveAdjusted ?? effectiveQuota;
                const remainingBaseWithVat = effectiveAdjustedWithVat ?? effectiveQuotaWithVat;
                const remaining = remainingBase - row.spent;
                const remainingWithVat = remainingBaseWithVat - spentWithVat;

                return (
                  <div
                    key={row.monthKey}
                    className={`grid grid-cols-[1fr_1.45fr_1.45fr_0.95fr_0.95fr] items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                      remaining < 0 || remainingWithVat < 0
                        ? "border-rose-200 bg-rose-50/60"
                        : row.monthKey === currentKey
                          ? "border-emerald-300 bg-emerald-50/60"
                          : "border-border"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{formatMonth(row.year, row.month)}</div>
                      <div className="text-xs text-muted-foreground">НДС: {vatRate}%</div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Без НДС</div>
                          <Input
                            className="h-8"
                            value={quotaValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextQuota = sanitizeNumericInput(event.target.value);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: nextQuota,
                                  amountWithVatInput: quotaWithVatValue,
                                  vatRateInput: String(vatRate),
                                  source: "without",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    quota: synced.amountWithoutVatInput,
                                    quotaWithVat: synced.amountWithVatInput,
                                    quotaSource: "without",
                                    adjustedSource,
                                  },
                                };
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">С НДС</div>
                          <Input
                            className="h-8"
                            value={quotaWithVatValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextQuotaWithVat = sanitizeNumericInput(event.target.value);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: quotaValue,
                                  amountWithVatInput: nextQuotaWithVat,
                                  vatRateInput: String(vatRate),
                                  source: "with",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    quota: synced.amountWithoutVatInput,
                                    quotaWithVat: synced.amountWithVatInput,
                                    quotaSource: "with",
                                    adjustedSource,
                                  },
                                };
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Без НДС</div>
                          <Input
                            className="h-8"
                            value={adjustedValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextAdjusted = sanitizeNumericInput(event.target.value);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: nextAdjusted,
                                  amountWithVatInput: adjustedWithVatValue,
                                  vatRateInput: String(vatRate),
                                  source: "without",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    adjusted: nextAdjusted ? synced.amountWithoutVatInput : "",
                                    adjustedWithVat: nextAdjusted ? synced.amountWithVatInput : "",
                                    quotaSource,
                                    adjustedSource: "without",
                                  },
                                };
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">С НДС</div>
                          <Input
                            className="h-8"
                            value={adjustedWithVatValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextAdjustedWithVat = sanitizeNumericInput(event.target.value);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: adjustedValue,
                                  amountWithVatInput: nextAdjustedWithVat,
                                  vatRateInput: String(vatRate),
                                  source: "with",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    adjusted: nextAdjustedWithVat ? synced.amountWithoutVatInput : "",
                                    adjustedWithVat: nextAdjustedWithVat ? synced.amountWithVatInput : "",
                                    quotaSource,
                                    adjustedSource: "with",
                                  },
                                };
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">Если пусто, берем изначальную</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 rounded-lg p-0"
                          disabled={savingKey === row.monthKey}
                          onClick={async () => {
                            if (
                              resolvedQuota.amountWithoutVat === undefined ||
                              resolvedQuota.amountWithVat === undefined
                            ) {
                              return;
                            }
                            setSavingKey(row.monthKey);
                            await onSave({
                              monthKey: row.monthKey,
                              quota: resolvedQuota.amountWithoutVat,
                              quotaWithVat: resolvedQuota.amountWithVat,
                              adjustedQuota: resolvedAdjusted.amountWithoutVat,
                              adjustedQuotaWithVat: resolvedAdjusted.amountWithVat,
                              vatRate,
                            });
                            setSavingKey(null);
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div>Без НДС: {formatAmount(row.spent)}</div>
                      <div>С НДС: {formatAmount(spentWithVat)}</div>
                    </div>
                    <div
                      className={remaining < 0 || remainingWithVat < 0 ? "font-semibold text-rose-600" : ""}
                    >
                      <div>Без НДС: {formatAmount(remaining)}</div>
                      <div>С НДС: {formatAmount(remainingWithVat)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {onLoadMore ? (
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="outline" onClick={onLoadMore}>
                  Добавить следующие 12 месяцев
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
