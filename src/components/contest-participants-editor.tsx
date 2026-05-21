"use client";

import { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOD_DEPARTMENTS } from "@/lib/constants";
import { CONTRACTOR_TYPE_OPTIONS } from "@/lib/requestFields";
import { sanitizeNumericInput } from "@/lib/vat";

export type ContestParticipantDraft = {
  id: string;
  name: string;
  department: string;
  hours: string;
  directCost: string;
  taxAmount: string;
  contractorTypes: string[];
  taxUnknown: boolean;
  amountIncludesTaxes: boolean;
  amountExcludesTaxes: boolean;
  validationSkipped: boolean;
  hodConfirmed?: boolean;
  buhConfirmed?: boolean;
};

export function createContestParticipantDraft(): ContestParticipantDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    department: "",
    hours: "",
    directCost: "",
    taxAmount: "",
    contractorTypes: [],
    taxUnknown: false,
    amountIncludesTaxes: false,
    amountExcludesTaxes: false,
    validationSkipped: false,
  };
}

type ContestParticipantsEditorProps = {
  addLabel: string;
  description?: string;
  emptyNamePlaceholder: string;
  label: string;
  rows: ContestParticipantDraft[];
  setRows: Dispatch<SetStateAction<ContestParticipantDraft[]>>;
  showContractorTypes?: boolean;
};

