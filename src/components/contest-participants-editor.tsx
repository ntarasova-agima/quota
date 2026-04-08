"use client";

import { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOD_DEPARTMENTS } from "@/lib/constants";
import { sanitizeNumericInput } from "@/lib/vat";

export type ContestParticipantDraft = {
  id: string;
  name: string;
  department: string;
  hours: string;
  directCost: string;
  validationSkipped: boolean;
  hodConfirmed?: boolean;
};

export function createContestParticipantDraft(): ContestParticipantDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    department: "",
    hours: "",
    directCost: "",
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
};

export default function ContestParticipantsEditor({
  addLabel,
  description,
  emptyNamePlaceholder,
  label,
  rows,
  setRows,
}: ContestParticipantsEditorProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <Label>{label}</Label>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {rows.map((item) => (
        <div
          key={item.id}
          className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]"
        >
          <Input
            className="min-w-0"
            placeholder={emptyNamePlaceholder}
            value={item.name}
            onChange={(event) =>
              setRows((current) =>
                current.map((row) =>
                  row.id === item.id ? { ...row, name: event.target.value } : row,
                ),
              )
            }
          />
          <Select
            value={item.department || "none"}
            onValueChange={(value) =>
              setRows((current) =>
                current.map((row) =>
                  row.id === item.id
                    ? { ...row, department: value === "none" ? "" : value }
                    : row,
                ),
              )
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
            placeholder="Часы"
            inputMode="decimal"
            value={item.hours}
            onChange={(event) =>
              setRows((current) =>
                current.map((row) =>
                  row.id === item.id
                    ? { ...row, hours: sanitizeNumericInput(event.target.value) }
                    : row,
                ),
              )
            }
          />
          <Input
            className="min-w-0"
            placeholder="Прямые затраты"
            inputMode="decimal"
            value={item.directCost}
            onChange={(event) =>
              setRows((current) =>
                current.map((row) =>
                  row.id === item.id
                    ? { ...row, directCost: sanitizeNumericInput(event.target.value) }
                    : row,
                ),
              )
            }
          />
          <label className="sm:col-span-4 flex items-center gap-2 text-sm">
            <Checkbox
              checked={item.validationSkipped}
              onCheckedChange={(checked) =>
                setRows((current) =>
                  current.map((row) =>
                    row.id === item.id
                      ? { ...row, validationSkipped: checked === true, hodConfirmed: checked === true }
                      : row,
                  ),
                )
              }
            />
            Валидация не требуется
          </label>
          <div className="sm:col-span-4 -mt-1 text-xs text-muted-foreground">
            {item.validationSkipped
              ? "Цех не получит задачу на валидацию по этой записи."
              : "Уточните у руководителя цеха или отправьте на заполнение."}
          </div>
          {rows.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:col-span-4 w-fit"
              onClick={() =>
                setRows((current) => current.filter((row) => row.id !== item.id))
              }
            >
              Удалить
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
