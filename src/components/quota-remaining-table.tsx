"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/lib/vat";

type QuotaRow = {
  monthKey: string;
  year: number;
  month: number;
  quota: number;
  quotaWithVat?: number;
  adjustedQuota?: number;
  adjustedQuotaWithVat?: number;
  spent: number;
  spentWithVat?: number;
  tagBreakdown?: Array<{
    tag: string;
    amountWithoutVat: number;
    amountWithVat: number;
  }>;
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

type QuotaRemainingTableProps = {
  title: string;
  description?: string;
  emptyText?: string;
  onLoadMore?: () => void;
  rows?: QuotaRow[];
};

export default function QuotaRemainingTable({
  title,
  description,
  emptyText = "Пока нет данных по квоте.",
  onLoadMore,
  rows,
}: QuotaRemainingTableProps) {
  const currentKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  if (!rows) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-[1.1fr_1.35fr_1fr_1fr] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <div>Месяц и год</div>
              <div>Квота</div>
              <div>Потрачено</div>
              <div>Остаток</div>
            </div>
            {rows.map((row) => {
              const quotaForRemaining = row.adjustedQuota ?? row.quota;
              const remaining = quotaForRemaining - row.spent;
              const isAlert = remaining < 0;
              return (
                <div
                  key={row.monthKey}
                  className={`grid grid-cols-[1.1fr_1.35fr_1fr_1fr] items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
                    isAlert
                      ? "border-rose-200 bg-rose-50/60"
                      : row.monthKey === currentKey
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-border"
                  }`}
                >
                  <div className="font-medium">{formatMonth(row.year, row.month)}</div>
                  <div className="space-y-1">
                    <div>{formatAmount(quotaForRemaining)}</div>
                  </div>
                  <div className="space-y-1">
                    <div>{formatAmount(row.spent)}</div>
                  </div>
                  <div className={isAlert ? "font-semibold text-rose-600" : ""}>
                    <div>{formatAmount(remaining)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        )}
        {onLoadMore ? (
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" onClick={onLoadMore}>
              Добавить следующие 12 месяцев
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
