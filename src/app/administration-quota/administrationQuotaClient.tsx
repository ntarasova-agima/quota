"use client";

import { useEffect, useMemo, useState } from "react";
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

type QuotaEditableRow = {
  monthKey: string;
  departmentKey: string;
  tagName?: string;
  quota: number;
  quotaWithVat?: number;
  vatRate?: number;
  spent: number;
  spentWithVat?: number;
  remaining: number;
  remainingWithVat?: number;
  distributed?: number;
  unallocated?: number;
};

type HistoryEvent = {
  key: string;
  type: "quota_change" | "request_usage";
  monthKey: string;
  level?: "total" | "department" | "tag";
  departmentKey?: string;
  tagName?: string;
  fromQuota?: number;
  toQuota?: number;
  amountWithoutVat?: number;
  amountWithVat?: number;
  actorEmail?: string;
  actorName?: string;
  requestCode?: string;
  requestTitle?: string;
  createdAt: number;
};

function formatMonth(year: number, month: number) {
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

function formatEventMonth(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

function RowEditor({
  row,
  canEdit,
  label,
  tone = "plain",
  onSave,
}: {
  row: QuotaEditableRow;
  canEdit: boolean;
  label: string;
  tone?: "total" | "department" | "tag" | "plain";
  onSave: (row: QuotaEditableRow, values: { quota: number; quotaWithVat: number; vatRate: number }) => Promise<void>;
}) {
  const [quota, setQuota] = useState(String(row.quota ?? 0));
  const [quotaWithVat, setQuotaWithVat] = useState(String(row.quotaWithVat ?? row.quota ?? 0));
  const [saving, setSaving] = useState(false);
  const vatRate = row.vatRate ?? DEFAULT_VAT_RATE;

  useEffect(() => {
    setQuota(String(row.quota ?? 0));
    setQuotaWithVat(String(row.quotaWithVat ?? row.quota ?? 0));
  }, [row.quota, row.quotaWithVat]);

  async function saveIfChanged() {
    if (!canEdit || saving) {
      return;
    }
    const resolved = resolveVatAmounts({
      amountWithoutVat: parseMoneyInput(quota),
      amountWithVat: parseMoneyInput(quotaWithVat),
      vatRate,
      autoCalculateAmountWithVat: true,
    });
    if (resolved.amountWithoutVat === undefined || resolved.amountWithVat === undefined) {
      return;
    }
    if (
      resolved.amountWithoutVat === row.quota &&
      resolved.amountWithVat === (row.quotaWithVat ?? row.quota)
    ) {
      return;
    }
    setSaving(true);
    try {
      await onSave(row, {
        quota: resolved.amountWithoutVat,
        quotaWithVat: resolved.amountWithVat,
        vatRate,
      });
    } finally {
      setSaving(false);
    }
  }

  const wrapperClass =
    tone === "total"
      ? "rounded-2xl border-2 border-emerald-400 bg-emerald-50/60 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.08)]"
      : tone === "department"
        ? "rounded-2xl border border-zinc-200 bg-white p-4"
        : "rounded-xl border border-zinc-100 bg-zinc-50/80 p-3";

  return (
    <div className={wrapperClass}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)] md:items-end">
        <div>
          <div className={tone === "total" ? "text-lg font-semibold" : "font-medium"}>{label}</div>
          <div className="text-xs text-muted-foreground">НДС: {vatRate}%</div>
        </div>
        <div className="space-y-1">
          <Label>Квота без НДС</Label>
          <Input
            value={quota}
            inputMode="decimal"
            disabled={!canEdit}
            onBlur={saveIfChanged}
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
        </div>
        <div className="space-y-1">
          <Label>Квота с НДС</Label>
          <Input
            value={quotaWithVat}
            inputMode="decimal"
            disabled={!canEdit}
            onBlur={saveIfChanged}
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
        <div>
          <div className="text-xs text-muted-foreground">Потрачено</div>
          <div>{formatAmount(row.spent)} / {formatAmount(row.spentWithVat ?? row.spent)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Остаток</div>
          <div>{formatAmount(row.remaining)} / {formatAmount(row.remainingWithVat ?? row.remaining)}</div>
          {saving ? <div className="text-xs text-emerald-700">Сохраняю...</div> : null}
        </div>
      </div>
      {row.unallocated !== undefined ? (
        <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-muted-foreground">
          Не распределено: {formatAmount(row.unallocated)} без НДС
        </div>
      ) : null}
    </div>
  );
}

export default function AdministrationQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(6);
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"quotas" | "history">("quotas");
  const monthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: monthsCount }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [monthsCount]);
  const queryFilters = {
    monthKeys,
    department: departmentFilter === "all" ? undefined : departmentFilter,
    tag: tagFilter === "all" ? undefined : tagFilter === "none" ? "Без тега" : tagFilter,
  };
  const rows = useQuery(api.quotas.listAdministrationByMonthKeys, queryFilters);
  const history = useQuery(api.quotas.listAdministrationHistory, queryFilters) as HistoryEvent[] | undefined;
  const tags = useQuery(api.cfdTags.list, {
    department: departmentFilter === "all" ? undefined : departmentFilter,
  });
  const updateQuota = useMutation(api.quotas.updateAdministrationQuota);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Фильтры</CardTitle>
          <CardDescription>
            Общая квота распределяется по цехам, а внутри цехов ее можно разложить по тегам.
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={activeTab === "quotas" ? "default" : "outline"} onClick={() => setActiveTab("quotas")}>
          Квоты
        </Button>
        <Button type="button" variant={activeTab === "history" ? "default" : "outline"} onClick={() => setActiveTab("history")}>
          История изменений
        </Button>
      </div>

      {activeTab === "history" ? (
        <Card>
          <CardHeader>
            <CardTitle>История изменений</CardTitle>
            <CardDescription>Здесь видно ручные изменения квот и заявки, которые списали сумму из квоты.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!history ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : history.length ? (
              history.map((event) => (
                <div key={event.key} className="rounded-xl border border-border px-4 py-3 text-sm">
                  <div className="font-medium">
                    {event.type === "quota_change" ? "Изменение квоты" : "Списание по заявке"}
                  </div>
                  <div className="text-muted-foreground">
                    {formatEventMonth(event.monthKey)}
                    {event.departmentKey ? ` · ${event.departmentKey}` : ""}
                    {event.tagName ? ` · ${event.tagName}` : ""}
                  </div>
                  {event.type === "quota_change" ? (
                    <div>
                      {formatAmount(event.fromQuota ?? 0)} → {formatAmount(event.toQuota ?? 0)}
                    </div>
                  ) : (
                    <div>
                      {event.requestCode ? `${event.requestCode} · ` : ""}
                      {event.requestTitle ?? "Заявка"} · {formatAmount(event.amountWithoutVat ?? 0)} без НДС
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {event.actorName ? `${event.actorName} · ` : ""}
                    {event.actorEmail ?? ""}
                    {event.createdAt ? ` · ${new Date(event.createdAt).toLocaleDateString("ru-RU")}` : ""}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Истории пока нет.</p>
            )}
          </CardContent>
        </Card>
      ) : !rows ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Загрузка...</CardContent>
        </Card>
      ) : (
        rows.map((month) => (
          <Card key={month.monthKey}>
            <CardHeader>
              <CardTitle>{formatMonth(month.year, month.month)}</CardTitle>
              {month.total ? (
                <CardDescription>
                  Общая квота: {formatAmount(month.total.quota)} без НДС · Не распределено:{" "}
                  {formatAmount(month.total.unallocated)} без НДС
                </CardDescription>
              ) : (
                <CardDescription>Квота вашего цеха и распределение по тегам.</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {month.total ? (
                <RowEditor
                  row={{ ...month.total, monthKey: month.monthKey, departmentKey: "__total__" }}
                  label="Общая квота AGIMA"
                  tone="total"
                  canEdit={month.canEdit}
                  onSave={async (row, values) => {
                    await updateQuota({ monthKey: row.monthKey, departmentKey: row.departmentKey, ...values });
                  }}
                />
              ) : null}
              {month.departments.map((department) => (
                <div key={`${month.monthKey}-${department.departmentKey}`} className="space-y-3">
                  <RowEditor
                    row={department}
                    label={department.departmentName ?? department.departmentKey}
                    tone="department"
                    canEdit={month.canEdit}
                    onSave={async (row, values) => {
                      await updateQuota({ monthKey: row.monthKey, departmentKey: row.departmentKey, ...values });
                    }}
                  />
                  <div className="ml-0 space-y-2 border-l border-dashed border-zinc-200 pl-3 md:ml-6">
                    {department.tags.length ? (
                      department.tags.map((tag) => (
                        <RowEditor
                          key={`${month.monthKey}-${department.departmentKey}-${tag.tagName}`}
                          row={tag}
                          label={tag.tagName ?? "Без тега"}
                          tone="tag"
                          canEdit={month.canEdit && tag.tagName !== "Без тега"}
                          onSave={async (row, values) => {
                            await updateQuota({
                              monthKey: row.monthKey,
                              departmentKey: row.departmentKey,
                              tagName: row.tagName,
                              ...values,
                            });
                          }}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-3 text-sm text-muted-foreground">
                        У цеха пока нет тегов или списаний.
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
