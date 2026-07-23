"use client";

import Link from "next/link";
import { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/convex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HOD_DEPARTMENTS } from "@/lib/constants";
import {
  formatAmount,
  parseMoneyInput,
  sanitizeNumericInput,
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
  manualSpent?: number;
  manualSpentWithVat?: number;
  spent: number;
  spentWithVat?: number;
  remaining: number;
  remainingWithVat?: number;
  distributed?: number;
  unallocated?: number;
  issues?: string[];
  entries?: QuotaEntryRow[];
  canEdit?: boolean;
  canEditManualSpent?: boolean;
};

type QuotaEntryRow = {
  key: string;
  lineKey?: string;
  requestId: string;
  monthKey: string;
  departmentKey: string;
  tagName?: string;
  requestCode?: string;
  requestTitle?: string;
  clientName?: string;
  assignmentTitle?: string;
  counterparty?: string;
  amount: number;
  amountWithVat?: number;
  comment?: string;
  workStatus?: string;
  result?: string;
  isFirstForRequest?: boolean;
  requestRowSpan?: number;
  isWelcomeBonus?: boolean;
  canEditEntry?: boolean;
};

type QuotaSheetRow = {
  key: string;
  monthKey: string;
  departmentKey: string;
  tagName: string;
  isFirstForTag: boolean;
  tagRowSpan: number;
  quota: number;
  remaining: number;
  manualSpent?: number;
  canEdit?: boolean;
  vatRate?: number;
  entry?: QuotaEntryRow;
};

type HistoryEvent = {
  key: string;
  type: "quota_change" | "manual_spent_change" | "request_usage";
  monthKey: string;
  level?: "total" | "department" | "tag";
  departmentKey?: string;
  tagName?: string;
  fromQuota?: number;
  toQuota?: number;
  fromManualSpent?: number;
  toManualSpent?: number;
  fromManualSpentWithVat?: number;
  toManualSpentWithVat?: number;
  amountWithoutVat?: number;
  amountWithVat?: number;
  actorEmail?: string;
  actorName?: string;
  requestCode?: string;
  requestTitle?: string;
  createdAt: number;
};

const WORK_STATUS_OPTIONS = [
  { value: "unset", label: "Не заполнено" },
  { value: "not_started", label: "Очередь" },
  { value: "in_progress", label: "В работе" },
  { value: "done", label: "Готово" },
  { value: "canceled", label: "Отменено" },
];

const RESULT_OPTIONS = [
  { value: "unset", label: "Не заполнено" },
  { value: "won", label: "Победа" },
  { value: "lost", label: "Поражение" },
  { value: "canceled", label: "Отмена" },
];

function workStatusColor(value?: string) {
  switch (value) {
    case "in_progress":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "canceled":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "not_started":
      return "border-sky-200 bg-sky-50 text-sky-900";
    default:
      return "border-zinc-200 bg-white text-zinc-700";
  }
}

function resultColor(value?: string) {
  switch (value) {
    case "won":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "lost":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "canceled":
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
    default:
      return "border-zinc-200 bg-white text-zinc-700";
  }
}

