"use client";

import Link from "next/link";
import { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convex";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

const FIRST_QUOTA_YEAR = 2025;

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
  groupKey?: string;
  lineKey?: string;
  requestId?: string;
  manualExpenseId?: string;
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
  isManual?: boolean;
  transferredFromMonthKeys?: string[];
  canTransfer?: boolean;
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

type ManualExpenseDraftLine = {
  id: number;
  name: string;
  amount: string;
};

function ManualExpenseForm({
  monthKey,
  tags,
  onCreate,
}: {
  monthKey: string;
  tags: QuotaEditableRow[];
  onCreate: (values: {
    monthKey: string;
    departmentKey: string;
    tagName: string;
    clientName: string;
    counterparties: Array<{ name: string; amount: number }>;
  }) => Promise<void>;
}) {
  const editableTags = tags.filter(
    (tag) => tag.canEdit && tag.tagName && tag.tagName !== "Без тега",
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [clientName, setClientName] = useState("");
  const [counterparties, setCounterparties] = useState<ManualExpenseDraftLine[]>([
    { id: 1, name: "", amount: "" },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagOptions = editableTags.map((tag) => ({
    value: `${tag.departmentKey}\u0000${tag.tagName}`,
    departmentKey: tag.departmentKey,
    tagName: tag.tagName as string,
  }));
  const total = counterparties.reduce(
    (sum, counterparty) => sum + (parseMoneyInput(counterparty.amount) ?? 0),
    0,
  );

  function reset() {
    setSelectedTag("");
    setClientName("");
    setCounterparties([{ id: 1, name: "", amount: "" }]);
    setError(null);
  }

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const selected = tagOptions.find((option) => option.value === selectedTag);
    const lines = counterparties.map((counterparty) => ({
      name: counterparty.name.trim(),
      amount: parseMoneyInput(counterparty.amount),
    }));
    if (!selected) {
      setError("Выберите тег");
      return;
    }
    if (!clientName.trim()) {
      setError("Укажите клиента");
      return;
    }
    if (lines.some((line) => !line.name || line.amount == null || line.amount <= 0)) {
      setError("Укажите контрагента и положительную сумму в каждой строке");
      return;
    }
    setIsSaving(true);
    try {
      await onCreate({
        monthKey,
        departmentKey: selected.departmentKey,
        tagName: selected.tagName,
        clientName: clientName.trim(),
        counterparties: lines.map((line) => ({ name: line.name, amount: line.amount as number })),
      });
      reset();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить затрату");
    } finally {
      setIsSaving(false);
    }
  }

  if (!editableTags.length) {
    return null;
  }

  return (
    <div className="border-t border-zinc-200 pt-4">
      {!isOpen ? (
        <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
          <Plus className="size-4" />
          Добавить затрату вручную
        </Button>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <h3 className="font-semibold">Добавить затрату вручную</h3>
            <p className="text-sm text-muted-foreground">
              Запись появится внутри выбранного тега с пометкой «Добавлено вручную».
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Тег</Label>
              <Select value={selectedTag} onValueChange={setSelectedTag}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Выберите тег" /></SelectTrigger>
                <SelectContent>
                  {tagOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.tagName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`manual-client-${monthKey}`}>Клиент</Label>
              <Input
                id={`manual-client-${monthKey}`}
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="Название клиента"
              />
            </div>
          </div>

          <div className="space-y-2">
            {counterparties.map((counterparty, index) => (
              <div
                key={counterparty.id}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_36px] sm:items-end"
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`manual-counterparty-${monthKey}-${counterparty.id}`}>
                    Контрагент{counterparties.length > 1 ? ` ${index + 1}` : ""}
                  </Label>
                  <Input
                    id={`manual-counterparty-${monthKey}-${counterparty.id}`}
                    value={counterparty.name}
                    onChange={(event) =>
                      setCounterparties((current) =>
                        current.map((item) => item.id === counterparty.id ? { ...item, name: event.target.value } : item),
                      )
                    }
                    placeholder="ФИО или юридическое лицо"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`manual-amount-${monthKey}-${counterparty.id}`}>Сумма затраты</Label>
                  <Input
                    id={`manual-amount-${monthKey}-${counterparty.id}`}
                    inputMode="decimal"
                    value={counterparty.amount}
                    onChange={(event) =>
                      setCounterparties((current) =>
                        current.map((item) => item.id === counterparty.id
                          ? { ...item, amount: sanitizeNumericInput(event.target.value) }
                          : item),
                      )
                    }
                    placeholder="0"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Удалить контрагента"
                  disabled={counterparties.length === 1}
                  onClick={() =>
                    setCounterparties((current) => current.filter((item) => item.id !== counterparty.id))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setCounterparties((current) => [
                  ...current,
                  { id: Math.max(...current.map((item) => item.id)) + 1, name: "", amount: "" },
                ])
              }
            >
              <Plus className="size-4" />
              Добавить контрагента
            </Button>
          </div>

          <div className="text-sm">
            Итого: <span className="font-semibold">{formatAmount(total)}</span> без НДС
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Сохраняем..." : "Сохранить затрату"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => {
                reset();
                setIsOpen(false);
              }}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function nextMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function TransferExpenseDialog({
  entries,
  onClose,
  onTransfer,
}: {
  entries: QuotaEntryRow[] | null;
  onClose: () => void;
  onTransfer: (entry: QuotaEntryRow, targetMonthKey: string, amount: number) => Promise<void>;
}) {
  const transferableEntries = (entries ?? []).filter(
    (entry) => entry.canTransfer && entry.lineKey && entry.amount > 0,
  );
  const [lineKey, setLineKey] = useState("");
  const [targetMonthKey, setTargetMonthKey] = useState("");
  const [movedAmount, setMovedAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedEntry = transferableEntries.find((entry) => entry.lineKey === lineKey) ?? transferableEntries[0];
  const available = selectedEntry?.amount ?? 0;
  const parsedMoved = parseMoneyInput(movedAmount);
  const remaining = parsedMoved == null ? null : Math.max(available - parsedMoved, 0);

  useEffect(() => {
    const first = transferableEntries[0];
    setLineKey(first?.lineKey ?? "");
    setTargetMonthKey(first ? nextMonthKey(first.monthKey) : "");
    setMovedAmount("");
    setError(null);
  }, [entries]);

  useEffect(() => {
    if (selectedEntry && targetMonthKey === selectedEntry.monthKey) {
      setTargetMonthKey(nextMonthKey(selectedEntry.monthKey));
    }
    setMovedAmount("");
  }, [lineKey]);

  async function saveTransfer() {
    if (!selectedEntry || !targetMonthKey) {
      setError("Выберите контрагента и месяц");
      return;
    }
    if (targetMonthKey === selectedEntry.monthKey) {
      setError("Месяц назначения должен отличаться от исходного");
      return;
    }
    if (parsedMoved == null || parsedMoved <= 0 || parsedMoved > available) {
      setError(`Укажите сумму от 0 до ${formatAmount(available)}`);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onTransfer(selectedEntry, targetMonthKey, parsedMoved);
      onClose();
    } catch (err) {
      setError(getDisplayErrorMessage(err, "Не удалось перенести затрату"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AlertDialog open={Boolean(entries)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Вынести часть затрат в другой месяц</AlertDialogTitle>
          <AlertDialogDescription>
            Сумма контрагента будет разделена между месяцами без изменения общей суммы.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {selectedEntry ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Контрагент</Label>
              <Select value={selectedEntry.lineKey} onValueChange={setLineKey}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {transferableEntries.map((entry) => (
                    <SelectItem key={entry.lineKey} value={entry.lineKey as string}>
                      {entry.counterparty || "Контрагент не указан"} · {formatAmount(entry.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quota-transfer-source">Исходный месяц</Label>
                <Input id="quota-transfer-source" value={formatEventMonth(selectedEntry.monthKey)} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quota-transfer-target">Перенести в месяц</Label>
                <Input
                  id="quota-transfer-target"
                  type="month"
                  min={`${FIRST_QUOTA_YEAR}-01`}
                  value={targetMonthKey}
                  onChange={(event) => setTargetMonthKey(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quota-transfer-remaining">
                  Останется в {formatEventMonth(selectedEntry.monthKey)}
                </Label>
                <Input
                  id="quota-transfer-remaining"
                  inputMode="decimal"
                  value={remaining == null ? "" : String(remaining)}
                  onChange={(event) => {
                    const nextRemaining = parseMoneyInput(sanitizeNumericInput(event.target.value));
                    setMovedAmount(nextRemaining == null ? "" : String(Math.max(available - nextRemaining, 0)));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quota-transfer-amount">
                  Переносим в {targetMonthKey ? formatEventMonth(targetMonthKey) : "другой месяц"}
                </Label>
                <Input
                  id="quota-transfer-amount"
                  inputMode="decimal"
                  value={movedAmount}
                  onChange={(event) => setMovedAmount(sanitizeNumericInput(event.target.value))}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
              Общая сумма контрагента в выбранной части: {formatAmount(available)} без НДС
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Нет доступных затрат для переноса.</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>Отмена</AlertDialogCancel>
          <Button type="button" disabled={isSaving || !selectedEntry} onClick={saveTransfer}>
            {isSaving ? "Переносим..." : "Перенести затрату"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MonthQuotaWorkspace({
  month,
  departments,
  onSaveQuota,
  onSaveEntry,
  onCreateManualExpense,
  onTransfer,
}: {
  month: {
    monthKey: string;
    quotaEntries?: QuotaEntryRow[];
    welcomeBonus?: { amountWithoutVat: number };
  };
  departments: Array<QuotaEditableRow & { departmentName?: string; tags: QuotaEditableRow[] }>;
  onSaveQuota: (row: QuotaEditableRow, values: { quota: number; quotaWithVat: number; vatRate: number }) => Promise<void>;
  onSaveEntry: (entry: QuotaEntryRow, patch: Partial<Pick<QuotaEntryRow, "counterparty" | "workStatus" | "result" | "comment">>) => Promise<void>;
  onCreateManualExpense: (values: {
    monthKey: string;
    departmentKey: string;
    tagName: string;
    clientName: string;
    counterparties: Array<{ name: string; amount: number }>;
  }) => Promise<void>;
  onTransfer: (entry: QuotaEntryRow, targetMonthKey: string, amount: number) => Promise<void>;
}) {
  const tags = departments.flatMap((department) => department.tags);
  const monthEntries = month.quotaEntries ?? tags.flatMap((tag) => tag.entries ?? []);
  const monthQuota = tags.reduce((sum, tag) => sum + (tag.quota ?? 0), 0);
  const monthRemaining = tags.reduce((sum, tag) => sum + (tag.remaining ?? 0), 0);
  const monthEntryTotal = monthEntries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const [transferEntries, setTransferEntries] = useState<QuotaEntryRow[] | null>(null);

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
              const groupKey = entry.groupKey ?? entry.requestId ?? entry.key;
              const group = groups.get(groupKey) ?? [];
              group.push(entry);
              groups.set(groupKey, group);
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
                                  {entry.isManual ? (
                                    <Badge variant="outline" className="mt-0.5 font-normal text-muted-foreground">
                                      Добавлено вручную
                                    </Badge>
                                  ) : (
                                    <Link
                                      href={`/requests/${entry.requestId}`}
                                      className="mt-0.5 block truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                      title={`${entry.assignmentTitle || entry.requestTitle || "Без названия"}${entry.requestCode ? ` · ${entry.requestCode}` : ""}`}
                                    >
                                      {entry.assignmentTitle || entry.requestTitle || "Без названия"}
                                      {entry.requestCode ? ` · ${entry.requestCode}` : ""}
                                    </Link>
                                  )}
                                </div>
                                {entry.isWelcomeBonus ? (
                                  <Badge variant="secondary" className="shrink-0 bg-amber-100 text-amber-900">
                                    Welcome-бонус
                                  </Badge>
                                ) : null}
                                {entryIndex === 0 && requestEntries.some((requestEntry) => requestEntry.canTransfer) ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1 h-7 px-2 text-xs"
                                    onClick={() => setTransferEntries(requestEntries)}
                                  >
                                    <ArrowRightLeft className="size-3.5" />
                                    Вынести часть затрат
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground xl:hidden">Контрагент</div>
                            <div className="truncate text-sm font-medium" title={entry.counterparty || "Не указан в заявке"}>
                              {entry.counterparty || "Не указан в заявке"}
                            </div>
                            {entry.transferredFromMonthKeys?.length ? (
                              <Badge variant="outline" className="mt-1 font-normal text-muted-foreground">
                                Перенесено из {entry.transferredFromMonthKeys.map(formatEventMonth).join(", ")}
                              </Badge>
                            ) : null}
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
      <ManualExpenseForm monthKey={month.monthKey} tags={tags} onCreate={onCreateManualExpense} />
      <TransferExpenseDialog
        entries={transferEntries}
        onClose={() => setTransferEntries(null)}
        onTransfer={onTransfer}
      />
    </div>
  );
}

export default function AdministrationQuotaClient() {
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [yearWindowStart, setYearWindowStart] = useState(currentYear);
  const [departmentFilter, setDepartmentFilter] = useState("Аккаунтинг");
  const [tagFilter, setTagFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"quotas" | "history">("quotas");
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const monthKeys = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) =>
      `${selectedYear}-${String(index + 1).padStart(2, "0")}`,
    );
  }, [selectedYear]);
  const availableYears = Array.from({ length: 3 }, (_, index) => yearWindowStart + index);
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
  const createManualExpense = useMutation(api.quotas.createAdministrationManualExpense);
  const updateManualExpense = useMutation(api.quotas.updateAdministrationManualExpense);
  const createQuotaTransfer = useMutation(api.quotas.createAdministrationQuotaTransfer);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y py-3">
        <div className="flex gap-2">
          <Button type="button" variant={activeTab === "quotas" ? "default" : "outline"} onClick={() => setActiveTab("quotas")}>
            Квоты
          </Button>
          <Button type="button" variant={activeTab === "history" ? "default" : "outline"} onClick={() => setActiveTab("history")}>
            История изменений
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Цех</Label>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Все цеха" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все цеха</SelectItem>
              {HOD_DEPARTMENTS.map((department) => (
                <SelectItem key={department} value={department}>{department}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Label className="shrink-0">Тег</Label>
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[220px] max-w-[60vw]">
              <SelectValue placeholder="Все теги" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все теги</SelectItem>
              <SelectItem value="none">Без тега</SelectItem>
              {(tags ?? []).map((tag) => (
                <SelectItem key={tag._id} value={tag.name}>{tag.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          const monthExpanded = expandedMonths[month.monthKey] ?? month.monthKey === currentMonthKey;
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
            <Card
              key={month.monthKey}
              className={`overflow-hidden ${month.monthKey === currentMonthKey && !monthExpanded ? "border-amber-300 bg-amber-50/70" : ""}`}
            >
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
                      if (entry.isManual && entry.manualExpenseId) {
                        await updateManualExpense({
                          id: entry.manualExpenseId as any,
                          workStatus: patch.workStatus ?? entry.workStatus,
                          result: patch.result ?? entry.result,
                          comment: patch.comment ?? entry.comment,
                        });
                        return;
                      }
                      if (!entry.requestId) {
                        throw new Error("Заявка для строки квоты не найдена");
                      }
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
                    onCreateManualExpense={async (values) => {
                      await createManualExpense(values);
                    }}
                    onTransfer={async (entry, targetMonthKey, amount) => {
                      if (!entry.lineKey) {
                        throw new Error("Контрагент для переноса не найден");
                      }
                      await createQuotaTransfer({
                        sourceType: entry.isManual ? "manual" : "request",
                        requestId: entry.requestId as any,
                        manualExpenseId: entry.manualExpenseId as any,
                        lineKey: entry.lineKey,
                        sourceMonthKey: entry.monthKey,
                        targetMonthKey,
                        amount,
                      });
                      const targetYear = Number(targetMonthKey.slice(0, 4));
                      setSelectedYear(targetYear);
                      setYearWindowStart((start) =>
                        targetYear < start ? targetYear : targetYear > start + 2 ? targetYear - 2 : start,
                      );
                      setExpandedMonths((current) => ({ ...current, [targetMonthKey]: true }));
                    }}
                  />
                </CardContent>
              ) : null}
            </Card>
          );
        })
      )}
      <div className="flex items-center justify-center gap-1" aria-label="Выбор года">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Предыдущий год"
          disabled={selectedYear <= FIRST_QUOTA_YEAR}
          onClick={() => {
            const year = Math.max(FIRST_QUOTA_YEAR, selectedYear - 1);
            setSelectedYear(year);
            setYearWindowStart((start) => year < start ? year : start);
          }}
        >
          <ChevronLeft className="size-4" />
        </Button>
        {availableYears.map((year) => (
          <Button
            key={year}
            type="button"
            variant={selectedYear === year ? "default" : "ghost"}
            className="min-w-16"
            onClick={() => setSelectedYear(year)}
          >
            {year}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Следующий год"
          onClick={() => {
            const year = selectedYear + 1;
            setSelectedYear(year);
            setYearWindowStart((start) => year > start + 2 ? year - 2 : start);
          }}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
