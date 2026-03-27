"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const name = monthNames[month - 1] ?? "";
  return `${name} ${year}`;
}

export default function PresalesQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const monthKeys = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < monthsCount; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      keys.push(key);
    }
    return keys;
  }, [monthsCount]);

  const quotas = useQuery(api.quotas.listByMonthKeys, { monthKeys });
  const updateQuota = useMutation(api.quotas.updateQuota);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

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
      remaining: item.quota - item.spent,
    }));
  }, [quotas]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Квоты на пресейлы</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="grid grid-cols-4 gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Месяц и год</div>
            <div>Квота на месяц</div>
            <div>Потрачено</div>
            <div>Остаток квоты</div>
          </div>
          {rows.map((row) => (
            <div
              key={row.monthKey}
              className={`grid grid-cols-4 items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                row.remaining < 0
                  ? "border-rose-200 bg-rose-50/60"
                  : row.monthKey === currentKey
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-border"
              }`}
            >
              <div className="font-medium">
                {formatMonth(row.year, row.month)}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={values[row.monthKey] ?? String(row.quota)}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [row.monthKey]: event.target.value.replace(/\s+/g, ""),
                    }))
                  }
                  inputMode="decimal"
                />
                <Button
                  size="icon"
                  variant="outline"
                  disabled={savingKey === row.monthKey}
                  onClick={async () => {
                    const nextValue = Number(values[row.monthKey] ?? row.quota);
                    if (!Number.isFinite(nextValue)) {
                      return;
                    }
                    setSavingKey(row.monthKey);
                    await updateQuota({ monthKey: row.monthKey, quota: nextValue });
                    setSavingKey(null);
                  }}
                  aria-label="Обновить"
                >
                  ✓
                </Button>
              </div>
              <div>{row.spent.toLocaleString("ru-RU")}</div>
              <div className={row.remaining < 0 ? "font-semibold text-rose-600" : ""}>
                {row.remaining.toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
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