function formatMonth(year: number, month: number) {
  const monthName = MONTH_NAMES[month - 1] ?? "";
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

function formatEventMonth(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const monthName = MONTH_NAMES[Number(month) - 1] ?? month;
  return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
}

function getDisplayErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const matched = error.message.match(
    /Error:\s*([\s\S]*?)(?:\s+at\s+[^(]+\s+\(\.\.\/convex\/|\s+Called by client|$)/,
  );
  if (matched?.[1]?.trim()) {
    return matched[1].trim();
  }
  return error.message.trim() || fallback;
}

function RowEditor({
  row,
  canEdit,
  label,
  tone = "plain",
  expandable = false,
  expanded = false,
  onToggleExpand,
  onSave,
  onSaveManualSpent,
}: {
  row: QuotaEditableRow;
  canEdit: boolean;
  label: string;
  tone?: "total" | "department" | "tag" | "plain";
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onSave: (row: QuotaEditableRow, values: { quota: number; quotaWithVat: number; vatRate: number }) => Promise<void>;
  onSaveManualSpent?: (row: QuotaEditableRow, values: { manualSpent: number; manualSpentWithVat: number }) => Promise<void>;
}) {
  const [quota, setQuota] = useState(String(row.quota ?? 0));
  const [manualSpent, setManualSpent] = useState(String(row.manualSpent ?? 0));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const vatRate = row.vatRate ?? 0;

  useEffect(() => {
    setQuota(String(row.quota ?? 0));
    setManualSpent(String(row.manualSpent ?? 0));
  }, [row.manualSpent, row.quota]);

  async function saveIfChanged() {
    if (!canEdit || saving) {
      return;
    }
    setSaveError(null);
    const nextQuota = parseMoneyInput(quota);
    if (nextQuota === undefined) {
      return;
    }
    if (nextQuota === row.quota) {
      return;
    }
    setSaving(true);
    try {
      await onSave(row, {
        quota: nextQuota,
        quotaWithVat: nextQuota,
        vatRate,
      });
    } catch (err) {
      setSaveError(getDisplayErrorMessage(err, "Не удалось сохранить квоту"));
    } finally {
      setSaving(false);
    }
  }

  async function saveManualSpentIfChanged() {
    if (!row.canEditManualSpent || saving || !onSaveManualSpent) {
      return;
    }
    setSaveError(null);
    const nextManualSpent = parseMoneyInput(manualSpent) ?? 0;
    const nextManualSpentWithVat = nextManualSpent;
    if (
      nextManualSpent === (row.manualSpent ?? 0) &&
      nextManualSpentWithVat === (row.manualSpentWithVat ?? nextManualSpent)
    ) {
      return;
    }
    setSaving(true);
    try {
      await onSaveManualSpent(row, {
        manualSpent: nextManualSpent,
        manualSpentWithVat: nextManualSpentWithVat,
      });
    } catch (err) {
      setSaveError(getDisplayErrorMessage(err, "Не удалось сохранить ручное списание"));
    } finally {
      setSaving(false);
    }
  }

  const hasIssues = Boolean(row.issues?.length || saveError);

  const wrapperClass =
    tone === "total"
      ? "rounded-2xl border-2 border-emerald-400 bg-emerald-50/60 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.08)]"
      : tone === "department"
        ? "rounded-2xl border border-zinc-200 bg-white p-4"
        : "rounded-xl border border-zinc-100 bg-zinc-50/80 p-3";
  const stopToggle = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className={`${wrapperClass} ${hasIssues ? "border-destructive bg-destructive/5" : ""} ${expandable ? "cursor-pointer transition-colors hover:border-zinc-300" : ""}`}
      onClick={() => onToggleExpand?.()}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.85fr)] md:items-end">
        <div>
          <div className="flex items-start gap-2">
            {expandable ? (
              <span className="mt-0.5 text-muted-foreground">
                {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </span>
            ) : null}
            <div>
              <div className={tone === "total" ? "text-lg font-semibold" : "font-medium"}>{label}</div>
              <div className="text-xs text-muted-foreground">Все суммы без НДС</div>
            </div>
          </div>
        </div>
        <div className="space-y-1" onClick={stopToggle}>
          <Label>Квота</Label>
          <Input
            value={quota}
            inputMode="decimal"
            disabled={!canEdit}
            onBlur={saveIfChanged}
            onChange={(event) => setQuota(sanitizeNumericInput(event.target.value))}
          />
        </div>
        <div onClick={stopToggle}>
          <div className="text-xs text-muted-foreground">Сумма затрат</div>
          <div>{formatAmount(row.spent)}</div>
        </div>
        <div onClick={stopToggle}>
          <div className="text-xs text-muted-foreground">Остаток</div>
          <div>{formatAmount(row.remaining)}</div>
          {saving ? <div className="text-xs text-emerald-700">Сохраняю...</div> : null}
        </div>
      </div>
      {row.canEditManualSpent ? (
        <div className="mt-3 max-w-xs space-y-1" onClick={stopToggle}>
          <Label>Сумма затрат без заявок</Label>
          <Input
            value={manualSpent}
            inputMode="decimal"
            onBlur={saveManualSpentIfChanged}
            onChange={(event) => setManualSpent(sanitizeNumericInput(event.target.value))}
          />
        </div>
      ) : null}
      {row.unallocated !== undefined ? (
        <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-muted-foreground">
          Не распределено: {formatAmount(row.unallocated)} без НДС
        </div>
      ) : null}
      {row.issues?.length || saveError ? (
        <div className="mt-3 space-y-1 text-sm text-destructive">
          {row.issues?.map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
          {saveError ? <div>{saveError}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function EditableEntryText({
  value,
  disabled,
  placeholder,
  multiline = false,
  onSave,
}: {
  value?: string;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setLocalValue(value ?? "");
  }, [value]);

  async function saveIfChanged() {
    if (disabled || saving || localValue === (value ?? "")) {
      return;
    }
    setSaving(true);
    try {
      await onSave(localValue);
    } finally {
      setSaving(false);
    }
  }

  if (multiline) {
    return (
      <Textarea
        value={localValue}
        disabled={disabled}
        placeholder={placeholder}
        className={`${focused ? "min-h-20" : "h-8 min-h-8 overflow-hidden"} resize-none bg-white py-1 transition-[min-height]`}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void saveIfChanged();
        }}
        onChange={(event) => setLocalValue(event.target.value)}
      />
    );
  }

  return (
    <Input
      value={localValue}
      disabled={disabled}
      placeholder={placeholder}
      className="h-9 bg-white"
      onBlur={saveIfChanged}
      onChange={(event) => setLocalValue(event.target.value)}
    />
  );
}

function QuotaEntriesTable({
  entries,
  onSaveEntry,
}: {
  entries: QuotaEntryRow[];
  onSaveEntry: (row: QuotaEntryRow, patch: Partial<Pick<QuotaEntryRow, "counterparty" | "workStatus" | "result" | "comment">>) => Promise<void>;
}) {
  if (!entries.length) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-4 py-3 text-sm text-muted-foreground">
        По этому тегу пока нет согласованных заявок.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white">
      <table className="min-w-[1120px] w-full border-collapse text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="w-[120px] border-b border-r px-3 py-2">Заявка</th>
            <th className="w-[170px] border-b border-r px-3 py-2">Клиент</th>
            <th className="w-[230px] border-b border-r px-3 py-2">Назначение</th>
            <th className="w-[190px] border-b border-r px-3 py-2">Контрагент</th>
            <th className="w-[130px] border-b border-r px-3 py-2 text-right">Сумма</th>
            <th className="w-[230px] border-b border-r px-3 py-2">Комментарий</th>
            <th className="w-[150px] border-b border-r px-3 py-2">Статус</th>
            <th className="w-[150px] border-b px-3 py-2">Результат</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const disabled = !entry.canEditEntry;
            return (
              <tr key={entry.key} className={entry.isWelcomeBonus ? "bg-amber-50/60" : "bg-white"}>
                <td className="border-r border-t px-3 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{entry.requestCode ?? "Заявка"}</span>
                    {entry.isWelcomeBonus ? (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                        Welcome-бонус
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="border-r border-t px-3 py-2 align-top">{entry.clientName || "—"}</td>
                <td className="border-r border-t px-3 py-2 align-top">
                  <div className="line-clamp-3">{entry.assignmentTitle || entry.requestTitle || "—"}</div>
                </td>
                <td className="border-r border-t p-0 align-top">
                  <EditableEntryText
                    value={entry.counterparty}
                    disabled={disabled}
                    placeholder="Контрагент"
                    onSave={(value) => onSaveEntry(entry, { counterparty: value })}
                  />
                </td>
                <td className="border-r border-t px-3 py-2 text-right align-top font-medium">
                  {formatAmount(entry.amount)}
                </td>
                <td className="border-r border-t p-0 align-top">
                  <EditableEntryText
                    value={entry.comment}
                    disabled={disabled}
                    placeholder="Комментарий"
                    multiline
                    onSave={(value) => onSaveEntry(entry, { comment: value })}
                  />
                </td>
                <td className="border-r border-t px-2 py-1 align-top">
                  <Select
                    value={entry.workStatus || "not_started"}
                    disabled={disabled}
                    onValueChange={(value) => onSaveEntry(entry, { workStatus: value })}
                  >
                    <SelectTrigger size="sm" className="w-full border-0 bg-transparent shadow-none focus:ring-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="border-t px-2 py-1 align-top">
                  <Select
                    value={entry.result || "unknown"}
                    disabled={disabled}
                    onValueChange={(value) => onSaveEntry(entry, { result: value })}
                  >
                    <SelectTrigger size="sm" className="w-full border-0 bg-transparent shadow-none focus:ring-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SheetMoneyInput({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled?: boolean;
  onSave: (value: number) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(String(value ?? 0));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLocalValue(String(value ?? 0));
  }, [value]);

  async function saveIfChanged() {
    if (disabled || saving) {
      return;
    }
    const nextValue = parseMoneyInput(localValue) ?? 0;
    if (nextValue === value) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nextValue);
    } catch (error) {
      setSaveError(getDisplayErrorMessage(error, "Не удалось сохранить квоту"));
      setLocalValue(String(value ?? 0));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Input
        value={localValue}
        inputMode="decimal"
        disabled={disabled || saving}
        className="h-9 bg-white text-right font-medium"
        onBlur={saveIfChanged}
        onChange={(event) => setLocalValue(sanitizeNumericInput(event.target.value))}
      />
      {saveError ? <div className="mt-1 text-xs text-destructive">{saveError}</div> : null}
    </div>
  );
}

function MonthQuotaWorkspace({
  month,
  departments,
  onSaveQuota,
  onSaveEntry,
}: {
  month: {
    monthKey: string;
    quotaEntries?: QuotaEntryRow[];
    welcomeBonus?: { amountWithoutVat: number };
  };
  departments: Array<QuotaEditableRow & { departmentName?: string; tags: QuotaEditableRow[] }>;
  onSaveQuota: (row: QuotaEditableRow, values: { quota: number; quotaWithVat: number; vatRate: number }) => Promise<void>;
  onSaveEntry: (entry: QuotaEntryRow, patch: Partial<Pick<QuotaEntryRow, "counterparty" | "workStatus" | "result" | "comment">>) => Promise<void>;
}) {
  const tags = departments.flatMap((department) => department.tags);
  const monthEntries = month.quotaEntries ?? tags.flatMap((tag) => tag.entries ?? []);
  const monthQuota = tags.reduce((sum, tag) => sum + (tag.quota ?? 0), 0);
  const monthRemaining = tags.reduce((sum, tag) => sum + (tag.remaining ?? 0), 0);
  const monthEntryTotal = monthEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-muted-foreground">Квота месяца</div>
          <div className="mt-1 text-lg font-semibold">{formatAmount(monthQuota)}</div>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-muted-foreground">Сумма затрат</div>
          <div className="mt-1 text-lg font-semibold">{formatAmount(monthEntryTotal)}</div>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-muted-foreground">Остаток квоты</div>
          <div className="mt-1 text-lg font-semibold">{formatAmount(monthRemaining)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {tags.map((tag) => {
          const tagName = tag.tagName ?? "Без тега";
          const entries = monthEntries.filter(
            (entry) => entry.departmentKey === tag.departmentKey && (entry.tagName ?? "Без тега") === tagName,
          );
          const requestGroups = Array.from(
            entries.reduce((groups, entry) => {
              const group = groups.get(entry.requestId) ?? [];
              group.push(entry);
              groups.set(entry.requestId, group);
              return groups;
            }, new Map<string, QuotaEntryRow[]>()),
          );

          return (
            <section key={`${tag.departmentKey}:${tagName}`} className="overflow-hidden rounded-md border border-zinc-300 bg-white">
              <div className="grid gap-3 bg-zinc-50 px-4 py-2.5 lg:grid-cols-[minmax(220px,360px)_660px] lg:items-center lg:gap-5">
                <div className="flex min-h-9 min-w-0 items-center">
                  <h3 className="font-semibold">{tagName}</h3>
                </div>
                <div className="grid grid-cols-3 gap-5">
                  <div className="flex min-h-9 items-center gap-2">
                    <Label className="shrink-0 text-xs text-muted-foreground">Квота</Label>
                    <div className="w-[110px]">
                      <SheetMoneyInput
                        value={tag.quota ?? 0}
                        disabled={!tag.canEdit || tagName === "Без тега"}
                        onSave={(quota) =>
                          onSaveQuota(tag, {
                            quota,
                            quotaWithVat: quota,
                            vatRate: tag.vatRate ?? 0,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex min-h-9 items-center gap-2">
                    <div className="shrink-0 text-xs text-muted-foreground">Сумма затрат</div>
                    <div className="font-medium">{formatAmount(tag.spent)}</div>
                  </div>
                  <div className="flex min-h-9 items-center gap-2">
                    <div className="shrink-0 text-xs text-muted-foreground">Остаток</div>
                    <div className="font-medium">{formatAmount(tag.remaining)}</div>
                  </div>
                </div>
              </div>

              {requestGroups.length ? (
                <div>
                  <div className="hidden h-7 grid-cols-[minmax(360px,1.3fr)_minmax(220px,.85fr)_110px_180px_190px_minmax(180px,.7fr)] items-center gap-3 border-t border-zinc-200 bg-zinc-50/70 px-4 text-xs leading-none text-muted-foreground xl:grid">
                    <div>Клиент и заявка</div>
                    <div>Контрагент</div>
                    <div className="text-right">Сумма</div>
                    <div>Статус</div>
                    <div>Результат</div>
                    <div>Комментарий</div>
                  </div>
                  <div className="divide-y divide-zinc-300">
                    {requestGroups.map(([requestId, requestEntries]) => (
                      <div key={requestId}>
                        {requestEntries.map((entry, entryIndex) => (
                        <div
                          key={entry.key}
                          className={`grid gap-2 px-4 py-1.5 md:grid-cols-2 xl:grid-cols-[minmax(360px,1.3fr)_minmax(220px,.85fr)_110px_180px_190px_minmax(180px,.7fr)] xl:items-center xl:gap-3 ${entry.isWelcomeBonus ? "bg-amber-50/60" : ""}`}
                        >
                          <div className="min-w-0 md:col-span-2 xl:col-span-1">
                            {entryIndex === 0 ? (
                              <div className="min-w-0">
                                <div className="text-xs text-muted-foreground xl:hidden">Клиент и заявка</div>
                                <div className="min-w-0 text-sm">
                                  <div className="truncate font-semibold" title={entry.clientName || "Клиент не указан"}>
                                    {entry.clientName || "Клиент не указан"}
                                  </div>
                                  <Link
                                    href={`/requests/${entry.requestId}`}
                                    className="mt-0.5 block truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                    title={`${entry.assignmentTitle || entry.requestTitle || "Без названия"}${entry.requestCode ? ` · ${entry.requestCode}` : ""}`}
                                  >
                                    {entry.assignmentTitle || entry.requestTitle || "Без названия"}
                                    {entry.requestCode ? ` · ${entry.requestCode}` : ""}
                                  </Link>
                                </div>
                                {entry.isWelcomeBonus ? (
                                  <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-900">
                                    Welcome-бонус
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground xl:hidden">Контрагент</div>
                            <div className="truncate text-sm font-medium" title={entry.counterparty || "Не указан в заявке"}>
                              {entry.counterparty || "Не указан в заявке"}
                            </div>
                          </div>

                          <div className="md:text-right">
                            <div className="text-xs text-muted-foreground xl:hidden">Сумма</div>
                            <div className="whitespace-nowrap text-sm font-semibold">{formatAmount(entry.amount)}</div>
                          </div>

                          <div className="space-y-0.5">
                            <Label className="text-xs text-muted-foreground xl:sr-only">Статус</Label>
                            <Select
                              value={entry.workStatus || "unset"}
                              disabled={!entry.canEditEntry}
                              onValueChange={(value) => onSaveEntry(entry, { workStatus: value === "unset" ? "" : value })}
                            >
                              <SelectTrigger size="sm" className={`w-full ${workStatusColor(entry.workStatus)}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {WORK_STATUS_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value} className={workStatusColor(option.value)}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-0.5">
                            <Label className="text-xs text-muted-foreground xl:sr-only">Результат</Label>
                            <Select
                              value={entry.result || "unset"}
                              disabled={!entry.canEditEntry}
                              onValueChange={(value) => onSaveEntry(entry, { result: value === "unset" ? "" : value })}
                            >
                              <SelectTrigger size="sm" className={`w-full ${resultColor(entry.result)}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RESULT_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value} className={resultColor(option.value)}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-0.5 md:col-span-2 xl:col-span-1">
                            <Label className="text-xs text-muted-foreground xl:sr-only">Комментарий</Label>
                            <EditableEntryText
                              value={entry.comment}
                              disabled={!entry.canEditEntry}
                              placeholder="Комментарий"
                              multiline
                              onSave={(value) => onSaveEntry(entry, { comment: value })}
                            />
                          </div>
                        </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function AdministrationQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(6);
  const [departmentFilter, setDepartmentFilter] = useState("Аккаунтинг");
  const [tagFilter, setTagFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"quotas" | "history">("quotas");
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
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
  const updateEntry = useMutation(api.quotas.updateAdministrationQuotaEntry);

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
                    {event.type === "quota_change"
                      ? "Изменение квоты"
                      : event.type === "manual_spent_change"
                        ? "Ручное списание"
                        : "Списание по заявке"}
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
                  ) : event.type === "manual_spent_change" ? (
                    <div>
                      {formatAmount(event.fromManualSpent ?? 0)} → {formatAmount(event.toManualSpent ?? 0)}
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
        rows.map((month) => {
          const monthExpanded = expandedMonths[month.monthKey] ?? month.monthKey === monthKeys[0];
          const tagQuotaTotal = month.departments.reduce(
            (sum: number, department: { tags: QuotaEditableRow[] }) =>
              sum + department.tags.reduce((tagSum: number, tag: QuotaEditableRow) => tagSum + (tag.quota ?? 0), 0),
            0,
          );
          const tagRemainingTotal = month.departments.reduce(
            (sum: number, department: { tags: QuotaEditableRow[] }) =>
              sum + department.tags.reduce((tagSum: number, tag: QuotaEditableRow) => tagSum + (tag.remaining ?? 0), 0),
            0,
          );
          return (
            <Card key={month.monthKey}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      className="flex items-start gap-2 text-left"
                      onClick={() =>
                        setExpandedMonths((current) => ({
                          ...current,
                          [month.monthKey]: !monthExpanded,
                        }))
                      }
                    >
                      <span className="mt-1 text-muted-foreground">
                        {monthExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </span>
                      <div>
                        <CardTitle>{formatMonth(month.year, month.month)}</CardTitle>
                        <CardDescription>
                          Общая квота месяца: {formatAmount(tagQuotaTotal)} без НДС · Общий остаток:{" "}
                          {formatAmount(tagRemainingTotal)} без НДС
                        </CardDescription>
                      </div>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link href={`/requests?view=all&month=${month.monthKey}`}>
                        Перейти к заявкам месяца
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {monthExpanded ? (
                <CardContent className="space-y-4">
                  <MonthQuotaWorkspace
                    month={month}
                    departments={month.departments}
                    onSaveQuota={async (row, values) => {
                      await updateQuota({
                        monthKey: row.monthKey,
                        departmentKey: row.departmentKey,
                        tagName: row.tagName,
                        ...values,
                      });
                    }}
                    onSaveEntry={async (entry, patch) => {
                      await updateEntry({
                        requestId: entry.requestId as any,
                        lineKey: entry.lineKey,
                        monthKey: entry.monthKey,
                        departmentKey: entry.departmentKey,
                        tagName: entry.tagName,
                        counterparty: patch.counterparty ?? entry.counterparty,
                        workStatus: patch.workStatus ?? entry.workStatus,
                        result: patch.result ?? entry.result,
                        comment: patch.comment ?? entry.comment,
                      });
                    }}
                  />
                </CardContent>
              ) : null}
            </Card>
          );
        })
      )}
      <Button type="button" variant="outline" onClick={() => setMonthsCount((count) => count + 6)}>
        Показать еще 6 месяцев
      </Button>
    </div>
  );
}
