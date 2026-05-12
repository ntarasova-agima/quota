"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatAmount,
  parseMoneyInput,
  sanitizeNumericInput,
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
      }
    >
  >({});
  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  function isSameNumber(left?: number, right?: number) {
    return left === right || (left === undefined && right === undefined);
  }

  async function saveRow(row: EditableQuotaRow) {
    const quotaValue = values[row.monthKey]?.quota ?? String(row.adjustedQuota ?? row.quota);
    const quota = parseMoneyInput(quotaValue);

    if (quota === undefined) {
      return;
    }

    const currentQuota = row.adjustedQuota ?? row.quota;
    const hasChanges = !isSameNumber(quota, currentQuota);

    if (!hasChanges) {
      return;
    }

    setSavingKey(row.monthKey);
    try {
      await onSave({
        monthKey: row.monthKey,
        quota,
        quotaWithVat: quota,
        adjustedQuota: undefined,
        adjustedQuotaWithVat: undefined,
        vatRate: 0,
      });
      setValues((prev) => ({
        ...prev,
        [row.monthKey]: {
          ...prev[row.monthKey],
          quota: String(quota),
        },
      }));
    } finally {
      setSavingKey(null);
    }
  }

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
              <div className="grid grid-cols-[1.1fr_1.45fr_0.95fr_0.95fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Месяц и год</div>
                <div>Квота</div>
                <div>Потрачено</div>
                <div>Остаток</div>
              </div>
              {rows.map((row) => {
                const quotaValue = values[row.monthKey]?.quota ?? String(row.adjustedQuota ?? row.quota);
                const effectiveQuota = parseMoneyInput(quotaValue) ?? row.adjustedQuota ?? row.quota;
                const remaining = effectiveQuota - row.spent;

                return (
                  <div
                    key={row.monthKey}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                        void saveRow(row);
                      }
                    }}
                    className={`grid grid-cols-[1.1fr_1.45fr_0.95fr_0.95fr] items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                      remaining < 0
                        ? "border-rose-200 bg-rose-50/60"
                        : row.monthKey === currentKey
                          ? "border-emerald-300 bg-emerald-50/60"
                          : "border-border"
                    } ${savingKey === row.monthKey ? "opacity-80" : ""}`}
                  >
                    <div className="space-y-1">
                      <div className="font-medium">{formatMonth(row.year, row.month)}</div>
                      <div className="text-xs text-muted-foreground">Все суммы без НДС</div>
                      {savingKey === row.monthKey ? (
                        <div className="text-xs text-muted-foreground">Сохраняем...</div>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Input
                        className="h-8"
                        value={quotaValue}
                        inputMode="decimal"
                        onChange={(event) =>
                          setValues((prev) => ({
                            ...prev,
                            [row.monthKey]: {
                              ...prev[row.monthKey],
                              quota: sanitizeNumericInput(event.target.value),
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <div>{formatAmount(row.spent)}</div>
                    </div>
                    <div
                      className={remaining < 0 ? "font-semibold text-rose-600" : ""}
                    >
                      <div>{formatAmount(remaining)}</div>
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
