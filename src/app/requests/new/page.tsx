"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import FieldLabel from "@/components/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverHint } from "@/components/ui/hover-hint";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import ContestParticipantsEditor, {
  ContestParticipantDraft,
  createContestParticipantDraft,
} from "@/components/contest-participants-editor";
import { api } from "@/lib/convex";
import {
  AUTO_ONLY_REQUIRED_ROLES,
  CURRENCIES,
  DEFAULT_REQUIRED_ROLES,
  FUNDING_SOURCES,
  getCategoriesForDepartment,
  ROLE_OPTIONS,
  type RequestArea,
  type RoleOption,
} from "@/lib/constants";
import {
  getAutoRequiredHodDepartmentsForRequest,
  getAutoRequiredRolesForRequest,
} from "@/lib/approvalRules";
import { getRoleLabel } from "@/lib/roleLabels";
import {
  calculateIncomingRatio,
  formatIncomingRatio,
  getPaymentMethodOptions,
  getSpecialistEffectiveCost,
  isPaidByDateAllowed,
} from "@/lib/requestFields";
import {
  AI_TOOLS_FUNDING_SOURCE,
  getDefaultFundingSourceForCategory,
  getEnforcedRolesForFundingSource,
  isAiToolsRequestCategory,
  isFundingSourceAllowedForCategory,
  isHodSelectableCategory,
  isServiceRecipientCategory,
  supportsRequestSpecialists,
  usesServiceRecipientLabel,
} from "@/lib/requestRules";
import {
  FINANCE_LEGAL_DEPARTMENT,
  HOD_APPROVAL_DEPARTMENTS,
  normalizeHodDepartment,
} from "@/lib/departments";
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
  const profile = useQuery(api.roles.myProfile);
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const minApprovalDateValue = useMemo(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    return next.toISOString().slice(0, 10);
  }, [today]);
  const minNeededByDateValue = useMemo(() => {
    const date = new Date(today);
    date.setDate(1);
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().slice(0, 10);
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

  const [requestArea, setRequestArea] = useState<RequestArea>("Аккаунтинг");
  const [category, setCategory] = useState("Welcome-бонус");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [amountWithVat, setAmountWithVat] = useState("");
  const [vatRate, setVatRate] = useState(String(DEFAULT_VAT_RATE));
  const [vatInputSource, setVatInputSource] = useState<VatAmountSource>("without");
  const [currency, setCurrency] = useState("RUB");
  const [fundingSource, setFundingSource] = useState("Квоты AGIMA");
  const [justification, setJustification] = useState("");
  const [investmentReturn, setInvestmentReturn] = useState("");
  const [clientName, setClientName] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [contractLink, setContractLink] = useState("");
  const [dueDiligenceChecked, setDueDiligenceChecked] = useState(false);
  const [dueDiligenceJiraLink, setDueDiligenceJiraLink] = useState("");
  const [prepaymentRequired, setPrepaymentRequired] = useState(false);
  const [prepaymentAmount, setPrepaymentAmount] = useState("");
  const [prepaymentAmountWithVat, setPrepaymentAmountWithVat] = useState("");
  const [prepaymentVatInputSource, setPrepaymentVatInputSource] = useState<VatAmountSource>("without");
  const [prepaymentDate, setPrepaymentDate] = useState("");
  const [relatedRequests, setRelatedRequests] = useState("");
  const [relatedRequestsExpanded, setRelatedRequestsExpanded] = useState(false);
  const [internalSpecialists, setInternalSpecialists] = useState<ContestParticipantDraft[]>([
    createContestParticipantDraft(),
  ]);
  const [contractors, setContractors] = useState<ContestParticipantDraft[]>([
    createContestParticipantDraft(),
  ]);
  const [financeLinks, setFinanceLinks] = useState("");
  const [finplanEntered, setFinplanEntered] = useState(false);
  const [finplanEntryIds, setFinplanEntryIds] = useState("");
  const [incomingAmount, setIncomingAmount] = useState("");
  const [incomingAmountWithVat, setIncomingAmountWithVat] = useState("");
  const [incomingVatInputSource, setIncomingVatInputSource] = useState<VatAmountSource>("without");
  const [shipmentDate, setShipmentDate] = useState("");
  const [approvalDeadline, setApprovalDeadline] = useState(defaultDeadline);
  const [neededBy, setNeededBy] = useState(defaultDeadline);
  const [paymentDeadline, setPaymentDeadline] = useState(defaultDeadline);
  const [paidBy, setPaidBy] = useState("");
  const [requiredRoles, setRequiredRoles] = useState<RoleOption[]>([...DEFAULT_REQUIRED_ROLES]);
  const [requiredHodDepartments, setRequiredHodDepartments] = useState<string[]>([FINANCE_LEGAL_DEPARTMENT]);
  const [error, setError] = useState<string | null>(null);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedContractFiles, setSelectedContractFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isContractDragOver, setIsContractDragOver] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contractFileInputRef = useRef<HTMLInputElement | null>(null);
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
  const wrappedSelectTriggerClass =
    "h-auto min-h-11 w-full whitespace-normal px-3 py-2 text-left *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:pr-6 *:data-[slot=select-value]:whitespace-normal *:data-[slot=select-value]:break-words *:data-[slot=select-value]:leading-snug";
  const headerFieldLabelClass = "min-h-11 items-start leading-snug";
  const isServiceCategory = useMemo(() => isServiceRecipientCategory(category), [category]);
  const usesServiceRecipient = useMemo(() => usesServiceRecipientLabel(category), [category]);
  const requestSupportsSpecialists = useMemo(() => supportsRequestSpecialists(category), [category]);
  const isWelcomeBonus = category === "Welcome-бонус";
  const selectedDepartment = requestArea;
  const categoryOptions = useMemo(
    () => getCategoriesForDepartment(selectedDepartment),
    [selectedDepartment],
  );
  const showTransitFields = fundingSource === "Отгрузки проекта";
  const paymentMethodOptions = useMemo(() => getPaymentMethodOptions(category), [category]);
  const paidByError = useMemo(
    () => (paidBy && !isPaidByDateAllowed(paidBy) ? "AGIMA тогда еще не было" : null),
    [paidBy],
  );
  const showPaymentMethod = !isWelcomeBonus;
  const isPaymentMethodRequired =
    !isWelcomeBonus && category !== "Конкурсное задание";
  const showCounterparty =
    category !== "Конкурсное задание" &&
    !isWelcomeBonus &&
    !isServiceCategory;
  const financeLinksRequired = fundingSource === "Отгрузки проекта";

  useEffect(() => {
    const profileDepartment = normalizeHodDepartment(profile?.department ?? undefined);
    if (!profileDepartment || profileDepartment === requestArea) {
      return;
    }
    handleRequestAreaChange(profileDepartment as RequestArea);
  }, [profile?.department]);
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
        contractorTypes: item.contractorTypes,
        department: item.department || undefined,
        hours: parseMoneyInput(item.hours),
        directCost: parseMoneyInput(item.directCost),
        taxAmount: parseMoneyInput(item.taxAmount),
        taxUnknown: item.taxUnknown,
        amountIncludesTaxes: item.amountIncludesTaxes,
        amountExcludesTaxes: item.amountExcludesTaxes,
        hodConfirmed: item.validationSkipped ? true : item.hodConfirmed ?? false,
        buhConfirmed: item.validationSkipped ? true : item.buhConfirmed ?? false,
        validationSkipped: item.validationSkipped,
      })),
    [contractors, internalSpecialists],
  );
  const requestHasSpecialists = useMemo(
    () =>
      requestSupportsSpecialists &&
      specialistsPayload.some(
        (item) =>
          item.name ||
          item.department ||
          item.hours !== undefined ||
          item.directCost !== undefined ||
          item.taxAmount !== undefined ||
          (item.contractorTypes?.length ?? 0) > 0 ||
          item.taxUnknown ||
          item.amountIncludesTaxes ||
          item.amountExcludesTaxes,
      ),
    [requestSupportsSpecialists, specialistsPayload],
  );
  const specialistAmount = useMemo(
    () =>
      specialistsPayload.reduce((sum, item) => sum + getSpecialistEffectiveCost(item), 0),
    [specialistsPayload],
  );
  const autoRequiredHodDepartments = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(requestSupportsSpecialists
              ? specialistsPayload
                  .filter((item) => item.sourceType === "internal" && item.department && !item.validationSkipped)
                  .map((item) => item.department as string)
              : []),
            ...getAutoRequiredHodDepartmentsForRequest({
              category,
              specialists: specialistsPayload,
            }),
          ].filter((department): department is string => Boolean(department)),
        ),
      ),
    [category, requestSupportsSpecialists, specialistsPayload],
  );
  const effectiveRequiredHodDepartments = useMemo(
    () =>
      Array.from(
        new Set(
          [...requiredHodDepartments, ...autoRequiredHodDepartments].filter(
            (department): department is string => Boolean(department),
          ),
        ),
      ),
    [autoRequiredHodDepartments, requiredHodDepartments],
  );
  const effectiveAmountWithoutVatInput = useMemo(
    () =>
      requestHasSpecialists
        ? specialistAmount
        : parseMoneyInput(amount),
    [amount, requestHasSpecialists, specialistAmount],
  );
  const financeLinksList = useMemo(
    () =>
      financeLinks
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [financeLinks],
  );
  const finplanEntryIdsList = useMemo(
    () =>
      finplanEntryIds
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [finplanEntryIds],
  );

  const enforcedRoles = useMemo(() => {
    const roles = new Set<RoleOption>(getEnforcedRolesForFundingSource(fundingSource) as RoleOption[]);
    getAutoRequiredRolesForRequest({ category }).forEach((role) => roles.add(role as RoleOption));
    return roles;
  }, [category, fundingSource]);
  const displayedRoleOptions = useMemo(() => {
    const roles = new Set<RoleOption>(ROLE_OPTIONS);
    enforcedRoles.forEach((role) => roles.add(role));
    return Array.from(roles);
  }, [enforcedRoles]);
  const resolvedIncomingAmountsPreview = useMemo(
    () =>
      resolveVatAmounts({
        amountWithoutVat: parseMoneyInput(incomingAmount),
        amountWithVat: parseMoneyInput(incomingAmountWithVat),
        vatRate: parseVatRateInput(vatRate),
        autoCalculateAmountWithVat: true,
      }),
    [incomingAmount, incomingAmountWithVat, vatRate],
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
  const resolvedPrepaymentAmountsPreview = useMemo(
    () =>
      resolveVatAmounts({
        amountWithoutVat: parseMoneyInput(prepaymentAmount),
        amountWithVat: parseMoneyInput(prepaymentAmountWithVat),
        vatRate: parseVatRateInput(vatRate),
        autoCalculateAmountWithVat: true,
      }),
    [prepaymentAmount, prepaymentAmountWithVat, vatRate],
  );
  const needsContract =
    (resolvedAmountsPreview.amountWithoutVat ?? 0) > 100_000 &&
    category !== "Welcome-бонус" &&
    category !== "Конкурсное задание";
  const needsDueDiligence =
    (resolvedAmountsPreview.amountWithoutVat ?? 0) > 500_000 &&
    category !== "Welcome-бонус" &&
    category !== "Конкурсное задание";
  const incomingRatioValue = useMemo(
    () =>
      formatIncomingRatio(
        calculateIncomingRatio({
          incomingAmount: resolvedIncomingAmountsPreview.amountWithoutVat,
          incomingAmountWithVat: resolvedIncomingAmountsPreview.amountWithVat,
          amountWithoutVat: resolvedAmountsPreview.amountWithoutVat,
          amountWithVat: resolvedAmountsPreview.amountWithVat,
        }),
      ),
    [
      resolvedIncomingAmountsPreview.amountWithoutVat,
      resolvedIncomingAmountsPreview.amountWithVat,
      resolvedAmountsPreview.amountWithoutVat,
      resolvedAmountsPreview.amountWithVat,
    ],
  );
  const titleInvalid = showValidationErrors && !title.trim();
  const categoryInvalid = showValidationErrors && !category;
  const departmentInvalid = showValidationErrors && !selectedDepartment;
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
    showValidationErrors && isWelcomeBonus && !investmentReturn.trim();
  const financeLinksInvalid = showValidationErrors && financeLinksRequired && financeLinksList.length === 0;
  const incomingAmountsInvalid =
    showValidationErrors &&
    showTransitFields &&
    (!resolvedIncomingAmountsPreview.amountWithoutVat || !resolvedIncomingAmountsPreview.amountWithVat);
  const contractInvalid =
    showValidationErrors &&
    needsContract &&
    !contractLink.trim() &&
    selectedContractFiles.length === 0;
  const dueDiligenceInvalid =
    showValidationErrors &&
    needsDueDiligence &&
    (!dueDiligenceChecked || !dueDiligenceJiraLink.trim());
  const prepaymentInvalid =
    showValidationErrors &&
    prepaymentRequired &&
    (!resolvedPrepaymentAmountsPreview.amountWithoutVat ||
      !resolvedPrepaymentAmountsPreview.amountWithVat ||
      resolvedPrepaymentAmountsPreview.amountWithoutVat <= 0 ||
      resolvedPrepaymentAmountsPreview.amountWithVat <= 0 ||
      !prepaymentDate);
  const approvalDeadlineInvalid = showValidationErrors && !approvalDeadline;
  const neededByInvalid = showValidationErrors && !isWelcomeBonus && !neededBy;
  const paymentDeadlineInvalid = showValidationErrors && !isWelcomeBonus && !paymentDeadline;
  const hodDepartmentsInvalid =
    showValidationErrors &&
    requiredRoles.includes("HOD") &&
    isHodSelectableCategory(category) &&
    effectiveRequiredHodDepartments.length === 0;
  const hasBlockingValidationErrors =
    !title.trim() ||
    !category ||
    !selectedDepartment ||
    !clientName.trim() ||
    !resolvedAmountsPreview.amountWithoutVat ||
    !resolvedAmountsPreview.amountWithVat ||
    resolvedAmountsPreview.amountWithoutVat <= 0 ||
    resolvedAmountsPreview.amountWithVat <= 0 ||
    (showCounterparty && !counterparty.trim()) ||
    (isPaymentMethodRequired && !paymentMethod) ||
    !justification.trim() ||
    (isWelcomeBonus && !investmentReturn.trim()) ||
    (financeLinksRequired && financeLinksList.length === 0) ||
    (showTransitFields &&
      (!resolvedIncomingAmountsPreview.amountWithoutVat ||
        !resolvedIncomingAmountsPreview.amountWithVat)) ||
    (needsContract && !contractLink.trim() && selectedContractFiles.length === 0) ||
    (needsDueDiligence && (!dueDiligenceChecked || !dueDiligenceJiraLink.trim())) ||
    (prepaymentRequired &&
      (!resolvedPrepaymentAmountsPreview.amountWithoutVat ||
        !resolvedPrepaymentAmountsPreview.amountWithVat ||
        resolvedPrepaymentAmountsPreview.amountWithoutVat <= 0 ||
        resolvedPrepaymentAmountsPreview.amountWithVat <= 0 ||
        !prepaymentDate)) ||
    (requiredRoles.includes("HOD") &&
      isHodSelectableCategory(category) &&
      effectiveRequiredHodDepartments.length === 0) ||
    !approvalDeadline ||
    (!isWelcomeBonus && !neededBy) ||
    (!isWelcomeBonus && !paymentDeadline) ||
    Boolean(fundingError) ||
    Boolean(paidByError);

  useEffect(() => {
    setRequiredRoles((current) => {
      const next = new Set(
        current.filter(
          (role) =>
            !(AUTO_ONLY_REQUIRED_ROLES as readonly string[]).includes(role) ||
            enforcedRoles.has(role),
        ),
      );
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
    if (!requestHasSpecialists) {
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
  }, [amountWithVat, requestHasSpecialists, effectiveAmountWithoutVatInput, vatInputSource, vatRate]);

  useEffect(() => {
    if (autoRequiredHodDepartments.length === 0) {
      return;
    }
    setRequiredRoles((current) => (current.includes("HOD") ? current : [...current, "HOD"]));
  }, [autoRequiredHodDepartments]);

  function handleRequestAreaChange(nextArea: RequestArea) {
    setRequestArea(nextArea);
    const nextCategory = getCategoriesForDepartment(nextArea)[0];
    setCategory(nextCategory);
    const defaultFundingSource = getDefaultFundingSourceForCategory(nextCategory);
    if (defaultFundingSource) {
      setFundingSource(defaultFundingSource);
    }
    if (!isHodSelectableCategory(nextCategory)) {
      setRequiredRoles((current) => current.filter((role) => role !== "HOD"));
      setRequiredHodDepartments([]);
    }
  }

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    const defaultFundingSource = getDefaultFundingSourceForCategory(nextCategory);
    if (defaultFundingSource) {
      setFundingSource(defaultFundingSource);
    }
    if (nextCategory === "Welcome-бонус") {
      setPaymentMethod("");
    }
    if (!isHodSelectableCategory(nextCategory)) {
      setRequiredRoles((current) => current.filter((role) => role !== "HOD"));
      setRequiredHodDepartments([]);
    }
  }

  function toggleRole(role: RoleOption) {
    if (enforcedRoles.has(role)) {
      return;
    }
    setRequiredRoles((current) => {
      const isRemoving = current.includes(role);
      if (role === "HOD" && isRemoving) {
        setRequiredHodDepartments([]);
      }
      if (role === "HOD" && !isRemoving) {
        setRequiredHodDepartments((departments) =>
          departments.length ? departments : [FINANCE_LEGAL_DEPARTMENT],
        );
      }
      return isRemoving ? current.filter((item) => item !== role) : [...current, role];
    });
  }

  function queueFiles(files: File[], type: "general" | "contract" = "general") {
    if (!files.length) {
      return;
    }
    setFileActionError(null);
    const currentCount = selectedFiles.length + selectedContractFiles.length;
    if (currentCount + files.length > MAX_REQUEST_ATTACHMENTS) {
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
    if (type === "contract") {
      setSelectedContractFiles((current) => [...current, ...files]);
    } else {
      setSelectedFiles((current) => [...current, ...files]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (contractFileInputRef.current) {
      contractFileInputRef.current.value = "";
    }
  }

  async function uploadQueuedFiles(requestId: any) {
    const filesToUpload = [
      ...selectedFiles.map((file) => ({ file, attachmentType: "general" as const })),
      ...selectedContractFiles.map((file) => ({ file, attachmentType: "contract" as const })),
    ];
    if (!filesToUpload.length) {
      return true;
    }
    setUploadingFiles(true);
    try {
      for (const { file, attachmentType } of filesToUpload) {
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
          attachmentType,
        });
      }
      setSelectedFiles([]);
      setSelectedContractFiles([]);
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
    if (hasBlockingValidationErrors) {
      return;
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
      if (isWelcomeBonus && !investmentReturn.trim()) {
        throw new Error("Укажите, как будем возвращать инвестиции");
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
      const resolvedPrepaymentAmounts = resolveVatAmounts({
        amountWithoutVat: parseMoneyInput(prepaymentAmount),
        amountWithVat: parseMoneyInput(prepaymentAmountWithVat),
        vatRate: parseVatRateInput(vatRate),
        autoCalculateAmountWithVat: true,
      });
      const id = await createRequest({
        requestArea,
        department: normalizeHodDepartment(selectedDepartment),
        title,
        category,
        amount: resolvedAmounts.amountWithoutVat,
        amountWithVat: resolvedAmounts.amountWithVat,
        vatRate: resolvedAmounts.vatRate,
        currency,
        fundingSource,
        justification,
        investmentReturn: investmentReturn.trim() || undefined,
        clientName,
        counterparty:
          category === "Конкурсное задание" ||
          isWelcomeBonus ||
          isServiceCategory
            ? ""
            : counterparty,
        paymentMethod:
          isWelcomeBonus
            ? undefined
            : paymentMethod || undefined,
        contractLink: contractLink.trim() || undefined,
        pendingContractFileCount: selectedContractFiles.length,
        dueDiligenceChecked,
        dueDiligenceJiraLink: dueDiligenceJiraLink.trim() || undefined,
        prepaymentRequired,
        prepaymentAmount:
          prepaymentRequired && resolvedPrepaymentAmounts.amountWithoutVat !== undefined
            ? resolvedPrepaymentAmounts.amountWithoutVat
            : undefined,
        prepaymentAmountWithVat:
          prepaymentRequired && resolvedPrepaymentAmounts.amountWithVat !== undefined
            ? resolvedPrepaymentAmounts.amountWithVat
            : undefined,
        prepaymentDate:
          prepaymentRequired && prepaymentDate
            ? new Date(`${prepaymentDate}T00:00:00`).getTime()
            : undefined,
        contacts: [],
        relatedRequests: relatedRequestsList,
        links: [],
        specialists: requestSupportsSpecialists ? specialistsPayload : undefined,
        financePlanLinks:
          showTransitFields && financeLinksList.length
            ? financeLinksList
            : undefined,
        finplanEntered,
        finplanEntryIds: finplanEntryIdsList.length ? finplanEntryIdsList : undefined,
        incomingAmount:
          showTransitFields && resolvedIncomingAmountsPreview.amountWithoutVat !== undefined
            ? resolvedIncomingAmountsPreview.amountWithoutVat
            : undefined,
        incomingAmountWithVat:
          showTransitFields && resolvedIncomingAmountsPreview.amountWithVat !== undefined
            ? resolvedIncomingAmountsPreview.amountWithVat
            : undefined,
        shipmentDate:
          showTransitFields && shipmentDate
            ? new Date(`${shipmentDate}T00:00:00`).getTime()
            : undefined,
        shipmentMonth:
          showTransitFields && shipmentDate
            ? shipmentDate.slice(0, 7)
            : undefined,
        approvalDeadline: approvalDeadline ? new Date(approvalDeadline).getTime() : undefined,
        neededBy: !isWelcomeBonus && neededBy ? new Date(neededBy).getTime() : undefined,
        paymentDeadline: !isWelcomeBonus && paymentDeadline ? new Date(paymentDeadline).getTime() : undefined,
        paidBy:
          showTransitFields && paidBy
            ? new Date(`${paidBy}T00:00:00`).getTime()
            : undefined,
        requiredRoles,
        requiredHodDepartments:
          effectiveRequiredHodDepartments.length ? effectiveRequiredHodDepartments : undefined,
        submit,
      } as any);
      await uploadQueuedFiles(id);
      router.push(`/requests/${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать заявку";
      if (message === "Так не бывает") {
        setError("Выбран неверный источник финансирования или тип заявки");
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
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={handleSubmit} noValidate>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <FieldLabel required className={headerFieldLabelClass}>Цех</FieldLabel>
                    <Input
                      value={selectedDepartment}
                      readOnly
                      aria-invalid={departmentInvalid ? true : undefined}
                      className="h-auto min-h-11 whitespace-normal bg-muted/30 px-3 py-2"
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel required className={headerFieldLabelClass}>Тип заявки</FieldLabel>
                    <Select value={category} onValueChange={handleCategoryChange}>
                      <SelectTrigger
                        className={wrappedSelectTriggerClass}
                        aria-invalid={categoryInvalid ? true : undefined}
                      >
                        <SelectValue placeholder="Выберите тип заявки" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions.map((item) => (
                          <SelectItem key={item} value={item} className="whitespace-normal">
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel required className={headerFieldLabelClass}>Источник финансирования</FieldLabel>
                    <Select value={fundingSource} onValueChange={setFundingSource}>
                      <SelectTrigger
                        className={wrappedSelectTriggerClass}
                        aria-invalid={fundingError ? true : undefined}
                      >
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
                  />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <FieldLabel htmlFor="clientName" required>
                    {usesServiceRecipient ? "Получатель сервиса" : "Клиент"}
                  </FieldLabel>
                  {usesServiceRecipient ? (
                    <p className="text-xs text-muted-foreground">
                      Имя сотрудника или наименование отдела
                    </p>
                  ) : null}
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                    aria-invalid={clientNameInvalid ? true : undefined}
                  />
                </div>
              </div>

              {requestSupportsSpecialists ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Добавьте штатных специалистов и подрядчиков/поставщиков, если затрата связана с ними.
                    Общая сумма соберется из прямых затрат и налогов автоматически.
                  </p>
                  <ContestParticipantsEditor
                    addLabel="+ Добавить штатного специалиста"
                    emptyNamePlaceholder="Специалист"
                    label="Штатные специалисты"
                    rows={internalSpecialists}
                    setRows={setInternalSpecialists}
                  />
                  <ContestParticipantsEditor
                    addLabel="+ Добавить подрядчика/поставщика"
                    emptyNamePlaceholder="Подрядчик или поставщик"
                    label="Подрядчики/поставщики"
                    description="Если добавлены подрядчики или поставщики, сумма заявки считается из их сумм."
                    rows={contractors}
                    setRows={setContractors}
                    showContractorTypes
                  />
                </div>
              ) : null}

              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.24fr)_minmax(0,0.34fr)]">
                <div className="space-y-2">
                  <FieldLabel htmlFor="amount" required>
                    Сумма без НДС
                  </FieldLabel>
                  <Input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    value={requestHasSpecialists ? String(specialistAmount) : amount}
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
                    disabled={requestHasSpecialists}
                  />
                  {requestHasSpecialists ? (
                    <p className="text-xs text-muted-foreground">
                      Сумма без НДС считается автоматически по прямым затратам и налогам штатных специалистов и подрядчиков.
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
                      if (requestHasSpecialists) {
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
                    disabled={requestHasSpecialists}
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
                      const source = requestHasSpecialists ? "without" : vatInputSource;
                      const synced = syncVatInputPair({
                        amountWithoutVatInput:
                          requestHasSpecialists
                            ? effectiveAmountWithoutVatInput !== undefined
                              ? String(effectiveAmountWithoutVatInput)
                              : ""
                            : amount,
                        amountWithVatInput: amountWithVat,
                        vatRateInput: nextVatRate,
                        source,
                      });
                      if (!requestHasSpecialists) {
                        setAmount(synced.amountWithoutVatInput);
                      }
                      setAmountWithVat(synced.amountWithVatInput);
                      const syncedIncoming = syncVatInputPair({
                        amountWithoutVatInput: incomingAmount,
                        amountWithVatInput: incomingAmountWithVat,
                        vatRateInput: nextVatRate,
                        source: incomingVatInputSource,
                      });
                      setIncomingAmount(syncedIncoming.amountWithoutVatInput);
                      setIncomingAmountWithVat(syncedIncoming.amountWithVatInput);
                      const syncedPrepayment = syncVatInputPair({
                        amountWithoutVatInput: prepaymentAmount,
                        amountWithVatInput: prepaymentAmountWithVat,
                        vatRateInput: nextVatRate,
                        source: prepaymentVatInputSource,
                      });
                      setPrepaymentAmount(syncedPrepayment.amountWithoutVatInput);
                      setPrepaymentAmountWithVat(syncedPrepayment.amountWithVatInput);
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
                <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2">
                  Введите ту сумму, которую знаете. НДС рассчитается автоматически в соответствии с указанным процентом.
                </p>
                <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2 sm:text-right">
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
                  />
                </div>
              )}

              {needsContract ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="space-y-1">
                    <FieldLabel required>Договор с контрагентом</FieldLabel>
                    <p className="text-xs text-muted-foreground">
                      Для суммы закупки больше 100 000 без НДС добавьте ссылку на договор или прикрепите файл договора.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contractLink">Ссылка на договор</Label>
                    <Input
                      id="contractLink"
                      value={contractLink}
                      onChange={(event) => setContractLink(event.target.value)}
                      aria-invalid={contractInvalid ? true : undefined}
                      placeholder="https://..."
                    />
                  </div>
                  <input
                    id="contractFiles"
                    ref={contractFileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept={ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS.join(",")}
                    onChange={(event) => queueFiles(Array.from(event.target.files ?? []), "contract")}
                  />
                  <button
                    type="button"
                    onClick={() => contractFileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsContractDragOver(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setIsContractDragOver(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsContractDragOver(false);
                      queueFiles(Array.from(event.dataTransfer.files ?? []), "contract");
                    }}
                    className={`flex min-h-16 w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      isContractDragOver
                        ? "border-amber-500 bg-amber-50 shadow-[0_0_0_4px_rgba(245,158,11,0.08)]"
                        : contractInvalid
                          ? "border-destructive bg-destructive/5"
                          : "border-border bg-background hover:border-amber-400 hover:bg-amber-50/50"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
                        <Paperclip className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block font-medium">Прикрепить договор файлом</span>
                        <span className="block text-sm text-muted-foreground">PDF, Office, изображения, архивы · до 40 МБ</span>
                      </span>
                    </span>
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {selectedContractFiles.length ? (
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {selectedContractFiles.map((file, index) => (
                        <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                          <span>{file.name} · {formatRequestAttachmentSize(file.size)}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedContractFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))
                            }
                          >
                            Удалить
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {needsDueDiligence ? (
                <div className={`space-y-3 rounded-lg border p-4 ${dueDiligenceInvalid ? "border-destructive bg-destructive/5" : "border-border"}`}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={dueDiligenceChecked}
                      onCheckedChange={(checked) => setDueDiligenceChecked(checked === true)}
                    />
                    Проведена должная осмотрительность
                  </label>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="dueDiligenceJiraLink" required>
                      Ссылка на задачу в Jira
                    </FieldLabel>
                    <Input
                      id="dueDiligenceJiraLink"
                      value={dueDiligenceJiraLink}
                      onChange={(event) => setDueDiligenceJiraLink(event.target.value)}
                      aria-invalid={dueDiligenceInvalid ? true : undefined}
                      placeholder="https://jira..."
                    />
                  </div>
                </div>
              ) : null}

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
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor="justification" required>
                    Обоснование
                  </FieldLabel>
                  <HoverHint label="Можно добавить сюда любые детали по заявке: ссылки, описание предмета закупки и важный контекст.">
                    <button
                      type="button"
                      className="size-5 rounded-full border border-border text-xs text-muted-foreground"
                      aria-label="Подсказка по обоснованию"
                    >
                      ?
                    </button>
                  </HoverHint>
                </div>
                <Textarea
                  id="justification"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  aria-invalid={justificationInvalid ? true : undefined}
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
                  />
                </div>
              )}

              {fundingSource === "Отгрузки проекта" ? (
                <div className="space-y-2">
                  <FieldLabel htmlFor="financeLinks" required={financeLinksRequired}>
                    ID отгрузки в Финплане (по одной в строке)
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

              {showTransitFields ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <FieldLabel required>Сколько платят нам</FieldLabel>
                    <p className="text-xs text-muted-foreground">Сумма отгрузки</p>
                  </div>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.38fr)]">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="incomingAmount" required>
                        Сумма отгрузки без НДС
                      </FieldLabel>
                      <Input
                        id="incomingAmount"
                        type="text"
                        inputMode="decimal"
                        value={incomingAmount}
                        onChange={(event) => {
                          const nextIncomingAmount = sanitizeNumericInput(event.target.value);
                          setIncomingVatInputSource("without");
                          setIncomingAmount(nextIncomingAmount);
                          const synced = syncVatInputPair({
                            amountWithoutVatInput: nextIncomingAmount,
                            amountWithVatInput: incomingAmountWithVat,
                            vatRateInput: vatRate,
                            source: "without",
                          });
                          setIncomingAmountWithVat(synced.amountWithVatInput);
                        }}
                        aria-invalid={incomingAmountsInvalid ? true : undefined}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="incomingAmountWithVat" required>
                        Сумма отгрузки с НДС
                      </FieldLabel>
                      <Input
                        id="incomingAmountWithVat"
                        type="text"
                        inputMode="decimal"
                        value={incomingAmountWithVat}
                        onChange={(event) => {
                          const nextIncomingAmountWithVat = sanitizeNumericInput(event.target.value);
                          setIncomingVatInputSource("with");
                          setIncomingAmountWithVat(nextIncomingAmountWithVat);
                          const synced = syncVatInputPair({
                            amountWithoutVatInput: incomingAmount,
                            amountWithVatInput: nextIncomingAmountWithVat,
                            vatRateInput: vatRate,
                            source: "with",
                          });
                          setIncomingAmount(synced.amountWithoutVatInput);
                        }}
                        aria-invalid={incomingAmountsInvalid ? true : undefined}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="incomingRatio">Коэффициент транзита</FieldLabel>
                      <Input
                        id="incomingRatio"
                        value={incomingRatioValue}
                        readOnly
                        disabled
                        tabIndex={-1}
                        className="pointer-events-none max-w-32 bg-muted/40 text-center font-medium text-foreground disabled:opacity-100"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="shipmentDate">Дата отгрузки по проекту</FieldLabel>
                      <Input
                        id="shipmentDate"
                        type="date"
                        value={shipmentDate}
                        onChange={(event) => setShipmentDate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="paidBy">Когда платят нам</FieldLabel>
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
                </div>
              ) : null}

              <div className="space-y-2">
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
                        PDF, Office, изображения, архивы · до 40 МБ на файл · до 20 файлов
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
              <div className={`space-y-3 rounded-lg border p-4 ${prepaymentInvalid ? "border-destructive bg-destructive/5" : "border-border"}`}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={prepaymentRequired}
                    onCheckedChange={(checked) => setPrepaymentRequired(checked === true)}
                  />
                  Требуется предоплата
                </label>
                <p className="text-xs text-muted-foreground">
                  Укажите сумму предоплаты, если платеж потребуется разделить предоплату и постоплату. Если этого не требуется, поле можно не заполнять
                </p>
                {prepaymentRequired ? (
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                    <div className="space-y-2">
                      <FieldLabel htmlFor="prepaymentAmount" required>
                        Предоплата без НДС
                      </FieldLabel>
                      <Input
                        id="prepaymentAmount"
                        inputMode="decimal"
                        value={prepaymentAmount}
                        aria-invalid={prepaymentInvalid ? true : undefined}
                        onChange={(event) => {
                          const nextAmount = sanitizeNumericInput(event.target.value);
                          setPrepaymentVatInputSource("without");
                          setPrepaymentAmount(nextAmount);
                          const synced = syncVatInputPair({
                            amountWithoutVatInput: nextAmount,
                            amountWithVatInput: prepaymentAmountWithVat,
                            vatRateInput: vatRate,
                            source: "without",
                          });
                          setPrepaymentAmountWithVat(synced.amountWithVatInput);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="prepaymentAmountWithVat" required>
                        Предоплата с НДС
                      </FieldLabel>
                      <Input
                        id="prepaymentAmountWithVat"
                        inputMode="decimal"
                        value={prepaymentAmountWithVat}
                        aria-invalid={prepaymentInvalid ? true : undefined}
                        onChange={(event) => {
                          const nextAmount = sanitizeNumericInput(event.target.value);
                          setPrepaymentVatInputSource("with");
                          setPrepaymentAmountWithVat(nextAmount);
                          const synced = syncVatInputPair({
                            amountWithoutVatInput: prepaymentAmount,
                            amountWithVatInput: nextAmount,
                            vatRateInput: vatRate,
                            source: "with",
                          });
                          setPrepaymentAmount(synced.amountWithoutVatInput);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="prepaymentDate" required>
                        Дата предоплаты
                      </FieldLabel>
                      <Input
                        id="prepaymentDate"
                        type="date"
                        value={prepaymentDate}
                        min={minNeededByDateValue}
                        aria-invalid={prepaymentInvalid ? true : undefined}
                        onChange={(event) => setPrepaymentDate(event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
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

              <div className={`grid gap-4 ${isWelcomeBonus ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
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
                    min={minApprovalDateValue}
                  />
                </div>
                {!isWelcomeBonus ? (
                  <>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="neededBy" required>
                        Дата отгрузки
                      </FieldLabel>
                      <Input
                        id="neededBy"
                        type="date"
                        value={neededBy}
                        onChange={(event) => setNeededBy(event.target.value)}
                        aria-invalid={neededByInvalid ? true : undefined}
                        min={minNeededByDateValue}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel htmlFor="paymentDeadline" required>
                        Дедлайн оплаты
                      </FieldLabel>
                      <Input
                        id="paymentDeadline"
                        type="date"
                        value={paymentDeadline}
                        onChange={(event) => setPaymentDeadline(event.target.value)}
                        aria-invalid={paymentDeadlineInvalid ? true : undefined}
                        min={minNeededByDateValue}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="space-y-3">
                <Label>Обязательные согласующие</Label>
                <div className="grid gap-3 sm:grid-cols-4">
                  {displayedRoleOptions.filter((role) => !enforcedRoles.has(role)).map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={requiredRoles.includes(role)}
                        onCheckedChange={() => toggleRole(role)}
                      />
                      <span>{getRoleLabel(role)}</span>
                    </label>
                  ))}
                </div>
                {displayedRoleOptions.some((role) => enforcedRoles.has(role)) ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
                    <div className="font-medium">Автоматически добавятся</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {displayedRoleOptions
                        .filter((role) => enforcedRoles.has(role))
                        .map((role) => (
                          <span
                            key={role}
                            className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-emerald-800"
                          >
                            {getRoleLabel(role)}
                          </span>
                        ))}
                    </div>
                  </div>
                ) : null}
                {requiredRoles.includes("HOD") && isHodSelectableCategory(category) ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label>Какой руководитель цеха согласует заявку</Label>
                    <p className="text-xs text-muted-foreground">
                      Некоторые цеха добавляются автоматически по типу заявки, подрядчикам или штатным специалистам.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {HOD_APPROVAL_DEPARTMENTS.map((department) => {
                        const isAutoRequired = autoRequiredHodDepartments.includes(department);
                        const checked = effectiveRequiredHodDepartments.includes(department);
                        return (
                          <label key={department} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={isAutoRequired}
                              onCheckedChange={() =>
                                setRequiredHodDepartments((current) =>
                                  current.includes(department)
                                    ? current.filter((item) => item !== department)
                                    : [...current, department],
                                )
                              }
                            />
                            <span>
                              {department}
                              {isAutoRequired ? " · обязателен" : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {hodDepartmentsInvalid ? (
                      <p className="text-xs text-destructive">
                        Выберите хотя бы один цех для руководителя цеха
                      </p>
                    ) : null}
                  </div>
                ) : null}
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