export default function ContestParticipantsEditor({
  addLabel,
  description,
  emptyNamePlaceholder,
  label,
  rows,
  setRows,
  showContractorTypes = false,
}: ContestParticipantsEditorProps) {
  function updateRow(id: string, updater: (row: ContestParticipantDraft) => ContestParticipantDraft) {
    setRows((current) =>
      current.map((row) => (row.id === id ? updater(row) : row)),
    );
  }

  function rowHasContent(row: ContestParticipantDraft) {
    return Boolean(
      row.name.trim() ||
        row.department ||
        row.hours ||
        row.directCost ||
        row.taxAmount ||
        row.contractorTypes.length ||
        row.taxUnknown ||
        row.amountIncludesTaxes ||
        row.amountExcludesTaxes ||
        row.validationSkipped,
    );
  }

  function removeOrClearRow(id: string) {
    setRows((current) => {
      if (current.length > 1) {
        return current.filter((row) => row.id !== id);
      }
      return [createContestParticipantDraft()];
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <Label>{label}</Label>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {rows.map((item) => (
        <div
          key={item.id}
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)]">
            <Input
              className="min-w-0"
              placeholder={emptyNamePlaceholder}
              value={item.name}
              onChange={(event) =>
                updateRow(item.id, (row) => ({ ...row, name: event.target.value }))
              }
            />
            <Select
              value={item.department || "none"}
              onValueChange={(value) =>
                updateRow(item.id, (row) => ({
                  ...row,
                  department: value === "none" ? "" : value,
                }))
              }
            >
              <SelectTrigger className="min-w-0 w-full">
                <SelectValue placeholder="Цех" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Цех не выбран</SelectItem>
                {HOD_DEPARTMENTS.map((department) => (
                  <SelectItem key={department} value={department}>
                    {department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="min-w-0"
              placeholder={showContractorTypes ? "Сумма подрядчику/поставщику" : "Прямые затраты"}
              inputMode="decimal"
              value={item.directCost}
              onChange={(event) =>
                updateRow(item.id, (row) => ({
                  ...row,
                  directCost: sanitizeNumericInput(event.target.value),
                }))
              }
            />
            <Input
              className="min-w-0"
              placeholder="Налоги"
              inputMode="decimal"
              value={item.taxAmount}
              onChange={(event) =>
                updateRow(item.id, (row) => ({
                  ...row,
                  taxAmount: sanitizeNumericInput(event.target.value),
                }))
              }
            />
            <Input
              className="min-w-0"
              placeholder={showContractorTypes ? "Часы, если применимо" : "Часы"}
              inputMode="decimal"
              value={item.hours}
              onChange={(event) =>
                updateRow(item.id, (row) => ({
                  ...row,
                  hours: sanitizeNumericInput(event.target.value),
                }))
              }
            />
          </div>
          {showContractorTypes ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Тип подрядчика</div>
              <div className="flex flex-wrap items-center gap-3">
                {CONTRACTOR_TYPE_OPTIONS.map((option) => {
                  const checked = item.contractorTypes.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        className="size-4 accent-primary"
                        name={`contractor-type-${item.id}`}
                        checked={checked}
                        onClick={(event) => {
                          if (!checked) {
                            return;
                          }
                          event.preventDefault();
                          updateRow(item.id, (row) => ({
                            ...row,
                            contractorTypes: [],
                          }));
                        }}
                        onChange={() =>
                          updateRow(item.id, (row) => ({
                            ...row,
                            contractorTypes: [option],
                          }))
                        }
                      />
                      {option}
                    </label>
                  );
                })}
                {item.contractorTypes.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateRow(item.id, (row) => ({
                        ...row,
                        contractorTypes: [],
                      }))
                    }
                  >
                    Сбросить тип
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="text-sm font-medium">Налоги</div>
            <div className="flex flex-wrap gap-3">
              {[
                {
                  key: "taxUnknown",
                  label: "Я не знаю, какие налоги",
                },
                {
                  key: "amountIncludesTaxes",
                  label: "Сумма уже с налогами",
                },
                {
                  key: "amountExcludesTaxes",
                  label: "Сумма не включает налоги",
                },
              ].map((option) => {
                const selectedCount = [
                  item.taxUnknown,
                  item.amountIncludesTaxes,
                  item.amountExcludesTaxes,
                ].filter(Boolean).length;
                const checked = Boolean(item[option.key as keyof ContestParticipantDraft]);
                const disabled = !checked && selectedCount >= 2;
                return (
                  <label key={option.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(nextChecked) =>
                        updateRow(item.id, (row) => {
                          const nextRow = {
                            ...row,
                            [option.key]: nextChecked === true,
                          };
                          if (option.key === "amountIncludesTaxes" && nextChecked === true) {
                            nextRow.amountExcludesTaxes = false;
                          }
                          if (option.key === "amountExcludesTaxes" && nextChecked === true) {
                            nextRow.amountIncludesTaxes = false;
                          }
                          return nextRow;
                        })
                      }
                    />
                    {option.label}
                  </label>
                );
                })}
                {[
                  item.taxUnknown,
                  item.amountIncludesTaxes,
                  item.amountExcludesTaxes,
                ].some(Boolean) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateRow(item.id, (row) => ({
                        ...row,
                        taxUnknown: false,
                        amountIncludesTaxes: false,
                        amountExcludesTaxes: false,
                      }))
                    }
                  >
                    Сбросить
                  </Button>
                ) : null}
              </div>
            </div>
          <label className="sm:col-span-4 flex items-center gap-2 text-sm">
            <Checkbox
              checked={item.validationSkipped}
              onCheckedChange={(checked) =>
                updateRow(item.id, (row) => ({
                  ...row,
                  validationSkipped: checked === true,
                  hodConfirmed: checked === true,
                  buhConfirmed: checked === true,
                }))
              }
            />
            Валидация цеха не требуется
          </label>
          <div className="sm:col-span-4 -mt-1 text-xs text-muted-foreground">
            {item.validationSkipped
              ? "Цех не получит задачу на валидацию по этой записи."
              : "Уточните у руководителя цеха или отправьте на заполнение."}
          </div>
          {rows.length > 1 || rowHasContent(item) ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:col-span-4 w-fit"
              onClick={() => removeOrClearRow(item.id)}
            >
              {rows.length > 1 ? "Удалить" : "Очистить"}
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          setRows((current) => [...current, createContestParticipantDraft()])
        }
      >
        {addLabel}
      </Button>
    </div>
  );
}
