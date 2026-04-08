"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import FieldLabel from "@/components/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import ContestParticipantsEditor, {
  ContestParticipantDraft,
  createContestParticipantDraft,
} from "@/components/contest-participants-editor";
import { api } from "@/lib/convex";
import {
  CURRENCIES,
  DEFAULT_REQUIRED_ROLES,
  EXPENSE_CATEGORIES,
  FUNDING_SOURCES,
  ROLE_OPTIONS,
  type RoleOption,
} from "@/lib/constants";
import {
  calculateIncomingRatio,
  formatIncomingRatio,
  getPaymentMethodOptions,
  isPaidByDateAllowed,
} from "@/lib/requestFields";
import {
  AI_TOOLS_FUNDING_SOURCE,
  CLIENT_SERVICES_TRANSIT_CATEGORY,
  getDefaultFundingSourceForCategory,
  getEnforcedRolesForFundingSource,
  isAiToolsRequestCategory,
  isFundingSourceAllowedForCategory,
  isServiceRecipientCategory,
} from "@/lib/requestRules";
import {
  DEFAULT_VAT_RATE,
  parseMoneyInput,
  parseVatRateInput,
  resolveVatAmounts,
  sanitizeNumericInput,
  syncVatInputPair,
  type VatAmountSource,
} from "@/lib/vat";
import {
  ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS,
  formatRequestAttachmentSize,
  isAllowedRequestAttachment,
  MAX_REQUEST_ATTACHMENTS,
  MAX_REQUEST_ATTACHMENT_SIZE,
} from "@/lib/requestAttachments";

