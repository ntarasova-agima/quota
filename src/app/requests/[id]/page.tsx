"use client";

import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import RequestMetaSummary from "@/components/request-meta-summary";
import {
  getApprovalStatusClass,
  getBuhPaymentStatusSummary,
  getRequestStatusSummary,
  getUnallocatedPaymentAmounts,
} from "@/lib/requestStatus";
import { HOD_DEPARTMENTS } from "@/lib/constants";
import { getRoleLabel } from "@/lib/roleLabels";
import {
  formatIncomingRatio,
  formatMonthKeyLabel,
  normalizeContestSpecialistSource,
  requiresContestSpecialistValidation,
} from "@/lib/requestFields";
import {
  AI_TOOLS_REQUEST_CATEGORY,
  SERVICE_PURCHASE_CATEGORY,
  isAiToolsFundingSource as isAiToolsFundingSourceValue,
  isServiceRecipientCategory,
  normalizeFundingSource,
  normalizeRequestCategory,
} from "@/lib/requestRules";
import {
  DEFAULT_VAT_RATE,
  calculateAmountWithVat,
  formatAmountPair,
  parseMoneyInput,
  resolveVatAmounts,
  sanitizeNumericInput,
  syncVatInputPair,
} from "@/lib/vat";
import { Paperclip, Upload } from "lucide-react";
import { HoverHint } from "@/components/ui/hover-hint";

type SpecialistView = {
  id: string;
  name: string;
  sourceType?: string;
  department?: string;
  hours?: number;
  directCost?: number;
  hodConfirmed?: boolean;
  validationSkipped?: boolean;
};

const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_SIZE = 40 * 1024 * 1024;
const ACCEPTED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".zip",
  ".7z",
  ".rar",
];

function isAllowedAttachment(file: File) {
  const fileName = file.name.toLowerCase();
  return ACCEPTED_ATTACHMENT_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function canInlinePreviewAttachment(contentType?: string, fileName?: string) {
  if (contentType?.startsWith("image/")) {
    return true;
  }
  if (contentType === "application/pdf") {
    return true;
  }
  const lower = fileName?.toLowerCase() ?? "";
  return lower.endsWith(".pdf") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp");
}

function formatDateInputFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthKeyFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthKeysFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return Array.from({ length: 3 }).map((_, index) => {
    const current = new Date(date.getFullYear(), date.getMonth() + index, 1);
    return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
  });
}

const MONEY_EPSILON = 0.000001;

