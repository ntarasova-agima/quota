"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_VAT_RATE,
  calculateAmountWithVat,
  formatAmount,
  matchesCalculatedAmountWithVat,
  resolveVatAmounts,
} from "@/lib/vat";

const monthNames = [
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
  const name = monthNames[month - 1] ?? "";
  return `${name} ${year}`;
}

export default function CfdQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const monthKeys = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < monthsCount; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  }, [monthsCount]);
  const quotas = useQuery(api.quotas.listCfdByMonthKeys, { monthKeys });
  const updateQuota = useMutation(api.quotas.updateCfdQuota);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<
    Record<
      string,
      {
        quota?: string;
        quotaWithVat?: string;
        adjusted?: string;
        adjustedWithVat?: string;
        vatRate?: string;
        quotaAuto?: boolean;
        adjustedAuto?: boolean;
      }
    >
  >({});

  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const rows = useMemo(() => {
    if (!quotas) {
      return [];
    }
    return quotas.map((item) => ({
      ...item,
      remaining: item.adjustedQuota - item.spent,
      remainingWithVat: (item.adjustedQuotaWithVat ?? item.adjustedQuota) - (item.spentWithVat ?? item.spent),
    }));
  }, [quotas]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Квоты CFD</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_1.55fr_1.55fr_1fr_1fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Месяц и год</div>
            <div>Квота на месяц</div>
            <div>Изменение квоты</div>
            <div>Потрачено</div>
            <div>Остаток квоты</div>
          </div>
          {rows.map((row) => {
            const vatRateValue = values[row.monthKey]?.vatRate ?? String(row.vatRate ?? DEFAULT_VAT_RATE);
            const quotaAuto =
              values[row.monthKey]?.quotaAuto ??
              matchesCalculatedAmountWithVat(row.quota, row.quotaWithVat, row.vatRate);
            const adjustedAuto =
              values[row.monthKey]?.adjustedAuto ??
              matchesCalculatedAmountWithVat(
                row.adjustedQuota,
                row.adjustedQuotaWithVat,
                row.vatRate,
              );
            const quotaValue = values[row.monthKey]?.quota ?? String(row.quota);
            const quotaWithVatValue =
              values[row.monthKey]?.quotaWithVat ?? String(row.quotaWithVat ?? row.quota);
            const adjustedValue = values[row.monthKey]?.adjusted ?? String(row.adjustedQuota);
            const adjustedWithVatValue =
              values[row.monthKey]?.adjustedWithVat ??
              String(row.adjustedQuotaWithVat ?? row.adjustedQuota);

            return (
              <div
                key={row.monthKey}
                className={`grid grid-cols-[1fr_1.55fr_1.55fr_1fr_1fr] items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
                  row.remaining < 0 || row.remainingWithVat < 0
                    ? "border-rose-200 bg-rose-50/60"
                    : row.monthKey === currentKey
                      ? "border-emerald-300 bg-emerald-50/60"
                      : "border-border"
                }`}
              >
                <div className="font-medium">{formatMonth(row.year, row.month)}</div>
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Без НДС</div>
                      <Input
                        value={quotaValue}
                        onChange={(event) =>
                          setValues((prev) => {
                            const nextQuota = event.target.value.replace(/\s+/g, "");
                            return {
                              ...prev,
                              [row.monthKey]: {
                                ...prev[row.monthKey],
                                quota: nextQuota,
                                quotaWithVat:
                                  quotaAuto && nextQuota
                                    ? String(calculateAmountWithVat(Number(nextQuota), Number(vatRateValue)))
                                    : prev[row.monthKey]?.quotaWithVat ?? quotaWithVatValue,
                                vatRate: vatRateValue,
                                quotaAuto,
                                adjustedAuto,
                              },
                            };
                          })
                        }
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">С НДС</div>
                      <Input
                        value={quotaWithVatValue}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.monthKey]: {
                              ...prev[row.monthKey],
                              quota: quotaValue,
                              quotaWithVat: event.target.value.replace(/\s+/g, ""),
                              vatRate: vatRateValue,
                              quotaAuto: false,
                              adjustedAuto,
                            },
                          }))
                        }
                        inputMode="decimal"
                        disabled={quotaAuto}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={quotaAuto}
                        onCheckedChange={(checked) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.monthKey]: {
                              ...prev[row.monthKey],
                              quota: quotaValue,
                              quotaWithVat:
                                checked && quotaValue
                                  ? String(calculateAmountWithVat(Number(quotaValue), Number(vatRateValue)))
                                  : quotaWithVatValue,
                              vatRate: vatRateValue,
                              quotaAuto: Boolean(checked),
                              adjustedAuto,
                            },
                          }))
                        }
                      />
                      <span className="text-xs text-muted-foreground">Авто НДС</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">НДС, %</span>
                      <Input
                        className="h-8 w-20"
                        value={vatRateValue}
                        onChange={(event) =>
                          setValues((prev) => {
                            const nextVatRate = event.target.value.replace(/\s+/g, "");
                            return {
                              ...prev,
                              [row.monthKey]: {
                                ...prev[row.monthKey],
                                quota: quotaValue,
                                quotaWithVat:
                                  quotaAuto && quotaValue && nextVatRate
                                    ? String(calculateAmountWithVat(Number(quotaValue), Number(nextVatRate)))
                                    : quotaWithVatValue,
                                adjusted: adjustedValue,
                                adjustedWithVat:
                                  adjustedAuto && adjustedValue && nextVatRate
                                    ? String(calculateAmountWithVat(Number(adjustedValue), Number(nextVatRate)))
                                    : adjustedWithVatValue,
                                vatRate: nextVatRate,
                                quotaAuto,
                                adjustedAuto,
                              },
                            };
                          })
                        }
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Без НДС</div>
                      <Input
                        value={adjustedValue}
                        onChange={(event) =>
                          setValues((prev) => {
                            const nextAdjusted = event.target.value.replace(/\s+/g, "");
                            return {
                              ...prev,
                              [row.monthKey]: {
                                ...prev[row.monthKey],
                                adjusted: nextAdjusted,
                                adjustedWithVat:
                                  adjustedAuto && nextAdjusted
                                    ? String(calculateAmountWithVat(Number(nextAdjusted), Number(vatRateValue)))
                                    : prev[row.monthKey]?.adjustedWithVat ?? adjustedWithVatValue,
                                vatRate: vatRateValue,
                                quotaAuto,
                                adjustedAuto,
                              },
                            };
                          })
                        }
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">С НДС</div>
                      <Input
                        value={adjustedWithVatValue}
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.monthKey]: {
                              ...prev[row.monthKey],
                              adjusted: adjustedValue,
                              adjustedWithVat: event.target.value.replace(/\s+/g, ""),
                              vatRate: vatRateValue,
                              quotaAuto,
                              adjustedAuto: false,
                            },
                          }))
                        }
                        inputMode="decimal"
                        disabled={adjustedAuto}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={adjustedAuto}
                        onCheckedChange={(checked) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.monthKey]: {
                              ...prev[row.monthKey],
                              adjusted: adjustedValue,
                              adjustedWithVat:
                                checked && adjustedValue
                                  ? String(calculateAmountWithVat(Number(adjustedValue), Number(vatRateValue)))
                                  : adjustedWithVatValue,
                              vatRate: vatRateValue,
                              quotaAuto,
                              adjustedAuto: Boolean(checked),
                            },
                          }))
                        }
                      />
                      <span className="text-xs text-muted-foreground">Авто НДС</span>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={savingKey === row.monthKey}
                      onClick={async () => {
                        const resolvedQuota = resolveVatAmounts({
                          amountWithoutVat: quotaValue ? Number(quotaValue) : undefined,
                          amountWithVat: quotaWithVatValue ? Number(quotaWithVatValue) : undefined,
                          vatRate: vatRateValue ? Number(vatRateValue) : undefined,
                          autoCalculateAmountWithVat: quotaAuto,
                        });
                        const resolvedAdjusted = resolveVatAmounts({
                          amountWithoutVat: adjustedValue ? Number(adjustedValue) : undefined,
                          amountWithVat: adjustedWithVatValue ? Number(adjustedWithVatValue) : undefined,
                          vatRate: vatRateValue ? Number(vatRateValue) : undefined,
                          autoCalculateAmountWithVat: adjustedAuto,
                        });
                        if (
                          resolvedQuota.amountWithoutVat === undefined ||
                          resolvedQuota.amountWithVat === undefined ||
                          resolvedAdjusted.amountWithoutVat === undefined ||
                          resolvedAdjusted.amountWithVat === undefined
                        ) {
                          return;
                        }
                        setSavingKey(row.monthKey);
                        await updateQuota({
                          monthKey: row.monthKey,
                          quota: resolvedQuota.amountWithoutVat,
                          quotaWithVat: resolvedQuota.amountWithVat,
                          adjustedQuota: resolvedAdjusted.amountWithoutVat,
                          adjustedQuotaWithVat: resolvedAdjusted.amountWithVat,
                          vatRate: resolvedQuota.vatRate,
                        });
                        setSavingKey(null);
                      }}
                      aria-label="Обновить"
                    >
                      ✓
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div>Без НДС: {formatAmount(row.spent)}</div>
                  <div>С НДС: {formatAmount(row.spentWithVat)}</div>
                </div>
                <div
                  className={row.remaining < 0 || row.remainingWithVat < 0 ? "font-semibold text-rose-600" : ""}
                >
                  <div>Без НДС: {formatAmount(row.remaining)}</div>
                  <div>С НДС: {formatAmount(row.remainingWithVat)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" onClick={() => setMonthsCount((prev) => prev + 12)}>
            Добавить следующие 12 месяцев
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
