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

export default function AiToolsQuotaClient() {
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

  const rowsQuery = useQuery(api.quotas.listAiToolByMonthKeys, { monthKeys });
  const updateQuota = useMutation(api.quotas.updateAiToolQuota);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<
    Record<string, { quota?: string; quotaWithVat?: string; vatRate?: string; auto?: boolean }>
  >({});

  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const rows = useMemo(() => {
    if (!rowsQuery) {
      return [];
    }
    return rowsQuery.map((item) => ({
      ...item,
      remaining: item.quota - item.spent,
      remainingWithVat: (item.quotaWithVat ?? item.quota) - (item.spentWithVat ?? item.spent),
    }));
  }, [rowsQuery]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Квоты на AI-инструменты</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1.1fr_1.4fr_1fr_1fr_1.4fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Месяц и год</div>
            <div>Квота на месяц</div>
            <div>Потрачено</div>
            <div>Остаток</div>
            <div>По тегам</div>
          </div>
          {rows.map((row) => {
            const vatRateValue = values[row.monthKey]?.vatRate ?? String(row.vatRate ?? DEFAULT_VAT_RATE);
            const autoCalculateVat =
              values[row.monthKey]?.auto ??
              matchesCalculatedAmountWithVat(row.quota, row.quotaWithVat, row.vatRate);
            const quotaValue = values[row.monthKey]?.quota ?? String(row.quota);
            const quotaWithVatValue =
              values[row.monthKey]?.quotaWithVat ?? String(row.quotaWithVat ?? row.quota);
            return (
              <div
                key={row.monthKey}
                className={`grid grid-cols-[1.1fr_1.4fr_1fr_1fr_1.4fr] items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
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
                            const nextVatRate = Number(vatRateValue);
                            return {
                              ...prev,
                              [row.monthKey]: {
                                ...prev[row.monthKey],
                                quota: nextQuota,
                                quotaWithVat:
                                  autoCalculateVat && nextQuota
                                    ? String(calculateAmountWithVat(Number(nextQuota), nextVatRate))
                                    : prev[row.monthKey]?.quotaWithVat ?? quotaWithVatValue,
                                vatRate: vatRateValue,
                                auto: autoCalculateVat,
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
                              auto: false,
                            },
                          }))
                        }
                        inputMode="decimal"
                        disabled={autoCalculateVat}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={autoCalculateVat}
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
                              auto: Boolean(checked),
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
                                  autoCalculateVat && quotaValue && nextVatRate
                                    ? String(calculateAmountWithVat(Number(quotaValue), Number(nextVatRate)))
                                    : quotaWithVatValue,
                                vatRate: nextVatRate,
                                auto: autoCalculateVat,
                              },
                            };
                          })
                        }
                        inputMode="decimal"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={savingKey === row.monthKey}
                      onClick={async () => {
                        const resolved = resolveVatAmounts({
                          amountWithoutVat: quotaValue ? Number(quotaValue) : undefined,
                          amountWithVat: quotaWithVatValue ? Number(quotaWithVatValue) : undefined,
                          vatRate: vatRateValue ? Number(vatRateValue) : undefined,
                          autoCalculateAmountWithVat: autoCalculateVat,
                        });
                        if (
                          resolved.amountWithoutVat === undefined ||
                          resolved.amountWithVat === undefined
                        ) {
                          return;
                        }
                        setSavingKey(row.monthKey);
                        await updateQuota({
                          monthKey: row.monthKey,
                          quota: resolved.amountWithoutVat,
                          quotaWithVat: resolved.amountWithVat,
                          vatRate: resolved.vatRate,
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
                <div className="space-y-1">
                  {row.tagBreakdown?.length ? (
                    row.tagBreakdown.map(
                      (item: { tag: string; amountWithoutVat: number; amountWithVat: number }) => (
                        <div
                          key={`${row.monthKey}-${item.tag}`}
                          className="rounded-md border border-zinc-200 bg-white/80 px-2 py-1 text-xs"
                        >
                          <div className="truncate font-medium">{item.tag}</div>
                          <div className="text-muted-foreground">
                            Без НДС: {formatAmount(item.amountWithoutVat)}
                          </div>
                          <div className="text-muted-foreground">
                            С НДС: {formatAmount(item.amountWithVat)}
                          </div>
                        </div>
                      ),
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">Пока нет согласованных трат</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setMonthsCount((prev) => prev + 12)}
          >
            Добавить следующие 12 месяцев
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
