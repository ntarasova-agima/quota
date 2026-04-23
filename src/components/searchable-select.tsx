"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  subtitle?: string;
  searchText?: string;
};

type SearchableSelectProps = {
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
};

export default function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder = "Поиск",
  emptyLabel = "Ничего не найдено",
  className,
  triggerClassName,
  contentClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) =>
      `${option.label} ${option.subtitle ?? ""} ${option.searchText ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [options, query]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "justify-between gap-2 overflow-hidden px-3 font-normal",
            triggerClassName,
            className,
          )}
        >
          <span className="truncate text-left">
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={cn("w-[320px] p-0", contentClassName)}
      >
        <div className="border-b border-zinc-100 p-2">
          <Input
            ref={inputRef}
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {filteredOptions.length ? (
            filteredOptions.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={`${option.value}:${option.subtitle ?? option.label}`}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none",
                    selected ? "bg-emerald-50/70" : "",
                  )}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
                      selected
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-zinc-200 bg-white text-transparent",
                    )}
                  >
                    <Check className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium leading-snug">
                      {option.label}
                    </span>
                    {option.subtitle ? (
                      <span className="mt-0.5 block break-words text-xs leading-snug text-muted-foreground">
                        {option.subtitle}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
