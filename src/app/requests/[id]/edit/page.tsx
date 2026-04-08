"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/convex";
import {
  CURRENCIES,
  DEFAULT_REQUIRED_ROLES,
  EXPENSE_CATEGORIES,
  FUNDING_SOURCES,
  HOD_DEPARTMENTS,
  ROLE_OPTIONS,
  type RoleOption,
} from "@/lib/constants";
import {
  AI_TOOLS_FUNDING_SOURCE,
  AI_TOOLS_REQUEST_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  getDefaultFundingSourceForCategory,
  getEnforcedRolesForFundingSource,
  isAiToolsFundingSource,
  isAiToolsRequestCategory,
  isFundingSourceAllowedForCategory,
  isServiceRecipientCategory,
  normalizeFundingSource,
  normalizeRequestCategory,
} from "@/lib/requestRules";
import {
  DEFAULT_VAT_RATE,
  parseMoneyInput,
  parseVatRateInput,
  resolveVatAmounts,
  syncVatInputPair,
  type VatAmountSource,
} from "@/lib/vat";

type SpecialistDraft = {
  id: string;
  name: string;
  department: string;
  hours: string;
  directCost: string;
  hodConfirmed?: boolean;
};

type PendingEditConfirmation = {
  submit: boolean;
  confirmationLines: string[];
  infoLines: string[];
};