function isSameMoneyValue(left?: number, right?: number) {
  if (left === undefined || right === undefined) {
    return false;
  }
  return Math.abs(left - right) < MONEY_EPSILON;
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

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

function sumPaymentSplitAmounts(paymentSplits: Array<{ amountWithoutVat?: number }>) {
  return paymentSplits.reduce((sum, split) => sum + (split.amountWithoutVat ?? 0), 0);
}

function sumPaymentSplitAmountsWithVat(
  paymentSplits: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>,
  vatRate?: number,
) {
  return paymentSplits.reduce((sum, split) => {
    const resolved = resolveVatAmounts({
      amountWithoutVat: split.amountWithoutVat,
      amountWithVat: split.amountWithVat,
      vatRate: split.vatRate ?? vatRate,
      autoCalculateAmountWithVat: split.amountWithoutVat !== undefined && split.amountWithVat === undefined,
    });
    return sum + (resolved.amountWithVat ?? 0);
  }, 0);
}

function resolvePaymentPair(params: {
  amountWithoutVat?: number;
  amountWithVat?: number;
  vatRate?: number;
}) {
  return resolveVatAmounts({
    amountWithoutVat: params.amountWithoutVat,
    amountWithVat: params.amountWithVat,
    vatRate: params.vatRate,
    autoCalculateAmountWithVat:
      params.amountWithoutVat !== undefined && params.amountWithVat === undefined,
  });
}

function getPaymentTargetAmounts(request: {
  amount: number;
  amountWithVat?: number;
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  paymentSplits?: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>;
  vatRate?: number;
}) {
  const splits = request.paymentSplits ?? [];
  const splitTotal = sumPaymentSplitAmounts(splits);
  const splitTotalWithVat = sumPaymentSplitAmountsWithVat(splits, request.vatRate);
  const residual = resolvePaymentPair({
    amountWithoutVat: request.paymentResidualAmount,
    amountWithVat: request.paymentResidualAmountWithVat,
    vatRate: request.vatRate,
  });
  if (residual.amountWithoutVat !== undefined || residual.amountWithVat !== undefined) {
    return {
      amountWithoutVat: splitTotal + (residual.amountWithoutVat ?? 0),
      amountWithVat: splitTotalWithVat + (residual.amountWithVat ?? 0),
    };
  }
  return resolvePaymentPair({
    amountWithoutVat:
      request.actualPaidAmount ??
      request.amount,
    amountWithVat:
      request.actualPaidAmountWithVat ??
      request.amountWithVat,
    vatRate: request.vatRate,
  });
}

function getPaymentRemainingAmounts(request: {
  amount: number;
  amountWithVat?: number;
  actualPaidAmount?: number;
  actualPaidAmountWithVat?: number;
  plannedPaymentAmount?: number;
  plannedPaymentAmountWithVat?: number;
  paymentResidualAmount?: number;
  paymentResidualAmountWithVat?: number;
  paymentSplits?: Array<{ amountWithoutVat?: number; amountWithVat?: number; vatRate?: number }>;
  vatRate?: number;
  status: string;
}) {
  if (request.status === "paid" || request.status === "closed") {
    return {
      amountWithoutVat: 0,
      amountWithVat: 0,
    };
  }
  const residual = resolvePaymentPair({
    amountWithoutVat: request.paymentResidualAmount,
    amountWithVat: request.paymentResidualAmountWithVat,
    vatRate: request.vatRate,
  });
  if (residual.amountWithoutVat !== undefined || residual.amountWithVat !== undefined) {
    return residual;
  }
  return getPaymentTargetAmounts(request);
}

function getPendingStatusPresentation(isActionableForViewer: boolean) {
  return isActionableForViewer
    ? {
        label: "Ждет вашего решения",
        className: "border-amber-200 bg-amber-100 text-amber-800",
      }
    : {
        label: "Ожидает согласования",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
}

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as Id<"requests">;
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.requests.getRequest, isAuthenticated ? { id: requestId } : "skip");
  const myRoles = (useQuery(api.roles.myRoles, isAuthenticated ? {} : "skip") ?? []) as string[];
  const comments = useQuery(
    api.comments.listByRequest,
    isAuthenticated ? { requestId } : "skip",
  );
  const changeHistory = useQuery(
    api.requests.listChangeHistory,
    isAuthenticated ? { requestId } : "skip",
  );
  const timeline = useQuery(api.timeline.listByRequest, isAuthenticated ? { requestId } : "skip");
  const attachments = useQuery(
    api.attachments.listForRequest,
    isAuthenticated ? { requestId } : "skip",
  );
  const decide = useMutation(api.approvals.decide);
  const remindApproval = useMutation(api.approvals.remindApproval);
  const adminApproveAsRole = useMutation(api.approvals.adminApproveAsRole);
  const cancelRequest = useMutation(api.requests.cancelRequest);
  const resumeRequest = useMutation(api.requests.resumeRequest);
  const assignCfdTag = useMutation(api.requests.assignCfdTag);
  const updatePaymentStatus = useMutation(api.requests.updatePaymentStatus);
  const updateContestSpecialist = useMutation(api.requests.updateContestSpecialist);
  const generateAttachmentUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const saveAttachment = useMutation(api.attachments.saveAttachment);
  const deleteAttachment = useMutation(api.attachments.deleteAttachment);
  const createTag = useMutation(api.cfdTags.create);
  const addComment = useMutation(api.comments.addComment);
  const editComment = useMutation(api.comments.editComment);
  const [commentByRole, setCommentByRole] = useState<Record<string, string>>({});
  const [adminCommentByRole, setAdminCommentByRole] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [paymentActionError, setPaymentActionError] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [submittingRole, setSubmittingRole] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<Id<"comments"> | null>(null);
  const [editingId, setEditingId] = useState<Id<"comments"> | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [customTagName, setCustomTagName] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "changes" | "timeline">("details");
  const [finplanCostIdsRaw, setFinplanCostIdsRaw] = useState("");
  const [paymentPlannedDate, setPaymentPlannedDate] = useState("");
  const [paymentTargetAmount, setPaymentTargetAmount] = useState("");
  const [paymentTargetAmountWithVat, setPaymentTargetAmountWithVat] = useState("");
  const [paymentPlannedAmount, setPaymentPlannedAmount] = useState("");
  const [paymentPlannedAmountWithVat, setPaymentPlannedAmountWithVat] = useState("");
  const [paymentExecutedAmount, setPaymentExecutedAmount] = useState("");
  const [paymentExecutedAmountWithVat, setPaymentExecutedAmountWithVat] = useState("");
  const [paymentExecutedDate, setPaymentExecutedDate] = useState("");
  const [paymentCurrencyRate, setPaymentCurrencyRate] = useState("");
  const [confirmLatePaymentPlan, setConfirmLatePaymentPlan] = useState(false);
  const [specialistDrafts, setSpecialistDrafts] = useState<Record<string, SpecialistView>>({});
  const [savingSpecialistId, setSavingSpecialistId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<Id<"requestAttachments"> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const todayDate = useMemo(() => formatDateInputFromTimestamp(Date.now()), []);

  const canDecide = useMemo(() => new Set(myRoles), [myRoles]);
  const isAdmin = useMemo(() => myRoles.includes("ADMIN"), [myRoles]);
  const isNbd = useMemo(() => myRoles.includes("NBD"), [myRoles]);
  const isAiBoss = useMemo(() => myRoles.includes("AI-BOSS"), [myRoles]);
  const isCoo = useMemo(() => myRoles.includes("COO"), [myRoles]);
  const canSetCfdTag = useMemo(
    () =>
      myRoles.includes("CFD") ||
      myRoles.includes("ADMIN") ||
      myRoles.includes("BUH") ||
      myRoles.includes("NBD"),
    [myRoles],
  );
  const showStandaloneTagEditor = canSetCfdTag && !myRoles.includes("BUH");
  const cfdTags = useQuery(api.cfdTags.list, isAuthenticated && canSetCfdTag ? {} : "skip");
  const canSetAwaitingPayment = useMemo(() => data?.isCreator || myRoles.includes("ADMIN"), [data?.isCreator, myRoles]);
  const canSetPaymentPlanned = useMemo(() => myRoles.includes("BUH"), [myRoles]);
  const canSetPaid = useMemo(() => myRoles.includes("BUH"), [myRoles]);
  const canClose = useMemo(() => data?.isCreator || myRoles.includes("ADMIN"), [data?.isCreator, myRoles]);
  const canEditRequest = useMemo(
    () => data?.isCreator || myRoles.includes("ADMIN"),
    [data?.isCreator, myRoles],
  );
  const isLatePaymentPlan = useMemo(() => {
    if (!paymentPlannedDate || !data?.request?.neededBy) {
      return false;
    }
    return new Date(`${paymentPlannedDate}T00:00:00`).getTime() > data.request.neededBy;
  }, [paymentPlannedDate, data?.request?.neededBy]);
  const quotaReferenceTimestamp = useMemo(
    () => data?.request?.approvalDeadline ?? data?.request?.neededBy ?? Date.now(),
    [data?.request?.approvalDeadline, data?.request?.neededBy],
  );
  const quotaMonthKeys = useMemo(
    () => buildMonthKeysFromTimestamp(quotaReferenceTimestamp),
    [quotaReferenceTimestamp],
  );
  const highlightedQuotaMonthKey = useMemo(
    () => getMonthKeyFromTimestamp(quotaReferenceTimestamp),
    [quotaReferenceTimestamp],
  );
  const isAiToolsFundingSource = useMemo(
    () => (data?.request?.fundingSource ? isAiToolsFundingSourceValue(data.request.fundingSource) : false),
    [data?.request?.fundingSource],
  );
  const normalizedRequestCategory = useMemo(
    () => (data?.request?.category ? normalizeRequestCategory(data.request.category) : undefined),
    [data?.request?.category],
  );
  const paymentVatRate = useMemo(
    () => data?.request?.vatRate ?? DEFAULT_VAT_RATE,
    [data?.request?.vatRate],
  );
  const showNbdQuotaSummary = Boolean(
    isAuthenticated &&
      isNbd &&
      data?.request?.fundingSource === "Квота на пресейлы" &&
      data?.request?.category !== "Welcome-бонус",
  );
  const showAiBossQuotaSummary = Boolean(
    isAuthenticated &&
      isAiBoss &&
      isAiToolsFundingSource &&
      [AI_TOOLS_REQUEST_CATEGORY, SERVICE_PURCHASE_CATEGORY].includes(
        normalizedRequestCategory as typeof AI_TOOLS_REQUEST_CATEGORY | typeof SERVICE_PURCHASE_CATEGORY,
      ),
  );
  const showCooQuotaSummary = Boolean(
    isAuthenticated && isCoo && data?.request?.fundingSource === "Квота на внутренние затраты",
  );
  const nbdQuotaSummary = useQuery(
    api.quotas.listByMonthKeys,
    showNbdQuotaSummary && data?.request?.fundingSource === "Квота на пресейлы" ? { monthKeys: quotaMonthKeys } : "skip",
  );
  const aiBossQuotaSummary = useQuery(
    api.quotas.listAiToolByMonthKeys,
    showAiBossQuotaSummary ? { monthKeys: quotaMonthKeys } : "skip",
  );
  const cooQuotaSummary = useQuery(
    api.quotas.listCooByMonthKeys,
    showCooQuotaSummary ? { monthKeys: quotaMonthKeys } : "skip",
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of comments ?? []) {
      if (item.parentId) {
        map.set(item.parentId, (map.get(item.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [comments]);
  const groupedChangeHistory = useMemo(() => {
    if (!changeHistory?.length) {
      return [];
    }
    const groups = new Map<
      string,
      {
        id: string;
        createdAt: number;
        authorEmail: string;
        authorName?: string;
        groupSummary?: string;
        triggeredRepeatApproval?: boolean;
        items: any[];
      }
    >();
    for (const item of changeHistory) {
      const key = item.groupId ?? `${item.createdAt}-${item.authorEmail}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          createdAt: item.createdAt,
          authorEmail: item.authorEmail,
          authorName: item.authorName,
          groupSummary: item.groupSummary,
          triggeredRepeatApproval: item.triggeredRepeatApproval,
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [changeHistory]);
  const canEditComment = (commentId: Id<"comments">) => {
    return (repliesByParent.get(commentId) ?? 0) === 0;
  };
  const previewAttachment = useMemo(
    () => attachments?.find((item) => item._id === previewAttachmentId) ?? null,
    [attachments, previewAttachmentId],
  );

  useEffect(() => {
    if (data?.request) {
      const targetAmounts = getPaymentTargetAmounts(data.request);
      const remainingAmounts = getPaymentRemainingAmounts(data.request);
      setSelectedTag(data.request.cfdTag ?? "");
      setCustomTagName("");
      setFinplanCostIdsRaw((data.request.finplanCostIds ?? []).join(", "));
      setPaymentPlannedDate(
        data.request.paymentPlannedAt
          ? new Date(data.request.paymentPlannedAt).toISOString().slice(0, 10)
          : "",
      );
      setPaymentTargetAmount(
        targetAmounts.amountWithoutVat !== undefined ? String(targetAmounts.amountWithoutVat) : "",
      );
      setPaymentTargetAmountWithVat(
        targetAmounts.amountWithVat !== undefined ? String(targetAmounts.amountWithVat) : "",
      );
      setPaymentPlannedAmount(
        data.request.plannedPaymentAmount !== undefined
          ? String(data.request.plannedPaymentAmount)
          : remainingAmounts.amountWithoutVat !== undefined
            ? String(remainingAmounts.amountWithoutVat)
            : "",
      );
      setPaymentPlannedAmountWithVat(
        data.request.plannedPaymentAmountWithVat !== undefined
          ? String(data.request.plannedPaymentAmountWithVat)
          : remainingAmounts.amountWithVat !== undefined
            ? String(remainingAmounts.amountWithVat)
            : "",
      );
      setPaymentExecutedAmount(
        data.request.plannedPaymentAmount !== undefined
          ? String(data.request.plannedPaymentAmount)
          : remainingAmounts.amountWithoutVat !== undefined
            ? String(remainingAmounts.amountWithoutVat)
            : "",
      );
      setPaymentExecutedAmountWithVat(
        data.request.plannedPaymentAmountWithVat !== undefined
          ? String(data.request.plannedPaymentAmountWithVat)
          : remainingAmounts.amountWithVat !== undefined
            ? String(remainingAmounts.amountWithVat)
            : "",
      );
      setPaymentExecutedDate(
        data.request.paidAt
          ? formatDateInputFromTimestamp(data.request.paidAt)
          : todayDate,
      );
      setPaymentCurrencyRate(
        data.request.paymentCurrencyRate !== undefined
          ? String(data.request.paymentCurrencyRate)
          : "",
      );
    }
  }, [
    data?.request?._id,
    data?.request?.cfdTag,
    data?.request?.paymentPlannedAt,
    data?.request?.status,
    data?.request?.plannedPaymentAmount,
    data?.request?.plannedPaymentAmountWithVat,
    data?.request?.finplanCostIds,
    data?.request?.actualPaidAmount,
    data?.request?.actualPaidAmountWithVat,
    data?.request?.paymentResidualAmount,
    data?.request?.paymentResidualAmountWithVat,
    data?.request?.paymentSplits,
    data?.request?.amount,
    data?.request?.amountWithVat,
    data?.request?.paidAt,
    data?.request?.paymentCurrencyRate,
    data?.request?.vatRate,
    todayDate,
  ]);
  useEffect(() => {
    const next: Record<string, SpecialistView> = {};
    for (const item of (data?.request?.specialists ?? []) as SpecialistView[]) {
      next[item.id] = { ...item };
    }
    setSpecialistDrafts(next);
  }, [data?.request?._id, data?.request?.updatedAt]);

  if (data === null) {
    return (
      <RequireAuth>
        <div className="min-h-screen bg-background text-foreground">
          <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
            <p className="text-sm text-muted-foreground">Заявка не найдена.</p>
          </main>
        </div>
      </RequireAuth>
    );
  }

  if (!data) {
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

  const { request, approvals } = data;
  const isServiceCategory = isServiceRecipientCategory(request.category);
  const remainingPaymentAmounts = getPaymentRemainingAmounts(request);
  const currentPlannedPaymentAmounts = resolvePaymentPair({
    amountWithoutVat: request.plannedPaymentAmount,
    amountWithVat: request.plannedPaymentAmountWithVat,
    vatRate: request.vatRate,
  });
  const unallocatedPaymentAmounts = getUnallocatedPaymentAmounts(request);
  const hasUnallocatedPayment =
    unallocatedPaymentAmounts.amountWithoutVat > MONEY_EPSILON;
  const hasRemainingPayment =
    remainingPaymentAmounts.amountWithoutVat !== undefined &&
    remainingPaymentAmounts.amountWithoutVat > 0;
  const partialPlanButtonLabel =
    hasUnallocatedPayment ||
    (request.paymentSplits?.length ?? 0) > 0 ||
    request.status === "partially_paid"
      ? "Запланировать следующий платеж"
      : "Запланировать частичную оплату";
  const isCreator = data.isCreator;
  const canCancel = isCreator;
  const hasPendingHodValidation = Boolean(
    request.status === "hod_pending" &&
      myRoles.includes("HOD") &&
      (request.specialists ?? []).some(
        (item) =>
          requiresContestSpecialistValidation(item) &&
          (data.hodDepartments ?? []).includes(item.department) &&
          (!item.hodConfirmed || item.directCost === undefined),
      ),
  );
  const allContestParticipants = (request.specialists ?? []) as SpecialistView[];
  const contestParticipants = {
    internal: allContestParticipants.filter(
      (item) => normalizeContestSpecialistSource(item.sourceType) === "internal",
    ),
    contractor: allContestParticipants.filter(
      (item) => normalizeContestSpecialistSource(item.sourceType) === "contractor",
    ),
  };
  const baseStatusSummary =
    canSetPaymentPlanned && ["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
      ? getBuhPaymentStatusSummary(request)
      : getRequestStatusSummary(request, approvals);
  const isActionableForViewer =
    request.status === "pending" &&
    approvals.some((approval) => approval.status === "pending" && canDecide.has(approval.role));
  const statusSummary =
    request.status === "pending"
      ? getPendingStatusPresentation(isActionableForViewer)
      : baseStatusSummary;
  const contextualHint = hasPendingHodValidation
    ? "Провалидируйте часы и прямые затраты по специалистам вашего цеха"
    : isActionableForViewer
      ? "Ждет вашего решения"
      : canSetPaymentPlanned &&
          ["payment_planned", "partially_paid"].includes(request.status) &&
          hasUnallocatedPayment
        ? "Есть нераспределенный платеж"
      : canSetPaymentPlanned && ["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
        ? "Нужно запланировать или оплатить"
        : isCreator && request.status === "paid"
          ? "Закройте заявку до конца следующего рабочего дня"
          : groupedChangeHistory.some((group) => group.triggeredRepeatApproval)
            ? "Заявка изменена и отправлена на повторное согласование"
            : null;
  async function uploadFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    setFileActionError(null);
    if ((attachments?.length ?? 0) + files.length > MAX_ATTACHMENTS) {
      setFileActionError("Можно прикрепить не более 20 файлов");
      return;
    }
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        setFileActionError(`Файл ${file.name} больше 40 МБ`);
        return;
      }
      if (!isAllowedAttachment(file)) {
        setFileActionError(`Формат файла ${file.name} не поддерживается`);
        return;
      }
    }
    setSelectedFiles(files);
    setUploadingFile(true);
    try {
      for (const file of files) {
        const uploadUrl = await generateAttachmentUploadUrl({ requestId: request._id });
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
          requestId: request._id,
          storageId,
          fileName: file.name,
          contentType: file.type || undefined,
          fileSize: file.size,
        });
      }
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      router.refresh();
    } catch (err) {
      setFileActionError(err instanceof Error ? err.message : "Не удалось прикрепить файлы");
    } finally {
      setUploadingFile(false);
    }
  }

  async function handlePlanPayment(planningMode: "full" | "partial") {
    setPaymentActionError(null);
    if (!paymentPlannedDate) {
      setPaymentActionError("Укажите дату оплаты");
      return;
    }
    if (isLatePaymentPlan && !confirmLatePaymentPlan) {
      setPaymentActionError("Дата позже нужной. Подтвердите, что сохраняете ее");
      return;
    }
    const remainingAmount = remainingPaymentAmounts.amountWithoutVat;
    const plannedAmounts = resolvePaymentPair({
      amountWithoutVat: parseMoneyInput(paymentPlannedAmount),
      amountWithVat: parseMoneyInput(paymentPlannedAmountWithVat),
      vatRate: paymentVatRate,
    });
    if (planningMode === "partial") {
      if (
        request.status === "payment_planned" &&
        currentPlannedPaymentAmounts.amountWithoutVat !== undefined &&
        hasUnallocatedPayment &&
        (request.paymentSplits?.length ?? 0) === 0
      ) {
        setPaymentActionError(
          "Сначала зафиксируйте текущую частичную оплату, потом планируйте следующий платеж",
        );
        return;
      }
      if (
        plannedAmounts.amountWithoutVat === undefined ||
        plannedAmounts.amountWithoutVat <= 0
      ) {
        setPaymentActionError("Укажите сумму частичной оплаты");
        return;
      }
      if (
        remainingAmount !== undefined &&
        plannedAmounts.amountWithoutVat > remainingAmount
      ) {
        setPaymentActionError("Сумма частичной оплаты не может быть больше остатка платежа");
        return;
      }
      if (
        remainingAmount !== undefined &&
        isSameMoneyValue(plannedAmounts.amountWithoutVat, remainingAmount)
      ) {
        setPaymentActionError(
          "Сумма совпадает с остатком платежа. Чтобы закрыть весь платеж, нажмите «Запланировать оплату»",
        );
        return;
      }
    }

    setUpdatingStatus(true);
    try {
      await updatePaymentStatus({
        id: request._id,
        status: "payment_planned",
        paymentPlannedAt: new Date(`${paymentPlannedDate}T00:00:00`).getTime(),
        finplanCostIdsRaw,
        actualPaidAmount: parseMoneyInput(paymentTargetAmount),
        actualPaidAmountWithVat: parseMoneyInput(paymentTargetAmountWithVat),
        plannedPaymentAmount:
          planningMode === "partial" ? plannedAmounts.amountWithoutVat : undefined,
        plannedPaymentAmountWithVat:
          planningMode === "partial" ? plannedAmounts.amountWithVat : undefined,
        planningMode,
        paymentCurrencyRate: parseMoneyInput(paymentCurrencyRate),
        allowLatePaymentPlan: isLatePaymentPlan ? true : undefined,
      });
      router.refresh();
    } catch (err) {
      setPaymentActionError(
        getDisplayErrorMessage(
          err,
          planningMode === "partial"
            ? "Не удалось запланировать частичную оплату"
            : "Не удалось запланировать оплату",
        ),
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handlePartialPayment() {
    setPaymentActionError(null);
    if (!paymentExecutedDate) {
      setPaymentActionError("Укажите дату оплаты");
      return;
    }
    const executedAmounts = resolvePaymentPair({
      amountWithoutVat: parseMoneyInput(paymentExecutedAmount),
      amountWithVat: parseMoneyInput(paymentExecutedAmountWithVat),
      vatRate: paymentVatRate,
    });
    if (
      executedAmounts.amountWithoutVat === undefined ||
      executedAmounts.amountWithoutVat <= 0
    ) {
      setPaymentActionError("Укажите сумму текущего платежа");
      return;
    }
    if (
      remainingPaymentAmounts.amountWithoutVat !== undefined &&
      executedAmounts.amountWithoutVat > remainingPaymentAmounts.amountWithoutVat
    ) {
      setPaymentActionError("Сумма частичной оплаты не может быть больше остатка платежа");
      return;
    }
    if (
      remainingPaymentAmounts.amountWithoutVat !== undefined &&
      isSameMoneyValue(
        executedAmounts.amountWithoutVat,
        remainingPaymentAmounts.amountWithoutVat,
      )
    ) {
      setPaymentActionError(
        "Сумма совпадает с остатком платежа. Чтобы закрыть весь платеж, нажмите «Оплачено»",
      );
      return;
    }
    setUpdatingStatus(true);
    try {
      await updatePaymentStatus({
        id: request._id,
        status: "partially_paid",
        finplanCostIdsRaw,
        actualPaidAmount: executedAmounts.amountWithoutVat,
        actualPaidAmountWithVat: executedAmounts.amountWithVat,
        actualPaidAt: new Date(`${paymentExecutedDate}T00:00:00`).getTime(),
        paymentCurrencyRate: parseMoneyInput(paymentCurrencyRate),
      });
      router.refresh();
    } catch (err) {
      setPaymentActionError(
        getDisplayErrorMessage(err, "Не удалось сохранить частичную оплату"),
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handlePaid() {
    setPaymentActionError(null);
    if (!paymentExecutedDate) {
      setPaymentActionError("Укажите дату оплаты");
      return;
    }
    setUpdatingStatus(true);
    try {
      await updatePaymentStatus({
        id: request._id,
        status: "paid",
        finplanCostIdsRaw,
        actualPaidAmount: parseMoneyInput(paymentExecutedAmount),
        actualPaidAmountWithVat: parseMoneyInput(paymentExecutedAmountWithVat),
        actualPaidAt: new Date(`${paymentExecutedDate}T00:00:00`).getTime(),
        paymentCurrencyRate: parseMoneyInput(paymentCurrencyRate),
      });
      router.refresh();
    } catch (err) {
      setPaymentActionError(
        getDisplayErrorMessage(err, "Не удалось обновить статус"),
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDecision(role: string, decision: "approved" | "rejected") {
    setError(null);
    if (decision === "rejected" && !commentByRole[role]?.trim()) {
      setError("Комментарий обязателен для отказа");
      return;
    }
    setSubmittingRole(role);
    try {
      await decide({
        requestId: request._id,
        role: role as any,
        decision,
        comment: commentByRole[role],
      });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось принять решение";
      setError(
        message.includes("Comment required for rejection")
          ? "Комментарий обязателен для отказа"
          : message,
      );
    } finally {
      setSubmittingRole(null);
    }
  }

  async function handleAddComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await addComment({
        requestId,
        body: newComment,
        parentId: replyTo ?? undefined,
      });
      setNewComment("");
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить комментарий");
    }
  }

  async function handleEditComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) {
      return;
    }
    setError(null);
    try {
      await editComment({ id: editingId, body: editingBody });
      setEditingId(null);
      setEditingBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить комментарий");
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Заявка" showAdmin={isAdmin} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 rounded-full border border-zinc-200 bg-zinc-50/80 p-1">
              <Button
                type="button"
                size="sm"
                variant={activeTab === "details" ? "default" : "ghost"}
                onClick={() => setActiveTab("details")}
              >
                Заявка
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "changes" ? "default" : "ghost"}
                onClick={() => setActiveTab("changes")}
              >
                Изменения
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeTab === "timeline" ? "default" : "ghost"}
                onClick={() => setActiveTab("timeline")}
              >
                Таймлайн
              </Button>
            </div>
            {canEditRequest ? (
              <Button asChild variant="outline">
                <Link href={`/requests/${requestId}/edit`}>Редактировать заявку</Link>
              </Button>
            ) : null}
            {isAdmin && request.status === "pending" ? (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setError(null);
                  try {
                    await remindApproval({ requestId: request._id });
                    router.refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Не удалось отправить напоминание");
                  }
                }}
              >
                Напомнить о согласовании
              </Button>
            ) : null}
          </div>

          <div className={activeTab === "details" ? "space-y-6" : "hidden"}>
          <Card>
            <CardHeader>
              <CardTitle>{request.title || `${request.clientName} :: ${normalizedRequestCategory ?? request.category}`}</CardTitle>
              <CardDescription>
                <RequestMetaSummary
                  requestCode={request.requestCode}
                  clientName={request.clientName}
                  category={request.category}
                  amount={request.amount}
                  amountWithVat={request.amountWithVat}
                  currency={request.currency}
                  vatRate={request.vatRate}
                />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {canCancel && (
                <div>
                  <Button
                    type="button"
                    variant={request.isCanceled ? "outline" : "destructive"}
                    onClick={async () => {
                      setError(null);
                      try {
                        if (request.isCanceled) {
                          await resumeRequest({ id: request._id });
                        } else {
                          await cancelRequest({ id: request._id });
                        }
                        router.refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Не удалось обновить заявку");
                      }
                    }}
                  >
                    {request.isCanceled ? "Возобновить заявку" : "Отменить заявку"}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <span className={`rounded-full border px-3 py-1 text-xs ${statusSummary.className}`}>
                  {statusSummary.label}
                </span>
                <span className="rounded-full border border-border px-3 py-1 text-xs">
                  Источник: {normalizeFundingSource(request.fundingSource)}
                </span>
                {request.cfdTag ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                    Тег: {request.cfdTag}
                  </span>
                ) : null}
                {request.archivedAt ? (
                  <span className="rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
                    В архиве
                  </span>
                ) : null}
              </div>
              {contextualHint ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  {contextualHint}
                </div>
              ) : null}
              {request.awaitingPaymentByEmail ? (
                <div>
                  <div className="text-muted-foreground">В оплату передал</div>
                  <p className="mt-1">
                    {request.awaitingPaymentByName ? `${request.awaitingPaymentByName} · ` : ""}
                    {request.awaitingPaymentByEmail}
                    {request.awaitingPaymentAt
                      ? ` · ${new Date(request.awaitingPaymentAt).toLocaleString("ru-RU")}`
                      : ""}
                  </p>
                </div>
              ) : null}
              {request.paidByEmail ? (
                <div>
                  <div className="text-muted-foreground">Оплатил</div>
                  <p className="mt-1">
                    {request.paidByName ? `${request.paidByName} · ` : ""}
                    {request.paidByEmail}
                    {request.paidAt ? ` · ${new Date(request.paidAt).toLocaleString("ru-RU")}` : ""}
                  </p>
                </div>
              ) : null}
              {request.actualPaidAmount !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Сумма оплаты без НДС</div>
                  <p className="mt-1">
                    {request.actualPaidAmount} {request.currency}
                  </p>
                </div>
              ) : null}
              {request.actualPaidAmountWithVat !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Сумма оплаты с НДС</div>
                  <p className="mt-1">
                    {request.actualPaidAmountWithVat} {request.currency}
                  </p>
                </div>
              ) : null}
              {request.paymentResidualAmount !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Остаток к оплате</div>
                  <p className="mt-1">
                    {formatAmountPair({
                      amountWithoutVat: request.paymentResidualAmount,
                      currency: request.currency,
                      vatRate: request.vatRate,
                    })}
                  </p>
                </div>
              ) : null}
              {request.paymentCurrencyRate !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Курс валюты</div>
                  <p className="mt-1">{request.paymentCurrencyRate}</p>
                </div>
              ) : null}
              {request.paymentPlannedByEmail ? (
                <div>
                  <div className="text-muted-foreground">Оплату запланировал</div>
                  <p className="mt-1">
                    {request.paymentPlannedByName ? `${request.paymentPlannedByName} · ` : ""}
                    {request.paymentPlannedByEmail}
                    {request.paymentPlannedAt
                      ? ` · ${new Date(request.paymentPlannedAt).toLocaleDateString("ru-RU")}`
                      : ""}
                  </p>
                </div>
              ) : null}
              {request.finplanCostIds?.length ? (
                <div>
                  <div className="text-muted-foreground">ID затрат в Финплане</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {request.finplanCostIds.map((id) => (
                      <a
                        key={id}
                        href={`https://finplan.agimagroup.ru/finance/costs/?filter=${id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-border px-2 py-1 text-xs text-primary underline"
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
              {request.paymentSplits?.length ? (
                <div className="space-y-2">
                  <div className="text-muted-foreground">Транши оплаты</div>
                  <div className="space-y-2">
                    {request.paymentSplits.map((split: any) => (
                      <div
                        key={`${split.splitNumber}-${split.createdAt}`}
                        className="rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div className="font-medium">Транш {split.splitNumber}</div>
                        <div className="text-muted-foreground">
                          Оплачен {new Date(split.paidAt).toLocaleDateString("ru-RU")} ·{" "}
                          {split.amountWithoutVat} {request.currency} без НДС
                          {split.amountWithVat !== undefined
                            ? ` · ${split.amountWithVat} ${request.currency} с НДС`
                            : ""}
                        </div>
                        {split.remainingAmountWithoutVat !== undefined || split.nextPaymentAt ? (
                          <div className="text-muted-foreground">
                            Остаток: {split.remainingAmountWithoutVat ?? "—"} {request.currency}
                            {split.nextPaymentAt
                              ? ` · следующая дата ${new Date(split.nextPaymentAt).toLocaleDateString("ru-RU")}`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {showStandaloneTagEditor && (!myRoles.includes("NBD") || ["approved", "awaiting_payment", "payment_planned", "partially_paid", "paid", "closed"].includes(request.status)) && (
                <div className="space-y-2">
                  <Label>Тег заявки</Label>
                  <div className="grid max-w-2xl gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <Select value={selectedTag || "none"} onValueChange={(value) => setSelectedTag(value === "none" ? "" : value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите тег" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без тега</SelectItem>
                        {(cfdTags ?? []).map((tag) => (
                          <SelectItem key={tag._id} value={tag.name}>
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={customTagName}
                      onChange={(event) => setCustomTagName(event.target.value)}
                      placeholder="Или впишите новый тег"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        setError(null);
                        try {
                          let nextTag = selectedTag || undefined;
                          if (customTagName.trim()) {
                            await createTag({ name: customTagName.trim() });
                            nextTag = customTagName.trim();
                            setSelectedTag(customTagName.trim());
                            setCustomTagName("");
                          }
                          await assignCfdTag({
                            id: request._id,
                            tag: nextTag,
                          });
                          router.refresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Не удалось сохранить тег");
                        }
                      }}
                    >
                      Сохранить тег
                    </Button>
                  </div>
                </div>
              )}
              {(canSetAwaitingPayment || canSetPaymentPlanned || canSetPaid || canClose) && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {canSetAwaitingPayment && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={updatingStatus || request.status !== "approved"}
                        onClick={async () => {
                          setError(null);
                          setPaymentActionError(null);
                          setUpdatingStatus(true);
                          try {
                            await updatePaymentStatus({ id: request._id, status: "awaiting_payment" });
                            router.refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Не удалось обновить статус");
                          } finally {
                            setUpdatingStatus(false);
                          }
                        }}
                      >
                        Передать в оплату
                      </Button>
                    )}
                    {canSetPaid && request.status === "paid" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-9"
                        disabled={updatingStatus}
                        onClick={async () => {
                          setError(null);
                          setPaymentActionError(null);
                          setUpdatingStatus(true);
                          try {
                            await updatePaymentStatus({
                              id: request._id,
                              status: "awaiting_payment",
                              finplanCostIdsRaw,
                            });
                            router.refresh();
                          } catch (err) {
                            setPaymentActionError(
                              err instanceof Error ? err.message : "Не удалось вернуть заявку",
                            );
                          } finally {
                            setUpdatingStatus(false);
                          }
                        }}
                      >
                        Пока не оплачено
                      </Button>
                    ) : null}
                    {canClose && request.status === "closed" ? (
                      <HoverHint label="Вернуть заявку в предыдущий статус">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9"
                          disabled={updatingStatus}
                          onClick={async () => {
                            setError(null);
                            setUpdatingStatus(true);
                            try {
                              await updatePaymentStatus({ id: request._id, status: "reopen" as any });
                              router.refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Не удалось открыть заявку заново",
                              );
                            } finally {
                              setUpdatingStatus(false);
                            }
                          }}
                        >
                          Открыть заново
                        </Button>
                      </HoverHint>
                    ) : canClose ? (
                      <HoverHint
                        label={
                          request.status === "approved"
                            ? "Если оплата по счету не требуется"
                            : "Подтвердить, что заявка завершена"
                        }
                      >
                        <Button
                          type="button"
                          className={
                            request.status === "approved"
                              ? "h-9 border-slate-300 bg-gradient-to-r from-slate-100 via-zinc-50 to-slate-100 text-slate-800 shadow-[0_0_10px_rgba(148,163,184,0.10)] hover:from-slate-200 hover:via-zinc-100 hover:to-slate-200"
                              : "h-9 border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 text-amber-900 shadow-[0_0_10px_rgba(245,158,11,0.10)] hover:from-amber-200 hover:via-yellow-100 hover:to-amber-200"
                          }
                          disabled={updatingStatus || !["approved", "paid"].includes(request.status)}
                          onClick={async () => {
                            setError(null);
                            setUpdatingStatus(true);
                            try {
                              await updatePaymentStatus({ id: request._id, status: "closed" });
                              router.refresh();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Не удалось закрыть заявку");
                            } finally {
                              setUpdatingStatus(false);
                            }
                          }}
                        >
                          {request.status === "approved" ? "Принять без оплаты" : "Закрыть заявку"}
                        </Button>
                      </HoverHint>
                    ) : null}
                  </div>
                  {(canSetPaymentPlanned || canSetPaid) && (
                    <div className="space-y-3 rounded-lg border border-border p-3">
                      {canSetCfdTag ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[220px] flex-1 space-y-2">
                            <Label>Тег заявки</Label>
                            <Select
                              value={selectedTag || "none"}
                              onValueChange={(value) => setSelectedTag(value === "none" ? "" : value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Выберите тег" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Без тега</SelectItem>
                                {(cfdTags ?? []).map((tag) => (
                                  <SelectItem key={tag._id} value={tag.name}>
                                    {tag.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="min-w-[220px] flex-1 space-y-2">
                            <Label htmlFor="customTag">Новый тег</Label>
                            <Input
                              id="customTag"
                              value={customTagName}
                              onChange={(event) => setCustomTagName(event.target.value)}
                              placeholder="Впишите новый тег"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={async () => {
                              setError(null);
                              try {
                                let nextTag = selectedTag || undefined;
                                if (customTagName.trim()) {
                                  await createTag({ name: customTagName.trim() });
                                  nextTag = customTagName.trim();
                                  setSelectedTag(customTagName.trim());
                                  setCustomTagName("");
                                }
                                await assignCfdTag({
                                  id: request._id,
                                  tag: nextTag,
                                });
                                router.refresh();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Не удалось сохранить тег");
                              }
                            }}
                          >
                            Сохранить тег
                          </Button>
                        </div>
                      ) : null}
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
                        <div className="space-y-2">
                          <Label htmlFor="finplanIds">ID затрат в Финплане</Label>
                          <Input
                            id="finplanIds"
                            value={finplanCostIdsRaw}
                            onChange={(event) => setFinplanCostIdsRaw(event.target.value)}
                            placeholder="12345, 67890"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="paymentCurrencyRate">Курс валюты</Label>
                          <Input
                            id="paymentCurrencyRate"
                            inputMode="decimal"
                            value={paymentCurrencyRate}
                            onChange={(event) =>
                              setPaymentCurrencyRate(sanitizeNumericInput(event.target.value))
                            }
                            placeholder={request.currency === "RUB" ? "Не обязателен для RUB" : "Например, 92.4"}
                          />
                        </div>
                      </div>

                      <div className="space-y-2 rounded-lg border border-border/70 p-3">
                        <div className="text-sm font-medium">Сумма оплаты</div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <Label htmlFor="paymentTargetAmount">Без НДС</Label>
                            <Input
                              id="paymentTargetAmount"
                              inputMode="decimal"
                              value={paymentTargetAmount}
                              onChange={(event) => {
                                const nextAmount = sanitizeNumericInput(event.target.value);
                                setPaymentTargetAmount(nextAmount);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: nextAmount,
                                  amountWithVatInput: paymentTargetAmountWithVat,
                                  vatRateInput: String(paymentVatRate),
                                  source: "without",
                                });
                                setPaymentTargetAmountWithVat(synced.amountWithVatInput);
                              }}
                              placeholder={`Например, ${request.amount}`}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="paymentTargetAmountWithVat">С НДС</Label>
                            <Input
                              id="paymentTargetAmountWithVat"
                              inputMode="decimal"
                              value={paymentTargetAmountWithVat}
                              onChange={(event) => {
                                const nextAmountWithVat = sanitizeNumericInput(event.target.value);
                                setPaymentTargetAmountWithVat(nextAmountWithVat);
                                const synced = syncVatInputPair({
                                  amountWithoutVatInput: paymentTargetAmount,
                                  amountWithVatInput: nextAmountWithVat,
                                  vatRateInput: String(paymentVatRate),
                                  source: "with",
                                });
                                setPaymentTargetAmount(synced.amountWithoutVatInput);
                              }}
                              placeholder={`Например, ${
                                request.amountWithVat ?? calculateAmountWithVat(request.amount, paymentVatRate)
                              }`}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          По умолчанию здесь сумма из заявки. Если BUH меняет ее, автор получит письмо.
                        </p>
                      </div>

                      {canSetPaymentPlanned ? (
                        <div className="space-y-2 rounded-lg border border-border/70 p-3">
                          <div className="text-sm font-medium">Планирование платежей</div>
                          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                            <div className="space-y-2">
                              <Label htmlFor="paymentPlannedAmount">Сумма планируемого платежа без НДС</Label>
                              <Input
                                id="paymentPlannedAmount"
                                inputMode="decimal"
                                value={paymentPlannedAmount}
                                onChange={(event) => {
                                  const nextAmount = sanitizeNumericInput(event.target.value);
                                  setPaymentPlannedAmount(nextAmount);
                                  setPaymentActionError(null);
                                  const synced = syncVatInputPair({
                                    amountWithoutVatInput: nextAmount,
                                    amountWithVatInput: paymentPlannedAmountWithVat,
                                    vatRateInput: String(paymentVatRate),
                                    source: "without",
                                  });
                                  setPaymentPlannedAmountWithVat(synced.amountWithVatInput);
                                }}
                                placeholder={`Например, ${remainingPaymentAmounts.amountWithoutVat ?? request.amount}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="paymentPlannedAmountWithVat">Сумма планируемого платежа с НДС</Label>
                              <Input
                                id="paymentPlannedAmountWithVat"
                                inputMode="decimal"
                                value={paymentPlannedAmountWithVat}
                                onChange={(event) => {
                                  const nextAmountWithVat = sanitizeNumericInput(event.target.value);
                                  setPaymentPlannedAmountWithVat(nextAmountWithVat);
                                  setPaymentActionError(null);
                                  const synced = syncVatInputPair({
                                    amountWithoutVatInput: paymentPlannedAmount,
                                    amountWithVatInput: nextAmountWithVat,
                                    vatRateInput: String(paymentVatRate),
                                    source: "with",
                                  });
                                  setPaymentPlannedAmount(synced.amountWithoutVatInput);
                                }}
                                placeholder={`Например, ${
                                  remainingPaymentAmounts.amountWithVat ??
                                  request.amountWithVat ??
                                  calculateAmountWithVat(request.amount, paymentVatRate)
                                }`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="paymentDatePlanned">Дата оплаты</Label>
                              <Input
                                id="paymentDatePlanned"
                                type="date"
                                value={paymentPlannedDate}
                                onChange={(event) => {
                                  setPaymentPlannedDate(event.target.value);
                                  setPaymentActionError(null);
                                  setConfirmLatePaymentPlan(false);
                                }}
                                min={todayDate}
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                              type="button"
                              className="h-9 border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              disabled={
                                updatingStatus ||
                                !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
                              }
                              onClick={() => handlePlanPayment("full")}
                            >
                              Запланировать оплату
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 border-blue-300 text-blue-700 hover:bg-blue-50"
                              disabled={
                                updatingStatus ||
                                !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
                              }
                              onClick={() => handlePlanPayment("partial")}
                            >
                              {partialPlanButtonLabel}
                            </Button>
                          </div>
                          {currentPlannedPaymentAmounts.amountWithoutVat !== undefined && request.paymentPlannedAt ? (
                            <p className="text-xs text-muted-foreground">
                              Запланированный платеж: {formatAmountPair({
                                amountWithoutVat: currentPlannedPaymentAmounts.amountWithoutVat,
                                amountWithVat: currentPlannedPaymentAmounts.amountWithVat,
                                currency: request.currency,
                                vatRate: request.vatRate,
                              })} · {new Date(request.paymentPlannedAt).toLocaleDateString("ru-RU")}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            Нераспределенная сумма к оплате: {formatAmountPair({
                              amountWithoutVat: unallocatedPaymentAmounts.amountWithoutVat,
                              amountWithVat: unallocatedPaymentAmounts.amountWithVat,
                              currency: request.currency,
                              vatRate: request.vatRate,
                            })}
                          </p>
                        </div>
                      ) : null}

                      {canSetPaid && hasRemainingPayment ? (
                        <div className="space-y-2 rounded-lg border border-border/70 p-3">
                          <div className="text-sm font-medium">Фиксация оплаты</div>
                          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] xl:items-end">
                            <div className="space-y-2">
                              <Label htmlFor="paymentExecutedAmount">Сумма частичной оплаты без НДС</Label>
                              <Input
                                id="paymentExecutedAmount"
                                inputMode="decimal"
                                value={paymentExecutedAmount}
                                onChange={(event) => {
                                  const nextAmount = sanitizeNumericInput(event.target.value);
                                  setPaymentExecutedAmount(nextAmount);
                                  setPaymentActionError(null);
                                  const synced = syncVatInputPair({
                                    amountWithoutVatInput: nextAmount,
                                    amountWithVatInput: paymentExecutedAmountWithVat,
                                    vatRateInput: String(paymentVatRate),
                                    source: "without",
                                  });
                                  setPaymentExecutedAmountWithVat(synced.amountWithVatInput);
                                }}
                                placeholder={`Например, ${remainingPaymentAmounts.amountWithoutVat ?? request.amount}`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="paymentExecutedAmountWithVat">Сумма частичной оплаты с НДС</Label>
                              <Input
                                id="paymentExecutedAmountWithVat"
                                inputMode="decimal"
                                value={paymentExecutedAmountWithVat}
                                onChange={(event) => {
                                  const nextAmountWithVat = sanitizeNumericInput(event.target.value);
                                  setPaymentExecutedAmountWithVat(nextAmountWithVat);
                                  setPaymentActionError(null);
                                  const synced = syncVatInputPair({
                                    amountWithoutVatInput: paymentExecutedAmount,
                                    amountWithVatInput: nextAmountWithVat,
                                    vatRateInput: String(paymentVatRate),
                                    source: "with",
                                  });
                                  setPaymentExecutedAmount(synced.amountWithoutVatInput);
                                }}
                                placeholder={`Например, ${
                                  remainingPaymentAmounts.amountWithVat ??
                                  request.amountWithVat ??
                                  calculateAmountWithVat(request.amount, paymentVatRate)
                                }`}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="paymentExecutedDate">Дата оплаты</Label>
                              <Input
                                id="paymentExecutedDate"
                                type="date"
                                value={paymentExecutedDate}
                                onChange={(event) => {
                                  setPaymentExecutedDate(event.target.value);
                                  setPaymentActionError(null);
                                }}
                              />
                            </div>
                            <Button
                              type="button"
                              className="h-9 border-cyan-600 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                              disabled={
                                updatingStatus ||
                                !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
                              }
                              onClick={handlePartialPayment}
                            >
                              Частично оплачено
                            </Button>
                            <Button
                              type="button"
                              className="h-9 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                              disabled={
                                updatingStatus ||
                                !["awaiting_payment", "payment_planned", "partially_paid"].includes(request.status)
                              }
                              onClick={handlePaid}
                            >
                              Оплачено
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Остаток к оплате: {formatAmountPair({
                              amountWithoutVat: remainingPaymentAmounts.amountWithoutVat,
                              amountWithVat: remainingPaymentAmounts.amountWithVat,
                              currency: request.currency,
                              vatRate: request.vatRate,
                            })}
                          </p>
                        </div>
                      ) : null}
                      {isLatePaymentPlan ? (
                        <label className="flex items-center gap-2 text-sm text-amber-700">
                          <input
                            type="checkbox"
                            checked={confirmLatePaymentPlan}
                            onChange={(event) => setConfirmLatePaymentPlan(event.target.checked)}
                          />
                          Дата позже срока “когда нужно оплатить”. Ставьте галочку, если это решение согласовано с автором заявки.
                        </label>
                      ) : null}
                      {paymentActionError ? (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          {paymentActionError}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
              <div>
                <div className="text-muted-foreground">Автор</div>
                <p className="mt-1">
                  {request.createdByName ? `${request.createdByName} · ` : ""}
                  {request.createdByEmail}
                </p>
                {request.originalCreatedByEmail ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Исходный автор — {request.originalCreatedByName ? `${request.originalCreatedByName} · ` : ""}
                    {request.originalCreatedByEmail}. Сотрудник архивирован, заявка передана админу.
                  </p>
                ) : null}
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-muted-foreground">Прикрепить файлы</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Например, счет в PDF, акт и другие важные документы
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-[320px] flex-1 flex-col gap-2">
                    <input
                      id="attachment"
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      accept={ACCEPTED_ATTACHMENT_EXTENSIONS.join(",")}
                      onChange={async (event) => {
                        await uploadFiles(Array.from(event.target.files ?? []));
                      }}
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
                      onDrop={async (event) => {
                        event.preventDefault();
                        setIsDragOver(false);
                        await uploadFiles(Array.from(event.dataTransfer.files ?? []));
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
                              ? "Отпустите файлы, чтобы загрузить"
                              : uploadingFile
                              ? selectedFiles.length === 1
                                ? `Загружаем: ${selectedFiles[0].name}`
                                : `Загружаем файлов: ${selectedFiles.length}`
                              : "Нажмите или перетащите файлы сюда"}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            PDF, Office, изображения, архивы · до 40 МБ на файл · до 20 файлов
                          </span>
                        </span>
                      </span>
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
                {selectedFiles.length ? (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {selectedFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`}>
                        {file.name} · {formatFileSize(file.size)}
                      </div>
                    ))}
                  </div>
                ) : null}
                {fileActionError ? <p className="text-sm text-destructive">{fileActionError}</p> : null}
                {attachments?.length ? (
                  <div className="space-y-2">
                    {attachments.map((item) => (
                      <div
                        key={item._id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="font-medium">{item.fileName}</div>
                          <div className="text-muted-foreground">
                            {item.uploadedByName ? `${item.uploadedByName} · ` : ""}
                            {item.uploadedByEmail}
                            {item.fileSize ? ` · ${formatFileSize(item.fileSize)}` : ""}
                            {" · "}
                            {new Date(item.createdAt).toLocaleString("ru-RU")}
                          </div>
                        </div>
                        {item.url ? (
                          <div className="flex gap-2">
                            {canInlinePreviewAttachment(item.contentType, item.fileName) ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPreviewAttachmentId((current) =>
                                    current === item._id ? null : item._id,
                                  )
                                }
                              >
                                Предпросмотр
                              </Button>
                            ) : null}
                            <Button asChild variant="outline" size="sm">
                              <a href={item.url} target="_blank" rel="noreferrer">
                                Открыть
                              </a>
                            </Button>
                            {item.canDelete ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  setFileActionError(null);
                                  if (!window.confirm(`Удалить файл ${item.fileName}?`)) {
                                    return;
                                  }
                                  try {
                                    await deleteAttachment({ attachmentId: item._id });
                                    router.refresh();
                                  } catch (err) {
                                    setFileActionError(
                                      err instanceof Error ? err.message : "Не удалось удалить файл",
                                    );
                                  }
                                }}
                              >
                                Удалить
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Ссылка скоро появится</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Файлы пока не прикреплены.</p>
                )}
                {previewAttachment?.url && canInlinePreviewAttachment(previewAttachment.contentType, previewAttachment.fileName) ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">Предпросмотр файла</div>
                        <div className="text-sm text-muted-foreground">{previewAttachment.fileName}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewAttachmentId(null)}
                      >
                        Скрыть
                      </Button>
                    </div>
                    {previewAttachment.contentType?.startsWith("image/") ||
                    /\.(png|jpe?g|gif|webp)$/i.test(previewAttachment.fileName) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewAttachment.url}
                        alt={previewAttachment.fileName}
                        className="max-h-[32rem] w-auto rounded-lg border border-border object-contain"
                      />
                    ) : (
                      <iframe
                        src={previewAttachment.url}
                        title={previewAttachment.fileName}
                        className="h-[36rem] w-full rounded-lg border border-border bg-white"
                      />
                    )}
                  </div>
                ) : null}
              </div>
              {request.category !== "Конкурсное задание" &&
              request.category !== "Welcome-бонус" &&
              !isServiceCategory ? (
                <div>
                  <div className="text-muted-foreground">Кому платим мы</div>
                  <p className="mt-1">{request.counterparty || "Не указан"}</p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-muted-foreground">Дедлайн согласования</div>
                  <p className="mt-1">
                    <HoverHint label="Дата, до которой нужно принять решение по заявке">
                      <span>
                        {request.approvalDeadline
                          ? new Date(request.approvalDeadline).toLocaleDateString("ru-RU")
                          : "Не задан"}
                      </span>
                    </HoverHint>
                  </p>
                </div>
                <div>
                  <div className="text-muted-foreground">Когда нужно оплатить</div>
                  <p className="mt-1">
                    <HoverHint label="Дата, к которой заявку нужно оплатить">
                      <span>
                        {request.neededBy
                          ? new Date(request.neededBy).toLocaleDateString("ru-RU")
                          : "Не задано"}
                      </span>
                    </HoverHint>
                  </p>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Обоснование</div>
                <p className="mt-1 whitespace-pre-wrap">{request.justification}</p>
              </div>
              {request.details ? (
                <div>
                  <div className="text-muted-foreground">Детали заявки</div>
                  <p className="mt-1 whitespace-pre-wrap">{request.details}</p>
                </div>
              ) : null}
              {request.relatedRequests?.length ? (
                <div>
                  <div className="text-muted-foreground">Связанные заявки</div>
                  <ul className="mt-1 space-y-1">
                    {request.relatedRequests.map((item: string, index: number) => (
                      <li key={`${item}-${index}`}>
                        {item.startsWith("http://") || item.startsWith("https://") ? (
                          <a
                            className="text-primary underline"
                            href={item}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {item}
                          </a>
                        ) : (
                          <span>{item}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {request.investmentReturn ? (
                <div>
                  <div className="text-muted-foreground">Как будем возвращать инвестиции</div>
                  <p className="mt-1 whitespace-pre-wrap">{request.investmentReturn}</p>
                </div>
              ) : null}
              {request.paymentMethod ? (
                <div>
                  <div className="text-muted-foreground">Способ оплаты</div>
                  <p className="mt-1">{request.paymentMethod}</p>
                </div>
              ) : null}
              {request.category !== "Конкурсное задание" &&
              !isServiceCategory ? (
                <div>
                  <div className="text-muted-foreground">Контакты клиента</div>
                  {request.contacts.length ? (
                    <ul className="mt-1 list-disc pl-5">
                      {request.contacts.map((contact, index) => (
                        <li key={`${contact}-${index}`}>{contact}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">Контакты не указаны.</p>
                  )}
                </div>
              ) : null}
              {request.financePlanLinks?.length ? (
                <div>
                  <div className="text-muted-foreground">ID и название отгрузки в финплане</div>
                  <ul className="mt-1 list-disc pl-5">
                    {request.financePlanLinks.map((link, index) => (
                      <li key={`${link}-${index}`}>
                        <a className="text-primary underline" href={link} target="_blank" rel="noreferrer">
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {request.paidBy ? (
                <div>
                  <div className="text-muted-foreground">Когда платят нам</div>
                  <p className="mt-1">{new Date(request.paidBy).toLocaleDateString("ru-RU")}</p>
                </div>
              ) : null}
              {request.incomingAmount !== undefined || request.incomingAmountWithVat !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Сколько платят нам (сумма отгрузки)</div>
                  <p className="mt-1">
                    {formatAmountPair({
                      amountWithoutVat: request.incomingAmount,
                      amountWithVat: request.incomingAmountWithVat,
                      currency: request.currency,
                      vatRate: request.vatRate,
                    })}
                  </p>
                </div>
              ) : null}
              {request.incomingRatio !== undefined ? (
                <div>
                  <div className="text-muted-foreground">Коэффициент транзита</div>
                  <p className="mt-1">{formatIncomingRatio(request.incomingRatio)}</p>
                </div>
              ) : null}
              {request.shipmentDate || request.shipmentMonth ? (
                <div>
                  <div className="text-muted-foreground">Дата отгрузки</div>
                  <p className="mt-1">
                    {request.shipmentDate
                      ? new Date(request.shipmentDate).toLocaleDateString("ru-RU")
                      : formatMonthKeyLabel(request.shipmentMonth)}
                  </p>
                </div>
              ) : null}
              {request.fundingSource === "Отгрузки проекта" && !request.financePlanLinks?.length ? (
                <p className="text-sm text-muted-foreground">ID и название отгрузки в финплане не указаны.</p>
              ) : null}
              {request.category === "Конкурсное задание" ? (
                <div className="space-y-4">
                  {[
                    { key: "internal", label: "Внутренние специалисты", items: contestParticipants.internal },
                    { key: "contractor", label: "Подрядчики", items: contestParticipants.contractor },
                  ].map((section) => (
                    <div key={section.key} className="space-y-3">
                      <div className="text-muted-foreground">{section.label}</div>
                      {section.items.length ? (
                        section.items.map((item) => {
                          const draft = specialistDrafts[item.id] ?? item;
                          const canEditThis =
                            !item.validationSkipped &&
                            data.canHodEditSpecialists &&
                            (item.department
                              ? (data.hodDepartments ?? []).includes(item.department)
                              : true);
                          return (
                            <div
                              key={item.id}
                              className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)]"
                            >
                              <Input
                                className="min-w-0"
                                value={draft.name}
                                onChange={(event) =>
                                  setSpecialistDrafts((current) => ({
                                    ...current,
                                    [item.id]: { ...draft, name: event.target.value },
                                  }))
                                }
                                disabled={!canEditThis}
                                placeholder={section.key === "contractor" ? "Подрядчик" : "Специалист"}
                              />
                              <Select
                                value={draft.department ?? "none"}
                                onValueChange={(value) =>
                                  setSpecialistDrafts((current) => ({
                                    ...current,
                                    [item.id]: {
                                      ...draft,
                                      department: value === "none" ? undefined : value,
                                    },
                                  }))
                                }
                                disabled={!canEditThis}
                              >
                                <SelectTrigger className="min-w-0 w-full">
                                  <SelectValue placeholder="Цех" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Цех не выбран</SelectItem>
                                  {(
                                    myRoles?.includes("ADMIN") ? HOD_DEPARTMENTS : data.hodDepartments ?? []
                                  ).map((dep: string) => (
                                    <SelectItem key={dep} value={dep}>
                                      {dep}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                className="min-w-0"
                                inputMode="decimal"
                                value={draft.hours === undefined ? "" : String(draft.hours)}
                                onChange={(event) =>
                                  setSpecialistDrafts((current) => ({
                                    ...current,
                                    [item.id]: {
                                      ...draft,
                                      hours: parseMoneyInput(sanitizeNumericInput(event.target.value)),
                                    },
                                  }))
                                }
                                disabled={!canEditThis}
                                placeholder="Часы"
                              />
                              <Input
                                className="min-w-0"
                                inputMode="decimal"
                                value={draft.directCost === undefined ? "" : String(draft.directCost)}
                                onChange={(event) =>
                                  setSpecialistDrafts((current) => ({
                                    ...current,
                                    [item.id]: {
                                      ...draft,
                                      directCost: parseMoneyInput(sanitizeNumericInput(event.target.value)),
                                    },
                                  }))
                                }
                                disabled={!canEditThis}
                                placeholder="Прямые затраты"
                              />
                              {item.validationSkipped ? (
                                <div className="flex items-center text-sm text-muted-foreground">
                                  Валидация не требуется
                                </div>
                              ) : (
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(draft.hodConfirmed)}
                                    onChange={async (event) => {
                                      const checked = event.target.checked;
                                      setSpecialistDrafts((current) => ({
                                        ...current,
                                        [item.id]: { ...draft, hodConfirmed: checked },
                                      }));
                                      if (!canEditThis) {
                                        return;
                                      }
                                      setSavingSpecialistId(item.id);
                                      setError(null);
                                      try {
                                        await updateContestSpecialist({
                                          requestId: request._id,
                                          specialistId: item.id,
                                          name: draft.name,
                                          department: draft.department,
                                          hours: draft.hours,
                                          directCost: draft.directCost,
                                          hodConfirmed: checked,
                                        });
                                        router.refresh();
                                      } catch (err) {
                                        setError(
                                          err instanceof Error
                                            ? err.message
                                            : "Не удалось обновить специалиста",
                                        );
                                      } finally {
                                        setSavingSpecialistId(null);
                                      }
                                    }}
                                    disabled={!canEditThis || savingSpecialistId === item.id}
                                  />
                                  Подтверждено цехом
                                </label>
                              )}
                              <div className="sm:col-span-5 text-xs text-muted-foreground">
                                {item.validationSkipped
                                  ? "Цех не получает задачу на валидацию по этой записи."
                                  : item.hodConfirmed
                                    ? "Прямые затраты подтверждены руководителем цеха."
                                    : "Ждет валидации руководителя цеха."}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-muted-foreground">Пока не добавлены.</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {(showNbdQuotaSummary || showAiBossQuotaSummary) &&
          (
            showAiBossQuotaSummary
              ? aiBossQuotaSummary?.length
              : nbdQuotaSummary?.length
          ) ? (
            <Card>
              <CardContent className="pt-6">
                <div className="rounded-xl border border-emerald-200/80 bg-[linear-gradient(180deg,rgba(240,253,244,0.92)_0%,rgba(236,253,245,0.85)_100%)] p-4">
                  <div className="font-medium text-emerald-900">
                    {showAiBossQuotaSummary ? "Остаток квоты AI-BOSS" : "Остаток квоты NBD"}
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {(
                      showAiBossQuotaSummary
                        ? aiBossQuotaSummary
                        : nbdQuotaSummary
                    )?.map((item) => {
                      const remaining = item.quota - item.spent;
                      const remainingWithVat =
                        (item.quotaWithVat ?? item.quota) - (item.spentWithVat ?? item.spent);
                      const isHighlighted = item.monthKey === highlightedQuotaMonthKey;
                      return (
                        <div
                          key={item.monthKey}
                          className={`rounded-lg border px-3 py-3 ${
                            isHighlighted
                              ? "border-emerald-400 bg-white shadow-[0_8px_24px_rgba(16,185,129,0.12)]"
                              : "border-emerald-100/80 bg-white/70"
                          }`}
                        >
                          <div className="text-sm capitalize text-emerald-950">
                            {formatMonthLabel(item.monthKey)}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">Остаток</div>
                          <div className="mt-1 space-y-1">
                            <div className="text-sm text-emerald-900">
                              Без НДС: {remaining.toLocaleString("ru-RU")} ₽
                            </div>
                            <div className="text-lg font-semibold text-emerald-950">
                              С НДС: {remainingWithVat.toLocaleString("ru-RU")} ₽
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showCooQuotaSummary && cooQuotaSummary?.length ? (
            <Card>
              <CardContent className="pt-6">
                <div className="rounded-xl border border-sky-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(239,246,255,0.9)_100%)] p-4">
                  <div className="font-medium text-slate-900">Остаток квоты COO</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {cooQuotaSummary.map((item) => {
                      const quotaBase = item.adjustedQuota ?? item.quota;
                      const quotaBaseWithVat =
                        item.adjustedQuotaWithVat ?? item.quotaWithVat ?? quotaBase;
                      const remaining = quotaBase - item.spent;
                      const remainingWithVat =
                        quotaBaseWithVat - (item.spentWithVat ?? item.spent);
                      const isHighlighted = item.monthKey === highlightedQuotaMonthKey;
                      return (
                        <div
                          key={item.monthKey}
                          className={`rounded-lg border px-3 py-3 ${
                            isHighlighted
                              ? "border-sky-400 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.12)]"
                              : "border-sky-100/80 bg-white/80"
                          }`}
                        >
                          <div className="text-sm capitalize text-slate-900">
                            {formatMonthLabel(item.monthKey)}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">Остаток</div>
                          <div className="mt-1 space-y-1">
                            <div className="text-sm text-slate-700">
                              Без НДС: {remaining.toLocaleString("ru-RU")} ₽
                            </div>
                            <div className="text-lg font-semibold text-slate-950">
                              С НДС: {remainingWithVat.toLocaleString("ru-RU")} ₽
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Согласования</CardTitle>
              <CardDescription>Статус по ролям.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {approvals.length ? (
                approvals.map((approval) => (
                  <div key={approval._id} className="rounded-lg border border-border p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="font-medium">{getRoleLabel(approval.role)}</div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs ${
                          approval.status === "pending"
                            ? canDecide.has(approval.role)
                              ? "border-amber-200 bg-amber-100 text-amber-800"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                            : getApprovalStatusClass(approval.status)
                        }`}
                      >
                        {approval.status === "approved"
                          ? "Согласовано"
                          : approval.status === "rejected"
                            ? "Не согласовано"
                            : "Ожидает согласования"}
                      </span>
                    </div>
                    {approval.comment && (
                      <p className="mt-2 text-muted-foreground">Комментарий: {approval.comment}</p>
                    )}

                    {approval.status === "pending" && canDecide.has(approval.role) && (
                      <div className="mt-4 space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor={`comment-${approval.role}`}>Комментарий</Label>
                          <Textarea
                            id={`comment-${approval.role}`}
                            value={commentByRole[approval.role] ?? ""}
                            onChange={(event) =>
                              setCommentByRole((current) => ({
                                ...current,
                                [approval.role]: event.target.value,
                              }))
                            }
                            rows={3}
                            placeholder="Обязателен для отказа"
                          />
                        </div>
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            onClick={() => handleDecision(approval.role, "approved")}
                            disabled={submittingRole === approval.role}
                          >
                            Согласовать
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => handleDecision(approval.role, "rejected")}
                            disabled={submittingRole === approval.role}
                          >
                            Отклонить
                          </Button>
                        </div>
                      </div>
                    )}
                    {approval.status === "pending" && isAdmin && !canDecide.has(approval.role) ? (
                      <div className="mt-4 space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor={`admin-comment-${approval.role}`}>Комментарий админа</Label>
                          <Textarea
                            id={`admin-comment-${approval.role}`}
                            value={adminCommentByRole[approval.role] ?? ""}
                            onChange={(event) =>
                              setAdminCommentByRole((current) => ({
                                ...current,
                                [approval.role]: event.target.value,
                              }))
                            }
                            rows={2}
                            placeholder={`Например, согласовано как ${getRoleLabel(approval.role)}`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={async () => {
                            setError(null);
                            try {
                              await adminApproveAsRole({
                                requestId: request._id,
                                role: approval.role,
                                comment: adminCommentByRole[approval.role],
                              });
                              router.refresh();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Не удалось согласовать как роль");
                            }
                          }}
                        >
                          Согласовать как {getRoleLabel(approval.role)}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Согласование не требуется.</p>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Комментарии</CardTitle>
              <CardDescription>История обсуждения заявки.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-3">
                {(comments ?? []).length ? (
                  (comments ?? []).map((comment) => {
                    const author = comment.authorName
                      ? `${comment.authorName} · ${comment.authorEmail}`
                      : comment.authorEmail;
                    const createdAt = new Date(comment.createdAt).toLocaleString("ru-RU");
                    const canEdit = canEditComment(comment._id);
                    return (
                      <div
                        key={comment._id}
                        className={`rounded-lg border border-border px-4 py-3 ${
                          comment.parentId ? "ml-6 bg-muted/30" : "bg-background"
                        }`}
                      >
                        <div className="text-xs text-muted-foreground">
                          {author} · {createdAt}
                        </div>
                        {editingId === comment._id ? (
                          <form className="mt-2 space-y-2" onSubmit={handleEditComment}>
                            <Textarea
                              value={editingBody}
                              onChange={(event) => setEditingBody(event.target.value)}
                              rows={3}
                              required
                            />
                            <div className="flex gap-2">
                              <Button type="submit" size="sm">
                                Сохранить
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditingBody("");
                                }}
                              >
                                Отмена
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
                        )}
                        <div className="mt-2 flex gap-2 text-xs">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setReplyTo(comment._id)}
                          >
                            Ответить
                          </Button>
                          {canEdit && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(comment._id);
                                setEditingBody(comment.body);
                              }}
                            >
                              Редактировать
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">Комментариев пока нет.</p>
                )}
              </div>

              <form className="space-y-3" onSubmit={handleAddComment}>
                <Textarea
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  rows={3}
                  placeholder="Напишите комментарий"
                  required
                />
                {replyTo && (
                  <div className="text-xs text-muted-foreground">
                    Ответ на комментарий
                    <Button
                      type="button"
                      variant="ghost"
                      className="ml-2 h-auto px-2 py-1 text-xs"
                      onClick={() => setReplyTo(null)}
                    >
                      Отменить
                    </Button>
                  </div>
                )}
                <Button type="submit">Добавить комментарий</Button>
              </form>
            </CardContent>
          </Card>
          </div>

          <div className={activeTab === "changes" ? "block" : "hidden"}>
            <Card>
              <CardHeader>
                <CardTitle>Изменения заявки</CardTitle>
                <CardDescription>Что изменили, кто изменил и когда.</CardDescription>
              </CardHeader>
              <CardContent>
                {groupedChangeHistory.length ? (
                  <div className="space-y-3">
                    {groupedChangeHistory.map((group) => (
                      <div
                        key={group.id}
                        className="rounded-lg border border-border bg-background px-4 py-3 text-sm"
                      >
                        <div className="text-xs text-muted-foreground">
                          {group.authorName ? `${group.authorName} · ` : ""}
                          {group.authorEmail} · {new Date(group.createdAt).toLocaleString("ru-RU")}
                        </div>
                        {group.groupSummary ? (
                          <div className="mt-2 font-medium">{group.groupSummary}</div>
                        ) : null}
                        {group.triggeredRepeatApproval ? (
                          <div className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
                            Изменение вызвало повторное согласование
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-3">
                          {group.items.map((item) => (
                            <div key={item._id}>
                              <div className="font-medium">{item.field}</div>
                              <div className="mt-1 text-muted-foreground">
                                Было: {item.fromValue || "—"}
                              </div>
                              <div className="text-foreground">Стало: {item.toValue || "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Изменений пока нет.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className={activeTab === "timeline" ? "block" : "hidden"}>
            <Card>
              <CardHeader>
                <CardTitle>Таймлайн заявки</CardTitle>
                <CardDescription>События, письма и ошибки отправки.</CardDescription>
              </CardHeader>
              <CardContent>
                {timeline?.length ? (
                  <div className="space-y-3">
                    {timeline.map((item) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                        className={`rounded-lg border px-4 py-3 text-sm ${
                          item.kind === "email"
                            ? item.status === "failed"
                              ? "border-rose-200 bg-rose-50/60"
                              : "border-emerald-200 bg-emerald-50/40"
                            : "border-zinc-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.99)_0%,rgba(250,250,250,0.96)_100%)]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${
                                item.kind === "email"
                                  ? item.status === "failed"
                                    ? "border-rose-200 bg-white text-rose-700"
                                    : "border-emerald-200 bg-white text-emerald-700"
                                  : "border-zinc-200 bg-white text-zinc-600"
                              }`}
                            >
                              {item.kind === "email" ? "Письмо" : "Событие"}
                            </span>
                            <div className="font-medium">{item.title}</div>
                          </div>
                          {item.status ? (
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs ${
                                item.status === "failed"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              }`}
                            >
                              {item.status === "failed" ? "Ошибка" : "Отправлено"}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString("ru-RU")}
                          {item.actorName || item.actorEmail
                            ? ` · ${item.actorName ? `${item.actorName} · ` : ""}${item.actorEmail ?? ""}`
                            : ""}
                        </div>
                        {item.description ? (
                          <div className="mt-2 text-muted-foreground">{item.description}</div>
                        ) : null}
                        {item.metadata?.recipients?.length ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Получатели: {item.metadata.recipients.join(", ")}
                          </div>
                        ) : null}
                        {item.metadata?.rolesToReset?.length ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Сброшены роли: {item.metadata.rolesToReset.join(", ")}
                          </div>
                        ) : null}
                        {item.metadata?.addedRoles?.length ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Добавлены роли: {item.metadata.addedRoles.join(", ")}
                          </div>
                        ) : null}
                        {item.metadata?.removedRoles?.length ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Убраны роли: {item.metadata.removedRoles.join(", ")}
                          </div>
                        ) : null}
                        {item.metadata?.error ? (
                          <div className="mt-2 text-xs text-rose-700">{item.metadata.error}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Событий пока нет.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}
