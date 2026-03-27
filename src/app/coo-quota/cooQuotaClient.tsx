"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
  return `${monthNames[month - 1] ?? ""} ${year}`;
}

export default function CooQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const monthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: monthsCount }).map((_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [monthsCount]);
  const rowsQuery = useQuery(api.quotas.listCooByMonthKeys, { monthKeys });
  const update = useMutation(api.quotas.updateCooQuota);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, { quota?: string; adjusted?: string }>>({});

  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Квоты COO</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="grid grid-cols-5 gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Месяц и год</div>
            <div>Изначальная квота</div>
            <div>Измененная квота</div>
            <div>Потрачено</div>
            <div>Остаток</div>
          </div>
          {(rowsQuery ?? []).map((row) => {
            const quotaValue = values[row.monthKey]?.quota ?? String(row.quota);
            const adjustedValue = values[row.monthKey]?.adjusted ?? String(row.adjustedQuota);
            const remaining = row.adjustedQuota - row.spent;
            return (
              <div
                key={row.monthKey}
                className={`grid grid-cols-5 items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  remaining < 0
                    ? "border-rose-200 bg-rose-50/60"
                    : row.monthKey === currentKey
                      ? "border-emerald-300 bg-emerald-50/60"
                      : "border-border"
                }`}
              >
                <div className="font-medium">{formatMonth(row.year, row.month)}</div>
                <Input
                  value={quotaValue}
                  inputMode="decimal"
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [row.monthKey]: {
                        quota: event.target.value.replace(/\s+/g, ""),
                        adjusted: prev[row.monthKey]?.adjusted ?? event.target.value.replace(/\s+/g, ""),
                      },
                    }))
                  }
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={adjustedValue}
                    inputMode="decimal"
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [row.monthKey]: {
                          quota: prev[row.monthKey]?.quota ?? String(row.quota),
                          adjusted: event.target.value.replace(/\s+/g, ""),
                        },
                      }))
                    }
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={savingKey === row.monthKey}
                    onClick={async () => {
                      const nextQuota = Number(quotaValue);
                      const nextAdjusted = Number(adjustedValue);
                      if (!Number.isFinite(nextQuota) || !Number.isFinite(nextAdjusted)) {
                        return;
                      }
                      setSavingKey(row.monthKey);
                      await update({
                        monthKey: row.monthKey,
                        quota: nextQuota,
                        adjustedQuota: nextAdjusted,
                      });
                      setSavingKey(null);
                    }}
                  >
                    ✓
                  </Button>
                </div>
                <div>{row.spent.toLocaleString("ru-RU")}</div>
                <div className={remaining < 0 ? "font-semibold text-rose-600" : ""}>
                  {remaining.toLocaleString("ru-RU")}
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
  );
}
