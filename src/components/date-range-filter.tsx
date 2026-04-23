"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CalendarDays, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type DateRangeFilterValue = {
  from: string;
  to: string;
  monthKey: string;
};

type DateRangeFilterProps = {
  value: DateRangeFilterValue;
  onChange: (value: DateRangeFilterValue) => void;
  placeholder?: string;
  className?: string;
};

type PickerMode = "range" | "month";

function parseDateInput(value?: string) {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(value: string) {
  const date = parseDateInput(value);
  if (!date) {
    return "";
  }
  return date.toLocaleDateString("ru-RU");
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) {
    return "";
  }
  return `${MONTH_NAMES[month - 1] ?? monthKey} ${year}`;
}

function buildMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) {
    return { from: "", to: "" };
  }
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    from: formatDateInput(start),
    to: formatDateInput(end),
  };
}

function getCalendarDays(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const weekdayIndex = (monthStart.getDay() + 6) % 7;
  const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1 - weekdayIndex);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function isSameDay(left: string, right: string) {
  return Boolean(left && right && left === right);
}

function isWithinRange(day: string, start: string, end: string) {
  return Boolean(start && end && day >= start && day <= end);
}

function getTriggerLabel(value: DateRangeFilterValue, placeholder: string) {
  if (value.monthKey) {
    return formatMonthLabel(value.monthKey);
  }
  if (value.from && value.to) {
    return value.from === value.to
      ? formatDateLabel(value.from)
      : `${formatDateLabel(value.from)} - ${formatDateLabel(value.to)}`;
  }
  if (value.from) {
    return formatDateLabel(value.from);
  }
  return placeholder;
}

export default function DateRangeFilter({
  value,
  onChange,
  placeholder = "Дата создания",
  className,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>("range");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftMonthKey, setDraftMonthKey] = useState("");
  const [viewDate, setViewDate] = useState(() => parseDateInput(value.from) ?? new Date());
  const [monthViewYear, setMonthViewYear] = useState(() => Number(value.monthKey.slice(0, 4)) || new Date().getFullYear());

  useEffect(() => {
    if (!open) {
      return;
    }
    const baseDate =
      parseDateInput(value.from) ??
      (value.monthKey ? parseDateInput(`${value.monthKey}-01`) : null) ??
      new Date();
    setDraftFrom(value.from);
    setDraftTo(value.to);
    setDraftMonthKey(value.monthKey);
    setMode(value.monthKey ? "month" : "range");
    setViewDate(baseDate);
    setMonthViewYear(Number(value.monthKey.slice(0, 4)) || baseDate.getFullYear());
  }, [open, value.from, value.monthKey, value.to]);

  const calendarDays = useMemo(() => getCalendarDays(viewDate), [viewDate]);
  const triggerLabel = useMemo(() => getTriggerLabel(value, placeholder), [placeholder, value]);
  const todayValue = useMemo(() => formatDateInput(new Date()), []);

  function applyRange() {
    if (!draftFrom) {
      onChange({ from: "", to: "", monthKey: "" });
      setOpen(false);
      return;
    }
    onChange({
      from: draftFrom,
      to: draftTo || draftFrom,
      monthKey: "",
    });
    setOpen(false);
  }

  function applyMonth(monthKey: string) {
    const range = getMonthRange(monthKey);
    setDraftMonthKey(monthKey);
    onChange({
      from: range.from,
      to: range.to,
      monthKey,
    });
    setOpen(false);
  }

  function clearSelection() {
    setDraftFrom("");
    setDraftTo("");
    setDraftMonthKey("");
    onChange({ from: "", to: "", monthKey: "" });
    setOpen(false);
  }

  function handleDayClick(day: string) {
    setDraftMonthKey("");
    if (!draftFrom || draftTo) {
      setDraftFrom(day);
      setDraftTo("");
      return;
    }
    if (day < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(day);
      return;
    }
    setDraftTo(day);
  }

  return (
    <Popover.Root open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <Popover.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-11 w-full justify-between rounded-xl border-zinc-200 bg-white px-4 font-normal shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
              className,
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-left">{triggerLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" sideOffset={8} align="start" className="z-50">
          <Popover.Popup className="w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.18)] outline-none">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-left text-base font-semibold transition-colors hover:bg-zinc-100"
                  onClick={() => setMode((current) => (current === "range" ? "month" : "range"))}
                >
                  {mode === "range"
                    ? `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`
                    : `${monthViewYear}`}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    onClick={() => {
                      if (mode === "range") {
                        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
                        return;
                      }
                      setMonthViewYear((year) => year - 1);
                    }}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    onClick={() => {
                      if (mode === "range") {
                        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
                        return;
                      }
                      setMonthViewYear((year) => year + 1);
                    }}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              {mode === "month" ? (
                <div className="grid grid-cols-3 gap-2">
                  {MONTH_NAMES.map((monthName, index) => {
                    const monthKey = `${monthViewYear}-${String(index + 1).padStart(2, "0")}`;
                    const selected = value.monthKey === monthKey || draftMonthKey === monthKey;
                    return (
                      <button
                        key={monthKey}
                        type="button"
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                          selected
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-zinc-200 bg-white hover:bg-zinc-50",
                        )}
                        onClick={() => applyMonth(monthKey)}
                      >
                        {monthName}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
                    {WEEKDAY_NAMES.map((name) => (
                      <div key={name} className="py-1">
                        {name}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day) => {
                      const dayValue = formatDateInput(day);
                      const inCurrentMonth = day.getMonth() === viewDate.getMonth();
                      const selectedStart = isSameDay(dayValue, draftFrom);
                      const selectedEnd = isSameDay(dayValue, draftTo);
                      const inRange = isWithinRange(dayValue, draftFrom, draftTo);
                      return (
                        <button
                          key={dayValue}
                          type="button"
                          className={cn(
                            "flex h-10 items-center justify-center rounded-xl text-sm transition-colors",
                            inCurrentMonth ? "text-foreground" : "text-zinc-400",
                            inRange ? "bg-emerald-100 text-emerald-950" : "hover:bg-zinc-100",
                            selectedStart || selectedEnd
                              ? "bg-emerald-500 font-semibold text-white hover:bg-emerald-500"
                              : "",
                          )}
                          onClick={() => handleDayClick(dayValue)}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-muted-foreground">
                    {draftFrom
                      ? draftTo
                        ? `Период: ${formatDateLabel(draftFrom)} - ${formatDateLabel(draftTo)}`
                        : `Начало периода: ${formatDateLabel(draftFrom)}`
                      : "Выберите первую дату, затем вторую. Если нужен один день, нажмите Применить после первого выбора."}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                    <X className="size-4" />
                    Сбросить
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      setViewDate(today);
                      setMode("range");
                      setDraftMonthKey("");
                      setDraftFrom(todayValue);
                      setDraftTo(todayValue);
                      onChange({ from: todayValue, to: todayValue, monthKey: "" });
                      setOpen(false);
                    }}
                  >
                    Сегодня
                  </Button>
                </div>
                {mode === "range" ? (
                  <Button type="button" size="sm" disabled={!draftFrom} onClick={applyRange}>
                    Применить
                  </Button>
                ) : null}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
