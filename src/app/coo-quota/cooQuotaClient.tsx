"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import QuotaRemainingTable from "@/components/quota-remaining-table";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_VAT_RATE,
  formatAmount,
  parseMoneyInput,
  parseVatRateInput,
  resolveVatAmounts,
  syncVatInputPair,
  type VatAmountSource,
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

type QuotaTab = "internal" | "presales" | "ai";

function formatMonth(year: number, month: number) {
  return `${monthNames[month - 1] ?? ""} ${year}`;
}

export default function CooQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const [activeTab, setActiveTab] = useState<QuotaTab>("internal");
  const monthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: monthsCount }).map((_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [monthsCount]);
  const rowsQuery = useQuery(api.quotas.listCooByMonthKeys, { monthKeys });
  const presalesRows = useQuery(
    api.quotas.listByMonthKeys,
    activeTab === "presales" ? { monthKeys } : "skip",
  );
  const aiRows = useQuery(
    api.quotas.listAiToolByMonthKeys,
    activeTab === "ai" ? { monthKeys } : "skip",
  );
  const update = useMutation(api.quotas.updateCooQuota);
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
        quotaSource?: VatAmountSource;
        adjustedSource?: VatAmountSource;
      }
    >
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
      remaining: item.adjustedQuota - item.spent,
      remainingWithVat: (item.adjustedQuotaWithVat ?? item.adjustedQuota) - (item.spentWithVat ?? item.spent),
    }));
  }, [rowsQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={activeTab === "internal" ? "default" : "outline"}
          onClick={() => setActiveTab("internal")}
        >
          Внутренние затраты
        </Button>
        <Button
          type="button"
          variant={activeTab === "presales" ? "default" : "outline"}
          onClick={() => setActiveTab("presales")}
        >
          Пресейлы
        </Button>
        <Button
          type="button"
          variant={activeTab === "ai" ? "default" : "outline"}
          onClick={() => setActiveTab("ai")}
        >
          AI-сервисы
        </Button>
      </div>

      {activeTab === "presales" ? (
        <QuotaRemainingTable
          title="Квота на пресейлы"
          rows={presalesRows}
          onLoadMore={() => setMonthsCount((prev) => prev + 12)}
        />
      ) : null}
      {activeTab === "ai" ? (
        <QuotaRemainingTable
          title="Квоты на AI-инструменты"
          rows={aiRows}
          showTagBreakdown
          onLoadMore={() => setMonthsCount((prev) => prev + 12)}
        />
      ) : null}

      {activeTab === "internal" ? (
        <Card>
          <CardHeader>
            <CardTitle>Квоты COO</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <div className="grid grid-cols-[1fr_1.55fr_1.55fr_1fr_1fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Месяц и год</div>
                <div>Изначальная квота</div>
                <div>Измененная квота</div>
                <div>Потрачено</div>
                <div>Остаток</div>
              </div>
              {rows.map((row) => {
                const vatRateValue = values[row.monthKey]?.vatRate ?? String(row.vatRate ?? DEFAULT_VAT_RATE);
                const quotaSource = values[row.monthKey]?.quotaSource ?? "without";
                const adjustedSource = values[row.monthKey]?.adjustedSource ?? "without";
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
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextQuota = event.target.value.replace(/\s+/g, "");
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: nextQuota,
                                  amountWithVatInput: quotaWithVatValue,
                                  vatRateInput: vatRateValue,
                                  source: "without",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    quota: synced.amountWithoutVatInput,
                                    quotaWithVat: synced.amountWithVatInput,
                                    vatRate: vatRateValue,
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
                            value={quotaWithVatValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextQuotaWithVat = event.target.value.replace(/\s+/g, "");
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: quotaValue,
                                  amountWithVatInput: nextQuotaWithVat,
                                  vatRateInput: vatRateValue,
                                  source: "with",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    quota: synced.amountWithoutVatInput,
                                    quotaWithVat: synced.amountWithVatInput,
                                    vatRate: vatRateValue,
                                    quotaSource: "with",
                                    adjustedSource,
                                  },
                                };
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">НДС, %</span>
                          <Input
                            className="h-8 w-20"
                            value={vatRateValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextVatRate = event.target.value.replace(/\s+/g, "");
                                const syncedQuota = syncVatInputPair({
                                  amountWithoutVatInput: quotaValue,
                                  amountWithVatInput: quotaWithVatValue,
                                  vatRateInput: nextVatRate,
                                  source: quotaSource,
                                });
                                const syncedAdjusted = syncVatInputPair({
                                  amountWithoutVatInput: adjustedValue,
                                  amountWithVatInput: adjustedWithVatValue,
                                  vatRateInput: nextVatRate,
                                  source: adjustedSource,
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    quota: syncedQuota.amountWithoutVatInput,
                                    quotaWithVat: syncedQuota.amountWithVatInput,
                                    adjusted: syncedAdjusted.amountWithoutVatInput,
                                    adjustedWithVat: syncedAdjusted.amountWithVatInput,
                                    vatRate: nextVatRate,
                                    quotaSource,
                                    adjustedSource,
                                  },
                                };
                              })
                            }
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
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextAdjusted = event.target.value.replace(/\s+/g, "");
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: nextAdjusted,
                                  amountWithVatInput: adjustedWithVatValue,
                                  vatRateInput: vatRateValue,
                                  source: "without",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    adjusted: synced.amountWithoutVatInput,
                                    adjustedWithVat: synced.amountWithVatInput,
                                    vatRate: vatRateValue,
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
                            value={adjustedWithVatValue}
                            inputMode="decimal"
                            onChange={(event) =>
                              setValues((prev) => {
                                const nextAdjustedWithVat = event.target.value.replace(/\s+/g, "");
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: adjustedValue,
                                  amountWithVatInput: nextAdjustedWithVat,
                                  vatRateInput: vatRateValue,
                                  source: "with",
                                });
                                return {
                                  ...prev,
                                  [row.monthKey]: {
                                    ...prev[row.monthKey],
                                    adjusted: synced.amountWithoutVatInput,
                                    adjustedWithVat: synced.amountWithVatInput,
                                    vatRate: vatRateValue,
                                    quotaSource,
                                    adjustedSource: "with",
                                  },
                                };
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          size="icon"
                          variant="outline"
                          disabled={savingKey === row.monthKey}
                          onClick={async () => {
                            const resolvedQuota = resolveVatAmounts({
                              amountWithoutVat: parseMoneyInput(quotaValue),
                              amountWithVat: parseMoneyInput(quotaWithVatValue),
                              vatRate: parseVatRateInput(vatRateValue),
                              autoCalculateAmountWithVat: true,
                            });
                            const resolvedAdjusted = resolveVatAmounts({
                              amountWithoutVat: parseMoneyInput(adjustedValue),
                              amountWithVat: parseMoneyInput(adjustedWithVatValue),
                              vatRate: parseVatRateInput(vatRateValue),
                              autoCalculateAmountWithVat: true,
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
                            await update({
                              monthKey: row.monthKey,
                              quota: resolvedQuota.amountWithoutVat,
                              quotaWithVat: resolvedQuota.amountWithVat,
                              adjustedQuota: resolvedAdjusted.amountWithoutVat,
                              adjustedQuotaWithVat: resolvedAdjusted.amountWithVat,
                              vatRate: resolvedQuota.vatRate,
                            });
                            setSavingKey(null);
                          }}
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
              <Button variant="outline" onClick={() => setMonthsCount((prev) => prev + 12)}>
                Добавить следующие 12 месяцев
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