export default function NewRequestPage() {
  const createRequest = useMutation(api.requests.createRequest);
  const generateAttachmentUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const saveAttachment = useMutation(api.attachments.saveAttachment);
  const router = useRouter();
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
  const [paymentMethod, setPaymentMethod] = useState("");
  const [contacts, setContacts] = useState("");
  const [relatedRequests, setRelatedRequests] = useState("");
  const [relatedRequestsExpanded, setRelatedRequestsExpanded] = useState(false);
  const [internalSpecialists, setInternalSpecialists] = useState<ContestParticipantDraft[]>([
    createContestParticipantDraft(),
  ]);
  const [contractors, setContractors] = useState<ContestParticipantDraft[]>([
    createContestParticipantDraft(),
  ]);
  const [financeLinks, setFinanceLinks] = useState("");
  const [incomingAmount, setIncomingAmount] = useState("");
  const [shipmentDate, setShipmentDate] = useState("");
  const [approvalDeadline, setApprovalDeadline] = useState(defaultDeadline);
  const [neededBy, setNeededBy] = useState(defaultDeadline);
  const [paidBy, setPaidBy] = useState("");
  const [requiredRoles, setRequiredRoles] = useState<RoleOption[]>([...DEFAULT_REQUIRED_ROLES]);
  const [error, setError] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const isServiceCategory = useMemo(() => isServiceRecipientCategory(category), [category]);
  const isClientTransitCategory = useMemo(
    () => category === CLIENT_SERVICES_TRANSIT_CATEGORY,
    [category],
  );
  const paymentMethodOptions = useMemo(() => getPaymentMethodOptions(category), [category]);
  const paidByError = useMemo(
    () => (paidBy && !isPaidByDateAllowed(paidBy) ? "AGIMA тогда еще не было" : null),
    [paidBy],
  );
  const showPaymentMethod = category !== "Welcome-бонус";
  const isPaymentMethodRequired =
    category !== "Welcome-бонус" && category !== "Конкурсное задание";
  const showCounterparty =
    category !== "Конкурсное задание" &&
    category !== "Welcome-бонус" &&
    !isServiceCategory;
  const financeLinksRequired =
    category !== "Конкурсное задание" &&
    category !== "Welcome-бонус" &&
    !isServiceCategory &&
    fundingSource === "Отгрузки проекта";

  const contactsList = useMemo(
    () =>
      contacts
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [contacts],
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
      [
        ...internalSpecialists.map((item) => ({
          ...item,
          sourceType: "internal" as const,
        })),
        ...contractors.map((item) => ({
          ...item,
          sourceType: "contractor" as const,
        })),
      ].map((item) => ({
        id: item.id,
        name: item.name.trim(),
        sourceType: item.sourceType,
        department: item.department || undefined,
        hours: parseMoneyInput(item.hours),
        directCost: parseMoneyInput(item.directCost),
        hodConfirmed: item.validationSkipped ? true : item.hodConfirmed ?? false,
        validationSkipped: item.validationSkipped,
      })),
    [contractors, internalSpecialists],
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
  const contestAmount = useMemo(
    () =>
      specialistsPayload.reduce((sum, item) => sum + (item.directCost ?? 0), 0),
    [specialistsPayload],
  );
  const effectiveAmountWithoutVatInput = useMemo(
    () =>
      contestHasSpecialists
        ? contestAmount
        : parseMoneyInput(amount),
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

  const enforcedRoles = useMemo(() => {
    return new Set<RoleOption>(getEnforcedRolesForFundingSource(fundingSource) as RoleOption[]);
  }, [fundingSource]);
  const incomingRatioValue = useMemo(
    () =>
      formatIncomingRatio(
        calculateIncomingRatio({
          incomingAmount: parseMoneyInput(incomingAmount),
          amountWithoutVat: parseMoneyInput(
            contestHasSpecialists ? String(contestAmount) : amount,
          ),
          amountWithVat: parseMoneyInput(amountWithVat),
        }),
      ),
    [amount, amountWithVat, contestAmount, contestHasSpecialists, incomingAmount],
  );
  const resolvedAmountsPreview = useMemo(
    () =>
      resolveVatAmounts({
        amountWithoutVat: effectiveAmountWithoutVatInput,
        amountWithVat: parseMoneyInput(amountWithVat),
        vatRate: parseVatRateInput(vatRate),
        autoCalculateAmountWithVat: true,
      }),
    [amountWithVat, effectiveAmountWithoutVatInput, vatRate],
  );
  const titleInvalid = showValidationErrors && !title.trim();
  const clientNameInvalid = showValidationErrors && !clientName.trim();
  const amountInvalid =
    showValidationErrors &&
    (!resolvedAmountsPreview.amountWithoutVat ||
      !resolvedAmountsPreview.amountWithVat ||
      resolvedAmountsPreview.amountWithoutVat <= 0 ||
      resolvedAmountsPreview.amountWithVat <= 0);
  const counterpartyInvalid = showValidationErrors && showCounterparty && !counterparty.trim();
  const paymentMethodInvalid =
    showValidationErrors && isPaymentMethodRequired && !paymentMethod;
  const justificationInvalid = showValidationErrors && !justification.trim();
  const investmentReturnInvalid =
    showValidationErrors && category === "Welcome-бонус" && !investmentReturn.trim();
  const financeLinksInvalid = showValidationErrors && financeLinksRequired && financeLinksList.length === 0;
  const approvalDeadlineInvalid = showValidationErrors && !approvalDeadline;
  const neededByInvalid = showValidationErrors && !neededBy;

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
    if (!isFundingSourceAllowedForCategory(category, fundingSource)) {
      setFundingError("Так не бывает");
    } else {
      setFundingError(null);
    }
  }, [fundingSource, category]);

  useEffect(() => {
    if (!paymentMethod) {
      return;
    }
    if (!paymentMethodOptions.includes(paymentMethod as (typeof paymentMethodOptions)[number])) {
      setPaymentMethod("");
    }
  }, [paymentMethod, paymentMethodOptions]);

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
    if (nextCategory === "Welcome-бонус") {
      setPaymentMethod("");
    }
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

  function queueFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    setFileActionError(null);
    if (selectedFiles.length + files.length > MAX_REQUEST_ATTACHMENTS) {
      setFileActionError("Можно прикрепить не более 20 файлов");
      return;
    }
    for (const file of files) {
      if (file.size > MAX_REQUEST_ATTACHMENT_SIZE) {
        setFileActionError(`Файл ${file.name} больше 40 МБ`);
        return;
      }
      if (!isAllowedRequestAttachment(file)) {
        setFileActionError(`Формат файла ${file.name} не поддерживается`);
        return;
      }
    }
    setSelectedFiles((current) => [...current, ...files]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadQueuedFiles(requestId: any) {
    if (!selectedFiles.length) {
      return true;
    }
    setUploadingFiles(true);
    try {
      for (const file of selectedFiles) {
        const uploadUrl = await generateAttachmentUploadUrl({ requestId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`Не удалось загрузить файл ${file.name}`);
        }
        const { storageId } = await response.json();
        await saveAttachment({
          requestId,
          storageId,
          fileName: file.name,
          contentType: file.type || undefined,
          fileSize: file.size,
        });
      }
      setSelectedFiles([]);
      return true;
    } catch (err) {
      window.alert(
        err instanceof Error
          ? `${err.message}. Заявка уже создана, файл можно прикрепить в карточке.`
          : "Заявка уже создана, но часть файлов не загрузилась. Их можно прикрепить в карточке.",
      );
      return false;
    } finally {
      setUploadingFiles(false);
    }
  }

  async function submitRequest(submit: boolean) {
    setError(null);
    setShowValidationErrors(true);
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
        throw new Error("Дедлайн согласования должен быть не позже даты, когда нужно оплатить");
      }
      if (category === "Welcome-бонус" && !investmentReturn.trim()) {
        throw new Error("Укажите, как будем возвращать инвестиции");
      }
      if (paidByError) {
        throw new Error(paidByError);
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
      const id = await createRequest({
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
        paymentMethod:
          category === "Welcome-бонус"
            ? undefined
            : paymentMethod || undefined,
        contacts: category === "Конкурсное задание" || isServiceCategory ? [] : contactsList,
        relatedRequests: relatedRequestsList,
        links: [],
        specialists: category === "Конкурсное задание" ? specialistsPayload : undefined,
        financePlanLinks:
          category === "Конкурсное задание" ||
          category === "Welcome-бонус" ||
          isServiceCategory
            ? undefined
            : financeLinksList.length
              ? financeLinksList
              : undefined,
        incomingAmount:
          isClientTransitCategory && incomingAmount
            ? parseMoneyInput(incomingAmount)
            : undefined,
        shipmentMonth:
          isClientTransitCategory && shipmentDate
            ? shipmentDate.slice(0, 7)
            : undefined,
        approvalDeadline: approvalDeadline ? new Date(approvalDeadline).getTime() : undefined,
        neededBy: neededBy ? new Date(neededBy).getTime() : undefined,
        paidBy:
          isClientTransitCategory && paidBy
            ? new Date(paidBy).getTime()
            : undefined,
        requiredRoles,
        submit,
      } as any);
      await uploadQueuedFiles(id);
      router.push(`/requests/${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать заявку";
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
          <AppHeader title="Новая заявка" />
          <Card className="w-full border-amber-400 ring-2 ring-amber-300/70 shadow-[0_10px_30px_rgba(217,119,6,0.08)]">
            <CardHeader>
              <CardTitle>Новая заявка</CardTitle>
              <CardDescription>Запрос на представительские расходы.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel required>Категория</FieldLabel>
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
                    <FieldLabel required>Источник финансирования</FieldLabel>
                    <Select value={fundingSource} onValueChange={setFundingSource}>
                      <SelectTrigger aria-invalid={fundingError ? true : undefined}>
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
                  <FieldLabel htmlFor="title" required>
                    На что нужен бюджет
                  </FieldLabel>
                  <Input
                    id="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    aria-invalid={titleInvalid ? true : undefined}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <FieldLabel htmlFor="clientName" required>
                    {isServiceCategory ? "Получатель сервиса" : "Клиент"}
                  </FieldLabel>
                  {isServiceCategory ? (
                    <p className="text-xs text-muted-foreground">
                      Имя сотрудника или наименование отдела
                    </p>
                  ) : null}
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    aria-invalid={clientNameInvalid ? true : undefined}
                    required
                  />
                </div>
              </div>

              {category === "Конкурсное задание" ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Для конкурсного задания сначала укажите внутренних специалистов и подрядчиков.
                    Общая сумма соберется из их прямых затрат автоматически.
                  </p>
                  <ContestParticipantsEditor
                    addLabel="+ Добавить внутреннего специалиста"
                    emptyNamePlaceholder="Специалист"
                    label="Внутренние специалисты"
                    rows={internalSpecialists}
                    setRows={setInternalSpecialists}
                  />
                  <ContestParticipantsEditor
                    addLabel="+ Добавить подрядчика"
                    emptyNamePlaceholder="Подрядчик"
                    label="Подрядчики"
                    rows={contractors}
                    setRows={setContractors}
                  />
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.24fr)_minmax(0,0.34fr)]">
                <div className="space-y-2">
                  <FieldLabel htmlFor="amount" required>
                    Сумма без НДС
                  </FieldLabel>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    value={contestHasSpecialists ? String(contestAmount) : amount}
                    onChange={(event) => {
                      const nextAmount = sanitizeNumericInput(event.target.value);
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
                    aria-invalid={amountInvalid ? true : undefined}
                    disabled={contestHasSpecialists}
                  />
                  {contestHasSpecialists ? (
                    <p className="text-xs text-muted-foreground">
                      Сумма без НДС считается автоматически по прямым затратам внутренних специалистов и подрядчиков.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="amountWithVat" required>
                    Сумма с НДС
                  </FieldLabel>
                  <Input
                    id="amountWithVat"
                    type="text"
                    inputMode="decimal"
                    value={amountWithVat}
                    onChange={(event) => {
                      const nextAmountWithVat = sanitizeNumericInput(event.target.value);
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
                    aria-invalid={amountInvalid ? true : undefined}
                    disabled={contestHasSpecialists}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="vatRate">НДС</FieldLabel>
                  <Input
                    id="vatRate"
                    type="text"
                    inputMode="decimal"
                    className="w-full max-w-24"
                    value={vatRate}
                    onChange={(event) => {
                      const nextVatRate = sanitizeNumericInput(event.target.value);
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
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="currency" required>
                    Валюта
                  </FieldLabel>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="Валюта" />
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
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Введите ту сумму, которую знаете. НДС рассчитается автоматически в соответствии с указанным процентом.
                </p>
                <p className="text-xs text-muted-foreground sm:col-span-2 sm:text-right">
                  По умолчанию {DEFAULT_VAT_RATE}%. Если поле пустое, считаем 0%.
                </p>
              </div>

              {showCounterparty && (
                <div className="space-y-2">
                  <FieldLabel htmlFor="counterparty" required>
                    Кому платим мы
                  </FieldLabel>
                  <Input
                    id="counterparty"
                    value={counterparty}
                    onChange={(event) => setCounterparty(event.target.value)}
                    aria-invalid={counterpartyInvalid ? true : undefined}
                    required
                  />
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                {showPaymentMethod ? (
                  <div className="space-y-2">
                    <FieldLabel htmlFor="paymentMethod" required={isPaymentMethodRequired}>
                      Способ оплаты
                    </FieldLabel>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger id="paymentMethod" aria-invalid={paymentMethodInvalid ? true : undefined}>
                        <SelectValue placeholder="Выберите способ оплаты" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethodOptions.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {category !== "Конкурсное задание" && !isServiceCategory ? (
                  <div className={`space-y-2 ${showPaymentMethod ? "sm:col-span-2" : "sm:col-span-3"}`}>
                    <Label htmlFor="contacts">Контакты клиента</Label>
                    <Textarea
                      id="contacts"
                      value={contacts}
                      onChange={(event) => setContacts(event.target.value)}
                      rows={3}
                    />
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor="justification" required>
                  Обоснование
                </FieldLabel>
                <Textarea
                  id="justification"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  aria-invalid={justificationInvalid ? true : undefined}
                  rows={4}
                  required
                />
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor="details">Детали заявки</FieldLabel>
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
                  <FieldLabel htmlFor="investmentReturn" required>
                    Как будем возвращать инвестиции
                  </FieldLabel>
                  <Textarea
                    id="investmentReturn"
                    value={investmentReturn}
                    onChange={(event) => setInvestmentReturn(event.target.value)}
                    aria-invalid={investmentReturnInvalid ? true : undefined}
                    rows={3}
                    required
                  />
                </div>
              )}

              {fundingSource === "Отгрузки проекта" ? (
                <div className="space-y-2">
                  <FieldLabel htmlFor="financeLinks" required={financeLinksRequired}>
                    ID и название отгрузки в финплане (по одной в строке)
                  </FieldLabel>
                  <Textarea
                    id="financeLinks"
                    value={financeLinks}
                    onChange={(event) => setFinanceLinks(event.target.value)}
                    aria-invalid={financeLinksInvalid ? true : undefined}
                    rows={3}
                  />
                </div>
              ) : null}

              {isClientTransitCategory ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel htmlFor="incomingAmount">Сколько платят нам</FieldLabel>
                    <Input
                      id="incomingAmount"
                      type="text"
                      inputMode="decimal"
                      value={incomingAmount}
                      onChange={(event) => setIncomingAmount(sanitizeNumericInput(event.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="incomingRatio">Какой Х</FieldLabel>
                    <Input
                      id="incomingRatio"
                      value={incomingRatioValue}
                      readOnly
                      disabled
                      tabIndex={-1}
                      className="pointer-events-none max-w-28 bg-muted/40 text-center font-medium text-foreground disabled:opacity-100"
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="shipmentDate">Месяц отгрузки</FieldLabel>
                    <Input
                      id="shipmentDate"
                      type="date"
                      value={shipmentDate}
                      onChange={(event) => setShipmentDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="paidBy">Когда заплатят нам</FieldLabel>
                    <Input
                      id="paidBy"
                      type="date"
                      value={paidBy}
                      onChange={(event) => setPaidBy(event.target.value)}
                      aria-invalid={paidByError ? true : undefined}
                    />
                    {paidByError ? (
                      <p className="text-xs text-destructive">{paidByError}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                <FieldLabel htmlFor="requestFiles">Прикрепить файлы</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Например, счет в PDF, акт и другие важные документы
                </p>
                <input
                  id="requestFiles"
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS.join(",")}
                  onChange={(event) => queueFiles(Array.from(event.target.files ?? []))}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                    queueFiles(Array.from(event.dataTransfer.files ?? []));
                  }}
                  className={`flex min-h-20 w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                    isDragOver
                      ? "border-emerald-500 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.08)]"
                      : "border-border bg-background hover:border-emerald-400 hover:bg-emerald-50/50"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                      <Paperclip className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block font-medium">
                        {isDragOver
                          ? "Отпустите файлы, чтобы добавить"
                          : uploadingFiles
                            ? "Загружаем файлы"
                            : "Нажмите или перетащите файлы сюда"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        PDF, Office, изображения · до 40 МБ на файл · до 20 файлов
                      </span>
                    </span>
                  </span>
                  <Upload className="h-4 w-4 text-muted-foreground" />
                </button>
                {selectedFiles.length ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {selectedFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <span>
                          {file.name} · {formatRequestAttachmentSize(file.size)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
                          }
                        >
                          Удалить
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {fileActionError ? <p className="text-sm text-destructive">{fileActionError}</p> : null}
              </div>
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

              <div className="space-y-2">
                <button
                  type="button"
                  className="text-sm font-medium text-left"
                  onClick={() => setRelatedRequestsExpanded((current) => !current)}
                  aria-expanded={relatedRequestsExpanded}
                >
                  {relatedRequestsExpanded ? "▾ " : "▸ "}Указать связанные заявки
                </button>
                {relatedRequestsExpanded ? (
                  <Textarea
                    id="relatedRequests"
                    value={relatedRequests}
                    onChange={(event) => setRelatedRequests(event.target.value)}
                    placeholder="Например, WB_QS_00012 или https://..."
                    rows={3}
                  />
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabel htmlFor="approvalDeadline" required>
                    Дедлайн согласования
                  </FieldLabel>
                  <Input
                    id="approvalDeadline"
                    type="date"
                    value={approvalDeadline}
                    onChange={(event) => setApprovalDeadline(event.target.value)}
                    aria-invalid={approvalDeadlineInvalid ? true : undefined}
                    min={minDateValue}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="neededBy" required>
                    Когда нужно оплатить
                  </FieldLabel>
                  <Input
                    id="neededBy"
                    type="date"
                    value={neededBy}
                    onChange={(event) => setNeededBy(event.target.value)}
                    aria-invalid={neededByInvalid ? true : undefined}
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

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => submitRequest(false)}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  Сохранить черновик
                </Button>
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  Отправить на согласование
                </Button>
              </div>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
