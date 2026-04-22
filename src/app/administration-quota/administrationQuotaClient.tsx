"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOD_DEPARTMENTS } from "@/lib/constants";
import {
  DEFAULT_VAT_RATE,
  formatAmount,
  parseMoneyInput,
  resolveVatAmounts,
  sanitizeNumericInput,
  syncVatInputPair,
} from "@/lib/vat";

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

type QuotaRow = {
  monthKey: string;
  departmentKey: string;
  departmentName?: string;
  quota: number;
  quotaWithVat?: number;
  adjustedQuota?: number;
  adjustedQuotaWithVat?: number;
  vatRate?: number;
  spent: number;
  spentWithVat?: number;
  remaining: number;
  remainingWithVat?: number;
};

function formatMonth(year: number, month: number) {
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

function RowEditor({
  row,
  canEdit,
  onSave,
}: {
  row: QuotaRow;
  canEdit: boolean;
  onSave: (row: QuotaRow, values: { quota: number; quotaWithVat: number; adjustedQuota?: number; adjustedQuotaWithVat?: number; vatRate: number }) => Promise<void>;
}) {
  const [quota, setQuota] = useState(String(row.quota ?? 0));
  const [quotaWithVat, setQuotaWithVat] = useState(String(row.quotaWithVat ?? row.quota ?? 0));
  const [adjusted, setAdjusted] = useState(row.adjustedQuota !== undefined ? String(row.adjustedQuota) : "");
  const [adjustedWithVat, setAdjustedWithVat] = useState(row.adjustedQuotaWithVat !== undefined ? String(row.adjustedQuotaWithVat) : "");
  const [saving, setSaving] = useState(false);
  const vatRate = row.vatRate ?? DEFAULT_VAT_RATE;

  async function save() {
    const resolvedQuota = resolveVatAmounts({
      amountWithoutVat: parseMoneyInput(quota),
      amountWithVat: parseMoneyInput(quotaWithVat),
      vatRate,
      autoCalculateAmountWithVat: true,
    });
    const hasAdjusted = Boolean(adjusted || adjustedWithVat);
    const resolvedAdjusted = hasAdjusted
      ? resolveVatAmounts({
          amountWithoutVat: parseMoneyInput(adjusted),
          amountWithVat: parseMoneyInput(adjustedWithVat),
          vatRate,
          autoCalculateAmountWithVat: true,
        })
      : { amountWithoutVat: undefined, amountWithVat: undefined };
    if (resolvedQuota.amountWithoutVat === undefined || resolvedQuota.amountWithVat === undefined) {
      return;
    }
    setSaving(true);
    try {
      await onSave(row, {
        quota: resolvedQuota.amountWithoutVat,
        quotaWithVat: resolvedQuota.amountWithVat,
        adjustedQuota: resolvedAdjusted.amountWithoutVat,
        adjustedQuotaWithVat: resolvedAdjusted.amountWithVat,
        vatRate,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-background p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] md:items-end">
      <div>
        <div className="font-medium">{row.departmentName ?? "Общая квота"}</div>
        <div className="text-xs text-muted-foreground">НДС: {vatRate}%</div>
      </div>
      <div className="space-y-1">
        <Label>Изначальная</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={quota}
            inputMode="decimal"
            disabled={!canEdit}
            onChange={(event) => {
              const value = sanitizeNumericInput(event.target.value);
              setQuota(value);
              const synced = syncVatInputPair({
                amountWithoutVatInput: value,
                amountWithVatInput: quotaWithVat,
                vatRateInput: String(vatRate),
                source: "without",
              });
              setQuotaWithVat(synced.amountWithVatInput);
            }}
          />
          <Input
            value={quotaWithVat}
            inputMode="decimal"
            disabled={!canEdit}
            onChange={(event) => {
              const value = sanitizeNumericInput(event.target.value);
              setQuotaWithVat(value);
              const synced = syncVatInputPair({
                amountWithoutVatInput: quota,
                amountWithVatInput: value,
                vatRateInput: String(vatRate),
                source: "with",
              });
              setQuota(synced.amountWithoutVatInput);
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Измененная</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input value={adjusted} inputMode="decimal" disabled={!canEdit} onChange={(event) => setAdjusted(sanitizeNumericInput(event.target.value))} />
          <Input value={adjustedWithVat} inputMode="decimal" disabled={!canEdit} onChange={(event) => setAdjustedWithVat(sanitizeNumericInput(event.target.value))} />
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Потрачено</div>
        <div>{formatAmount(row.spent)} / {formatAmount(row.spentWithVat ?? row.spent)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Остаток</div>
        <div>{formatAmount(row.remaining)} / {formatAmount(row.remainingWithVat ?? row.remaining)}</div>
      </div>
      {canEdit ? (
        <Button type="button" onClick={save} disabled={saving}>
          Сохранить
        </Button>
      ) : null}
    </div>
  );
}

export default function AdministrationQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(6);
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const monthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: monthsCount }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [monthsCount]);
  const rows = useQuery(api.quotas.listAdministrationByMonthKeys, {
    monthKeys,
    department: departmentFilter === "all" ? undefined : departmentFilter,
    tag: tagFilter === "all" ? undefined : tagFilter === "none" ? "" : tagFilter,
  });
  const tags = useQuery(api.cfdTags.list, {
    requestArea: "Администрация",
    department: departmentFilter === "all" ? undefined : departmentFilter,
  });
  const updateQuota = useMutation(api.quotas.updateAdministrationQuota);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Фильтры</CardTitle>
          <CardDescription>
            Общая квота задается сверху, а ниже распределяется по цехам. Нераспределенный остаток остается в Администрации.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Цех</Label>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Все цеха" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все цеха</SelectItem>
                {HOD_DEPARTMENTS.map((department) => (
                  <SelectItem key={department} value={department}>
                    {department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Тег</Label>
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Все теги" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все теги</SelectItem>
                <SelectItem value="none">Без тега</SelectItem>
                {(tags ?? []).map((tag) => (
                  <SelectItem key={tag._id} value={tag.name}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!rows ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Загрузка...</CardContent>
        </Card>
      ) : (
        rows.map((month) => (
          <Card key={month.monthKey}>
            <CardHeader>
              <CardTitle>{formatMonth(month.year, month.month)}</CardTitle>
              <CardDescription>
                Нераспределено: {formatAmount(month.total.unallocated)} без НДС / {formatAmount(month.total.unallocatedWithVat)} с НДС
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <RowEditor
                row={{
                  monthKey: month.monthKey,
                  departmentKey: "__total__",
                  quota: month.total.quota,
                  quotaWithVat: month.total.quotaWithVat,
                  adjustedQuota: month.total.adjustedQuota,
                  adjustedQuotaWithVat: month.total.adjustedQuotaWithVat,
                  vatRate: month.total.vatRate,
                  spent: month.total.spent,
                  spentWithVat: month.total.spentWithVat,
                  remaining: month.total.remaining,
                  remainingWithVat: month.total.remainingWithVat,
                }}
                canEdit={month.canEdit}
                onSave={async (row, values) => {
                  await updateQuota({ monthKey: row.monthKey, departmentKey: row.departmentKey, ...values });
                }}
              />
              {month.departments.map((department) => (
                <RowEditor
                  key={`${month.monthKey}-${department.departmentKey}`}
                  row={department}
                  canEdit={month.canEdit}
                  onSave={async (row, values) => {
                    await updateQuota({ monthKey: row.monthKey, departmentKey: row.departmentKey, ...values });
                  }}
                />
              ))}
              {month.tagBreakdown.length ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
                  <div className="font-medium">Расходы по тегам</div>
                  <div className="mt-2 grid gap-1">
                    {month.tagBreakdown.map((item) => (
                      <div key={item.tag} className="flex justify-between gap-3">
                        <span>{item.tag}</span>
                        <span>{formatAmount(item.amountWithoutVat)} / {formatAmount(item.amountWithVat)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => setMonthsCount((count) => count + 6)}>
        Показать еще 6 месяцев
      </Button>
    </div>
  );
}