export default function NewRequestPage() {
  const params = useParams();
  const requestId = params.id as any;
  const editRequest = useMutation(api.requests.editRequest);
  const router = useRouter();
  const data = useQuery(api.requests.getRequest, { id: requestId });
  const today = useMemo(() => new Date(), []);
  const minDateValue = useMemo(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    return next.toISOString().slice(0, 10);
  }, [today]);
  const defaultDeadline = useMemo(() => {
    const date = new Date(today);
    let added = 0;
    while (added < 2) {
      date.setDate(date.getDate() + 1);
      const day = date.getDay();
      if (day !== 0 && day !== 6) {
        added += 1;
      }
    }
    return date.toISOString().slice(0, 10);
  }, [today]);

  const [category, setCategory] = useState("Welcome-бонус");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [amountWithVat, setAmountWithVat] = useState("");
  const [vatRate, setVatRate] = useState(String(DEFAULT_VAT_RATE));
  const [vatInputSource, setVatInputSource] = useState<VatAmountSource>("without");
  const [currency, setCurrency] = useState("RUB");
  const [fundingSource, setFundingSource] = useState("Квота на пресейлы");
  const [justification, setJustification] = useState("");
  const [details, setDetails] = useState("");
  const [investmentReturn, setInvestmentReturn] = useState("");
  const [clientName, setClientName] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [contacts, setContacts] = useState("");
  const [relatedRequests, setRelatedRequests] = useState("");
  const [links, setLinks] = useState("");
  const [specialists, setSpecialists] = useState<SpecialistDraft[]>([
    { id: crypto.randomUUID(), name: "", department: "", hours: "", directCost: "" },
  ]);
  const [financeLinks, setFinanceLinks] = useState("");
  const [approvalDeadline, setApprovalDeadline] = useState(defaultDeadline);
  const [neededBy, setNeededBy] = useState(defaultDeadline);
  const [paidBy, setPaidBy] = useState(defaultDeadline);
  const [requiredRoles, setRequiredRoles] = useState<RoleOption[]>([...DEFAULT_REQUIRED_ROLES]);
  const [error, setError] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingEditConfirmation | null>(null);
  const myRoles = useQuery(api.roles.myRoles);
  const isNbd = useMemo(() => myRoles?.includes("NBD"), [myRoles]);
  const isAiBoss = useMemo(() => myRoles?.includes("AI-BOSS"), [myRoles]);
  const presalesMonthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 3 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, []);
  const presalesQuotas = useQuery(
    api.quotas.listByMonthKeys,
    isNbd && fundingSource === "Квота на пресейлы" ? { monthKeys: presalesMonthKeys } : "skip",
  );
  const aiToolQuotas = useQuery(
    api.quotas.listAiToolByMonthKeys,
    isAiBoss && fundingSource === AI_TOOLS_FUNDING_SOURCE && isAiToolsRequestCategory(category)
      ? { monthKeys: presalesMonthKeys }
      : "skip",
  );
  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const formatMonth = useMemo(
    () => (year: number, month: number) => {
      const names = [
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
      return `${names[month - 1] ?? ""} ${year}`;
    },
    [],
  );

  useEffect(() => {
    if (!data?.request) {
      return;
    }
    const request = data.request;
    const normalizedFundingSource = normalizeFundingSource(request.fundingSource);
    const normalizedStoredCategory = normalizeRequestCategory(request.category);
    const normalizedCategory =
      normalizedStoredCategory === SERVICE_PURCHASE_CATEGORY && isAiToolsFundingSource(request.fundingSource)
        ? AI_TOOLS_REQUEST_CATEGORY
        : normalizedStoredCategory;
    setCategory(normalizedCategory);
    setTitle(request.title ?? "");
    setAmount(String(request.amount ?? ""));
    setAmountWithVat(request.amountWithVat !== undefined ? String(request.amountWithVat) : "");
    setVatRate(String(request.vatRate ?? DEFAULT_VAT_RATE));
    setVatInputSource("without");
    setCurrency(request.currency);
    setFundingSource(normalizedFundingSource);
    setJustification(request.justification ?? "");
    setDetails(request.details ?? "");
    setInvestmentReturn(request.investmentReturn ?? "");
    setClientName(request.clientName ?? "");
    setCounterparty(request.counterparty ?? "");
    setContacts((request.contacts ?? []).join("\n"));
    setRelatedRequests((request.relatedRequests ?? []).join("\n"));
    setLinks((request.links ?? []).join("\n"));
    setSpecialists(
      request.specialists?.length
        ? request.specialists.map((item) => ({
            id: item.id,
            name: item.name,
            department: item.department ?? "",
            hours: item.hours !== undefined ? String(item.hours) : "",
            directCost: item.directCost !== undefined ? String(item.directCost) : "",
            hodConfirmed: item.hodConfirmed ?? false,
          }))
        : [{ id: crypto.randomUUID(), name: "", department: "", hours: "", directCost: "" }],
    );
    setFinanceLinks((request.financePlanLinks ?? []).join("\n"));
    setApprovalDeadline(
      request.approvalDeadline
        ? new Date(request.approvalDeadline).toISOString().slice(0, 10)
        : defaultDeadline,
    );
    setNeededBy(
      request.neededBy ? new Date(request.neededBy).toISOString().slice(0, 10) : defaultDeadline,
    );
    setPaidBy(request.paidBy ? new Date(request.paidBy).toISOString().slice(0, 10) : defaultDeadline);
    setRequiredRoles((request.requiredRoles as RoleOption[]) ?? [...DEFAULT_REQUIRED_ROLES]);
  }, [data?.request?._id, defaultDeadline]);

  const contactsList = useMemo(
    () =>
      contacts
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [contacts],
  );
  const linksList = useMemo(
    () =>
      links
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [links],
  );
  const relatedRequestsList = useMemo(
    () =>
      relatedRequests
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [relatedRequests],
  );
  const specialistsPayload = useMemo(
    () =>
      specialists.map((item) => ({
        id: item.id,
        name: item.name.trim(),
        department: item.department || undefined,
        hours: item.hours ? Number(item.hours.replace(/\s+/g, "")) : undefined,
        directCost: item.directCost ? Number(item.directCost.replace(/\s+/g, "")) : undefined,
        hodConfirmed: item.hodConfirmed ?? false,
      })),
    [specialists],
  );
  const contestHasSpecialists = useMemo(
    () =>
      category === "Конкурсное задание" &&
      specialistsPayload.some(
        (item) =>
          item.name || item.department || item.hours !== undefined || item.directCost !== undefined,
      ),
    [category, specialistsPayload],
  );
  const isContestCategory =
    category === "Конкурсное задание" ||
    data?.request?.category === "Конкурсное задание" ||
    specialists.some(
      (item) =>
        item.name.trim() ||
        item.department.trim() ||
        item.hours.trim() ||
        item.directCost.trim() ||
        item.hodConfirmed,
    );
  const contestAmount = useMemo(
    () =>
      specialistsPayload.reduce((sum, item) => sum + (item.directCost ?? 0), 0),
    [specialistsPayload],
  );
  const effectiveAmountWithoutVatInput = useMemo(
    () =>
      contestHasSpecialists
        ? contestAmount
        : amount
          ? Number(amount.replace(/\s+/g, ""))
          : undefined,
    [amount, contestAmount, contestHasSpecialists],
  );
  const financeLinksList = useMemo(
    () =>
      financeLinks
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [financeLinks],
  );
  const isServiceCategory = useMemo(() => isServiceRecipientCategory(category), [category]);

  const enforcedRoles = useMemo(() => {
    return new Set<RoleOption>(getEnforcedRolesForFundingSource(fundingSource) as RoleOption[]);
  }, [fundingSource]);

  useEffect(() => {
    if (enforcedRoles.size === 0) {
      return;
    }
    setRequiredRoles((current) => {
      const next = new Set(current);
      enforcedRoles.forEach((role) => next.add(role));
      return Array.from(next);
    });
  }, [enforcedRoles]);

  useEffect(() => {
    if (fundingSource === "Отгрузки проекта" && !paidBy) {
      setPaidBy(defaultDeadline);
    }
  }, [fundingSource, paidBy, defaultDeadline]);

  useEffect(() => {
    if (!isFundingSourceAllowedForCategory(category, fundingSource)) {
      setFundingError("Так не бывает");
    } else {
      setFundingError(null);
    }
  }, [fundingSource, category]);

  useEffect(() => {
    if (!contestHasSpecialists) {
      return;
    }
    const synced = syncVatInputPair({
      amountWithoutVatInput:
        effectiveAmountWithoutVatInput !== undefined ? String(effectiveAmountWithoutVatInput) : "",
      amountWithVatInput: amountWithVat,
      vatRateInput: vatRate,
      source: "without",
    });
    if (synced.amountWithVatInput !== amountWithVat) {
      setAmountWithVat(synced.amountWithVatInput);
    }
    if (vatInputSource !== "without") {
      setVatInputSource("without");
    }
  }, [amountWithVat, contestHasSpecialists, effectiveAmountWithoutVatInput, vatInputSource, vatRate]);

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    const defaultFundingSource = getDefaultFundingSourceForCategory(nextCategory);
    if (defaultFundingSource) {
      setFundingSource(defaultFundingSource);
    }
  }

  if (data === undefined) {
    return (
      <RequireAuth>
        <div className="min-h-screen bg-background text-foreground">
          <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          </main>
        </div>
      </RequireAuth>
    );
  }

  if (data === null || !data.isCreator) {
    return (
      <RequireAuth>
        <div className="min-h-screen bg-background text-foreground">
          <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
            <p className="text-sm text-muted-foreground">Редактирование недоступно.</p>
          </main>
        </div>
      </RequireAuth>
    );
  }

  function toggleRole(role: RoleOption) {
    if (enforcedRoles.has(role)) {
      return;
    }
    setRequiredRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    );
  }

  async function submitRequest(submit: boolean, confirmWorkflowReset = false) {
    setError(null);
    if (!confirmWorkflowReset) {
      setPendingConfirmation(null);
    }
    setSubmitting(true);
    try {
      if (approvalDeadline) {
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (new Date(approvalDeadline) < tomorrow) {
          throw new Error("Дедлайн согласования должен быть не раньше завтрашнего дня");
        }
      }
      if (fundingError) {
        throw new Error("выбран неверный источник финансирования или категория заявки");
      }
      if (approvalDeadline && neededBy && new Date(approvalDeadline) > new Date(neededBy)) {
        throw new Error("Дедлайн согласования должен быть не позже даты, когда нужны деньги");
      }
      if (category === "Welcome-бонус" && !investmentReturn.trim()) {
        throw new Error("Укажите, как будем возвращать инвестиции");
      }
      if (fundingSource === "Отгрузки проекта" && !paidBy) {
        throw new Error("Укажите дату, когда заплатят нам");
      }
      const resolvedAmounts = resolveVatAmounts({
        amountWithoutVat: effectiveAmountWithoutVatInput,
        amountWithVat: parseMoneyInput(amountWithVat),
        vatRate: parseVatRateInput(vatRate),
        autoCalculateAmountWithVat: true,
      });
      if (resolvedAmounts.amountWithoutVat === undefined || resolvedAmounts.amountWithoutVat <= 0) {
        throw new Error("Укажите сумму без НДС или сумму с НДС");
      }
      if (resolvedAmounts.amountWithVat === undefined || resolvedAmounts.amountWithVat <= 0) {
        throw new Error("Укажите сумму с НДС или сумму без НДС");
      }
      await editRequest({
        id: requestId,
        title,
        category,
        amount: resolvedAmounts.amountWithoutVat,
        amountWithVat: resolvedAmounts.amountWithVat,
        vatRate: resolvedAmounts.vatRate,
        currency,
        fundingSource,
        justification,
        details: details.trim() || undefined,
        investmentReturn: investmentReturn.trim() || undefined,
        clientName,
        counterparty:
          category === "Конкурсное задание" ||
          category === "Welcome-бонус" ||
          isServiceCategory
            ? ""
            : counterparty,
        contacts: category === "Конкурсное задание" || isServiceCategory ? [] : contactsList,
        relatedRequests: relatedRequestsList,
        links:
          category === "Конкурсное задание" ||
          category === "Welcome-бонус" ||
          isServiceCategory
            ? []
            : linksList,
        specialists: category === "Конкурсное задание" ? specialistsPayload : undefined,
        financePlanLinks:
          category === "Конкурсное задание" ||
          category === "Welcome-бонус" ||
          isServiceCategory
            ? undefined
            : financeLinksList.length
              ? financeLinksList
              : undefined,
        approvalDeadline: approvalDeadline ? new Date(approvalDeadline).getTime() : undefined,
        neededBy: neededBy ? new Date(neededBy).getTime() : undefined,
        paidBy:
          fundingSource === "Отгрузки проекта" && paidBy
            ? new Date(paidBy).getTime()
            : undefined,
        requiredRoles,
        submit,
        confirmWorkflowReset,
      } as any);
      router.push(`/requests/${requestId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить заявку";
      if (message.startsWith("CONFIRM_EDIT_EFFECTS::")) {
        try {
          const payload = JSON.parse(message.replace("CONFIRM_EDIT_EFFECTS::", ""));
          setPendingConfirmation({
            submit,
            confirmationLines: payload.confirmationLines ?? [],
            infoLines: payload.infoLines ?? [],
          });
          setError(null);
          return;
        } catch {
          setError("Не удалось определить влияние изменений на согласование");
          return;
        }
      }
      if (message === "Так не бывает") {
        setError("выбран неверный источник финансирования или категория заявки");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitRequest(true);
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Редактирование заявки" />
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Редактирование заявки</CardTitle>
              <CardDescription>
                Можно сохранить изменения в любой момент. Если у уже согласуемой заявки меняется сумма,
                она уйдет на повторное согласование.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Категория</Label>
                    <Select value={category} onValueChange={handleCategoryChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите категорию" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Источник финансирования</Label>
                    <Select value={fundingSource} onValueChange={setFundingSource}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите источник" />
                      </SelectTrigger>
                      <SelectContent>
                        {FUNDING_SOURCES.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fundingError && (
                      <p className="text-xs text-destructive">{fundingError}</p>
                    )}
                  </div>
                </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="title">Название заявки</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="clientName">
                    {isServiceCategory ? "Получатель сервиса" : "Клиент"}
                  </Label>
                  {isServiceCategory ? (
                    <p className="text-xs text-muted-foreground">
                      Имя сотрудника или наименование отдела
                    </p>
                  ) : null}
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="amount">Сумма без НДС</Label>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    value={contestHasSpecialists ? String(contestAmount) : amount}
                    onChange={(event) => {
                      const nextAmount = event.target.value.replace(/\s+/g, "");
                      setVatInputSource("without");
                      setAmount(nextAmount);
                      const synced = syncVatInputPair({
                        amountWithoutVatInput: nextAmount,
                        amountWithVatInput: amountWithVat,
                        vatRateInput: vatRate,
                        source: "without",
                      });
                      setAmountWithVat(synced.amountWithVatInput);
                    }}
                    disabled={contestHasSpecialists}
                  />
                  {contestHasSpecialists ? (
                    <p className="text-xs text-muted-foreground">
                      Сумма без НДС считается автоматически по прямым затратам специалистов.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amountWithVat">Сумма с НДС</Label>
                  <Input
                    id="amountWithVat"
                    type="text"
                    inputMode="decimal"
                    value={amountWithVat}
                    onChange={(event) => {
                      const nextAmountWithVat = event.target.value.replace(/\s+/g, "");
                      if (contestHasSpecialists) {
                        setAmountWithVat(nextAmountWithVat);
                        return;
                      }
                      setVatInputSource("with");
                      setAmountWithVat(nextAmountWithVat);
                      const synced = syncVatInputPair({
                        amountWithoutVatInput: amount,
                        amountWithVatInput: nextAmountWithVat,
                        vatRateInput: vatRate,
                        source: "with",
                      });
                      setAmount(synced.amountWithoutVatInput);
                    }}
                    disabled={contestHasSpecialists}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vatRate">Ставка НДС, %</Label>
                  <Input
                    id="vatRate"
                    type="text"
                    inputMode="decimal"
                    value={vatRate}
                    onChange={(event) => {
                      const nextVatRate = event.target.value.replace(/\s+/g, "");
                      setVatRate(nextVatRate);
                      const source = contestHasSpecialists ? "without" : vatInputSource;
                      const synced = syncVatInputPair({
                        amountWithoutVatInput:
                          contestHasSpecialists
                            ? effectiveAmountWithoutVatInput !== undefined
                              ? String(effectiveAmountWithoutVatInput)
                              : ""
                            : amount,
                        amountWithVatInput: amountWithVat,
                        vatRateInput: nextVatRate,
                        source,
                      });
                      if (!contestHasSpecialists) {
                        setAmount(synced.amountWithoutVatInput);
                      }
                      setAmountWithVat(synced.amountWithVatInput);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    По умолчанию {DEFAULT_VAT_RATE}%. Если поле пустое, считаем 0%.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  Введите ту сумму, которую знаете. НДС рассчитается автоматически в соответствии с указанным процентом.
                </p>
              </div>

              {isContestCategory && (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="space-y-1">
                    <Label>Специалисты</Label>
                    <p className="text-sm text-muted-foreground">
                      Если в конкурсном задании участвуют специалисты, добавьте их здесь. После этого
                      заявка уйдет сначала на валидацию цехов.
                    </p>
                  </div>
                  {specialists.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.7fr)_minmax(0,0.9fr)]"
                    >
                      <Input
                        className="min-w-0"
                        placeholder="Специалист"
                        value={item.name}
                        onChange={(event) =>
                          setSpecialists((current) =>
                            current.map((row) =>
                              row.id === item.id ? { ...row, name: event.target.value } : row,
                            ),
                          )
                        }
                      />
                      <Select
                        value={item.department || "none"}
                        onValueChange={(value) =>
                          setSpecialists((current) =>
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
                          {HOD_DEPARTMENTS.map((dep) => (
                            <SelectItem key={dep} value={dep}>
                              {dep}
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
                          setSpecialists((current) =>
                            current.map((row) =>
                              row.id === item.id
                                ? { ...row, hours: event.target.value.replace(/\s+/g, "") }
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
                          setSpecialists((current) =>
                            current.map((row) =>
                              row.id === item.id
                                ? { ...row, directCost: event.target.value.replace(/\s+/g, "") }
                                : row,
                            ),
                          )
                        }
                      />
                      <div className="sm:col-span-4 -mt-1 text-xs text-muted-foreground">
                        Уточните у руководителя цеха или отправьте на заполнение.
                      </div>
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="sm:col-span-4 w-fit"
                          onClick={() =>
                            setSpecialists((current) => current.filter((row) => row.id !== item.id))
                          }
                        >
                          Удалить специалиста
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setSpecialists((current) => [
                        ...current,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          department: "",
                          hours: "",
                          directCost: "",
                        },
                      ])
                    }
                  >
                    + Добавить специалиста
                  </Button>
                </div>
              )}

              {category !== "Конкурсное задание" &&
              category !== "Welcome-бонус" &&
              !isServiceCategory && (
                <div className="space-y-2">
                  <Label htmlFor="counterparty">Контрагент (кому платим)</Label>
                  <Input
                    id="counterparty"
                    value={counterparty}
                    onChange={(event) => setCounterparty(event.target.value)}
                    required
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="currency">Валюта</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="Выберите валюту" />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {category !== "Конкурсное задание" && !isServiceCategory && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="contacts">Контакты клиента</Label>
                    <Textarea
                      id="contacts"
                      value={contacts}
                      onChange={(event) => setContacts(event.target.value)}
                      rows={3}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="relatedRequests">Связана с заявками (по одной в строке)</Label>
                <Textarea
                  id="relatedRequests"
                  value={relatedRequests}
                  onChange={(event) => setRelatedRequests(event.target.value)}
                  placeholder="Например, WB_QS_00012 или https://..."
                  rows={3}
                />
              </div>

              {category !== "Конкурсное задание" &&
              category !== "Welcome-бонус" &&
              !isServiceCategory && (
                <div className="space-y-2">
                  <Label htmlFor="links">Ссылки на материалы (по одной в строке)</Label>
                  <Textarea
                    id="links"
                    value={links}
                    onChange={(event) => setLinks(event.target.value)}
                    rows={3}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="justification">Обоснование</Label>
                <Textarea
                  id="justification"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  rows={4}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="details">Детали заявки</Label>
                <p className="text-xs text-muted-foreground">
                  Важные ссылки, описание предмета закупки
                </p>
                <Textarea
                  id="details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={4}
                />
              </div>

              {category === "Welcome-бонус" && (
                <div className="space-y-2">
                  <Label htmlFor="investmentReturn">Как будем возвращать инвестиции</Label>
                  <Textarea
                    id="investmentReturn"
                    value={investmentReturn}
                    onChange={(event) => setInvestmentReturn(event.target.value)}
                    rows={3}
                    required
                  />
                </div>
              )}

              {fundingSource === "Отгрузки проекта" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="financeLinks">Ссылки на финплан (по одной в строке)</Label>
                    <Textarea
                      id="financeLinks"
                      value={financeLinks}
                      onChange={(event) => setFinanceLinks(event.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paidBy">Когда заплатят нам</Label>
                    <Input
                      id="paidBy"
                      type="date"
                      value={paidBy}
                      onChange={(event) => setPaidBy(event.target.value)}
                      min={minDateValue}
                      required
                    />
                  </div>
                </div>
              )}
              {((fundingSource === "Квота на пресейлы" && category !== "Welcome-бонус" && isNbd && presalesQuotas?.length) ||
                (fundingSource === AI_TOOLS_FUNDING_SOURCE && isAiToolsRequestCategory(category) && isAiBoss && aiToolQuotas?.length)) ? (
                <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
                  <div className="font-medium">Остаток квот</div>
                  <div className="mt-2 grid gap-2">
                    {(
                      fundingSource === AI_TOOLS_FUNDING_SOURCE
                          ? aiToolQuotas
                          : presalesQuotas
                    )?.map((item) => (
                      <div
                        key={item.monthKey}
                        className={`flex items-center justify-between rounded-md px-3 py-2 ${
                          item.monthKey === currentMonthKey
                            ? "border border-emerald-300 bg-emerald-50/60"
                            : "border border-transparent"
                        }`}
                      >
                        <span>{formatMonth(item.year, item.month)}</span>
                        <span className="font-semibold">
                          {(item.quota - item.spent).toLocaleString("ru-RU")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="approvalDeadline">Дедлайн согласования</Label>
                  <Input
                    id="approvalDeadline"
                    type="date"
                    value={approvalDeadline}
                    onChange={(event) => setApprovalDeadline(event.target.value)}
                    min={minDateValue}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="neededBy">Нужны деньги к</Label>
                  <Input
                    id="neededBy"
                    type="date"
                    value={neededBy}
                    onChange={(event) => setNeededBy(event.target.value)}
                    min={minDateValue}
                    required
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Обязательные согласующие</Label>
                <div className="grid gap-3 sm:grid-cols-4">
                  {ROLE_OPTIONS.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={requiredRoles.includes(role)}
                        onCheckedChange={() => toggleRole(role)}
                        disabled={enforcedRoles.has(role)}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {pendingConfirmation ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
                  <div className="font-medium">Изменения затронут маршрут согласования</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {pendingConfirmation.confirmationLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {pendingConfirmation.infoLines.length ? (
                    <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800">
                      {pendingConfirmation.infoLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => submitRequest(pendingConfirmation.submit, true)}
                      disabled={submitting}
                    >
                      Подтвердить и сохранить
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingConfirmation(null)}
                      disabled={submitting}
                    >
                      Отменить
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => submitRequest(false)}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  {data.request.status === "draft" ? "Сохранить черновик" : "Сохранить изменения"}
                </Button>
                {data.request.status === "draft" ? (
                  <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                    Отправить на согласование
                  </Button>
                ) : null}
              </div>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
