import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  dedupeEmails,
  getApprovalRecipientsForApprovals,
  getApprovalRecipientsForTargets,
} from "../src/lib/approvalRecipients";
import {
  normalizeContestSpecialistSource,
  requiresContestSpecialistValidation,
} from "../src/lib/requestFields";
import { supportsRequestSpecialists, usesServiceRecipientLabel } from "../src/lib/requestRules";
import { hasFinanceApproverRole } from "../src/lib/financeRole";
import { formatAmountPair } from "../src/lib/vat";

const decisionEnum = v.union(v.literal("approved"), v.literal("rejected"));
const roleEnum = v.union(
  v.literal("AD"),
  v.literal("NBD"),
  v.literal("AI-BOSS"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("BUH"),
  v.literal("BUH Payment"),
  v.literal("BUH Transit"),
  v.literal("BUH Inside"),
  v.literal("BUH Outsource"),
  v.literal("HOD"),
  v.literal("ADMIN"),
);

const SPECIALIST_BUH_ROLES = ["BUH Inside", "BUH Outsource"] as const;

function formatApprovalStatusLabel(status: string) {
  if (status === "approved") {
    return "Согласовано";
  }
  if (status === "rejected") {
    return "Не согласовано";
  }
  if (status === "pending") {
    return "Ожидает согласования";
  }
  if (status === "hod_pending") {
    return "Ждет валидации цеха";
  }
  if (status === "awaiting_payment") {
    return "Требуется оплата";
  }
  if (status === "payment_planned") {
    return "Запланирована оплата";
  }
  if (status === "partially_paid") {
    return "Частично оплачено";
  }
  if (status === "paid") {
    return "Оплачено";
  }
  if (status === "closed") {
    return "Заявка закрыта";
  }
  return status;
}

function getRequestOwnerLabel(request: { category: string; clientName: string }) {
  return usesServiceRecipientLabel(request.category)
    ? {
        label: "Получатель сервиса",
        value: request.clientName,
      }
    : {
        label: "Клиент",
        value: request.clientName,
      };
}

const OUTSOURCE_CONTRACTOR_TYPES = ["ООО", "ИП", "ГПХ", "СЗ", "другое", "другое/не знаю"];

function requestHasInsideSpecialists(request: any) {
  return (request.specialists ?? []).some((item: any) => {
    if (normalizeContestSpecialistSource(item.sourceType) === "internal") {
      return true;
    }
    return (item.contractorTypes ?? []).includes("ГПХ");
  });
}

function requestHasOutsourceSpecialists(request: any) {
  return (request.specialists ?? []).some((item: any) => {
    if (normalizeContestSpecialistSource(item.sourceType) !== "contractor") {
      return false;
    }
    return (item.contractorTypes ?? []).some((type: string) =>
      OUTSOURCE_CONTRACTOR_TYPES.includes(type),
    );
  });
}

function getPaymentDeadlineLabel(request: any) {
  const timestamp = request.paymentDeadline ?? request.neededBy;
  return timestamp ? new Date(timestamp).toLocaleDateString("ru-RU") : "не задан";
}

function getDateKey(timestamp?: number) {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : undefined;
}

type PaymentPlanningRole = {
  active?: boolean;
  email: string;
  roles: string[];
};

function getPaymentPlanningRecipients(roles: PaymentPlanningRole[]) {
  return Array.from(
    new Set(
      roles
        .filter(
          (role) =>
            role.active &&
            (role.roles.includes("BUH Payment") || hasFinanceApproverRole(role)),
        )
        .map((role) => role.email),
    ),
  );
}

function formatDate(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleDateString("ru-RU") : "не указана";
}

function getBaseUrl() {
  return process.env.EMAIL_BASE_URL ?? "http://localhost:3000";
}

function getRequestAmountLabel(request: {
  amount: number;
  amountWithVat?: number;
  currency: string;
  vatRate?: number;
}) {
  return formatAmountPair({
    amountWithoutVat: request.amount,
    amountWithVat: request.amountWithVat,
    currency: request.currency,
    vatRate: request.vatRate,
  });
}

async function sendEmail(
  ctx: any,
  params: {
    requestId?: any;
    emailType: string;
    to: string[];
    subject: string;
    html: string;
  },
) {
  try {
    const emailApiBaseUrl = process.env.EMAIL_API_BASE_URL ?? process.env.EMAIL_BASE_URL ?? "http://localhost:3000";
    const response = await fetch(`${emailApiBaseUrl.replace(/\/+$/, "")}/api/email/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-email-api-key": process.env.EMAIL_API_KEY ?? "dev-email-key",
      },
      body: JSON.stringify({
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`SMTP error: ${message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP error";
    await ctx.runMutation(internal.timeline.recordEmailLog, {
      requestId: params.requestId,
      emailType: params.emailType,
      recipients: params.to,
      subject: params.subject,
      status: "failed",
      error: message,
    });
    throw new Error(message);
  }
  await ctx.runMutation(internal.timeline.recordEmailLog, {
    requestId: params.requestId,
    emailType: params.emailType,
    recipients: params.to,
    subject: params.subject,
    status: "sent",
  });
  if (params.requestId) {
    await ctx.runMutation(internal.timeline.recordTimelineEvent, {
      requestId: params.requestId,
      type: "email",
      title: "Письмо отправлено",
      description: `${params.emailType}: ${params.subject}`,
      actorEmail: undefined,
      actorName: undefined,
      metadata: undefined,
    });
  }
}

export const getRequestData = internalQuery({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return null;
    }
    const roles = await ctx.db.query("roles").collect();
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();
    return { request, roles, approvals };
  },
});

export const sendRequestSubmitted = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request, roles: roleDocs, approvals } = data;
    const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
    if (pendingApprovals.length === 0) {
      return;
    }
    const recipients = getApprovalRecipientsForApprovals(
      roleDocs,
      pendingApprovals.map((approval) => ({
        role: approval.role,
        department: approval.department,
      })),
      [request.createdByEmail],
    );
    if (recipients.length === 0) {
      return;
    }

    const link = `${getBaseUrl()}/requests/${request._id}`;
    const title = `${request.clientName} :: ${request.category}`;
    const requestTitle = request.title ?? title;
    const creator = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    const approvalDeadline = request.approvalDeadline
      ? new Date(request.approvalDeadline).toLocaleDateString("ru-RU")
      : "не задан";
    const paymentDeadline = getPaymentDeadlineLabel(request);
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "request_submitted",
      to: recipients,
      subject: `Запрос на согласование: ${title}`,
      html: `
        <p>Новая заявка от ${creator}.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>ID заявки: ${request.requestCode ?? "будет присвоен для новых заявок"}</p>
        <p><strong>${title}</strong></p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Дедлайн согласования: ${approvalDeadline}</p>
        <p>Дедлайн оплаты: ${paymentDeadline}</p>
        <p>Review: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendRequestCreatedToBuh = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    const recipients = dedupeEmails(
      roles
        .filter((role) => role.active && role.roles.includes("BUH"))
        .map((role) => role.email),
      [request.createdByEmail],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const creator = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "request_created_buh",
      to: recipients,
      subject: `Создана заявка: ${request.requestCode ?? request.category}`,
      html: `
        <p>Создана новая заявка.</p>
        <p>Автор: ${creator}</p>
        <p>На что нужен бюджет: <strong>${requestTitle}</strong></p>
        <p>Тип заявки: ${request.category}</p>
        <p>Источник финансирования: ${request.fundingSource}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendSpecialistBuhNotifications = internalAction({
  args: {
    requestId: v.id("requests"),
    targetRoles: v.optional(v.array(roleEnum)),
    summaryLines: v.optional(v.array(v.string())),
    actorEmail: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    const recipientRoles = args.targetRoles?.length
      ? Array.from(
          new Set(
            args.targetRoles.filter((role) =>
              (SPECIALIST_BUH_ROLES as readonly string[]).includes(role),
            ),
          ),
        )
      : [
          requestHasInsideSpecialists(request) ? "BUH Inside" : undefined,
          requestHasOutsourceSpecialists(request) ? "BUH Outsource" : undefined,
        ].filter(Boolean) as string[];
    if (!recipientRoles.length) {
      return;
    }
    const recipients = roles
      .filter((role) => role.active && role.roles.some((item: string) => recipientRoles.includes(item)))
      .map((role) => role.email);
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const isUpdate = Boolean(args.summaryLines?.length);
    const actor = args.actorName ? `${args.actorName} (${args.actorEmail})` : args.actorEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: isUpdate ? "specialist_buh_update_notification" : "specialist_buh_notification",
      to: Array.from(new Set(recipients)),
      subject: isUpdate
        ? `Изменены специалисты в заявке: ${request.requestCode ?? request.category}`
        : `В заявке есть специалисты: ${request.requestCode ?? request.category}`,
      html: `
        <p>${
          isUpdate
            ? "В заявке изменились штатные специалисты или подрядчики."
            : "В заявке есть штатные специалисты или подрядчики, требующие внимания бухгалтерии."
        }</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        ${actor ? `<p>Кто изменил: ${actor}</p>` : ""}
        ${isUpdate ? `<ul>${(args.summaryLines ?? []).map((line) => `<li>${line}</li>`).join("")}</ul>` : ""}
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendSpecialRoleBackfillNotification = internalAction({
  args: {
    requestId: v.id("requests"),
    targetRoles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data || args.targetRoles.length === 0) {
      return;
    }
    const { request, roles } = data;
    const recipients = dedupeEmails(
      roles
        .filter((role) => role.active && role.roles.some((item: string) => args.targetRoles.includes(item)))
        .map((role) => role.email),
      [request.createdByEmail],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "special_role_backfill",
      to: recipients,
      subject: `Актуальная заявка доступна вам: ${request.requestCode ?? request.category}`,
      html: `
        <p>Эта заявка уже есть в сервисе и теперь доступна вашей роли.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Тип заявки: ${request.category}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendDecision = internalAction({
  args: {
    requestId: v.id("requests"),
    decision: decisionEnum,
    role: roleEnum,
    comment: v.optional(v.string()),
    reviewerName: v.optional(v.string()),
    reviewerEmail: v.optional(v.string()),
    requestStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const decisionLabel = args.decision === "approved" ? "согласована" : "отклонена";
    const owner = getRequestOwnerLabel(request);
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const decisionBy = args.reviewerName
      ? `${args.reviewerName}, ${args.role}`
      : args.reviewerEmail
        ? `${args.reviewerEmail}, ${args.role}`
        : args.role;
    const isFinalApproval = args.decision === "approved" && args.requestStatus === "approved";
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "decision",
      to: [request.createdByEmail],
      subject: isFinalApproval
        ? `Заявка согласована: ${request.category} · ${request.requestCode ?? "без номера"}`
        : `${request.clientName} :: ${request.category}`,
      html: `
        <p>Заявка ${decisionLabel}.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Дата: ${new Date().toLocaleDateString("ru-RU")}</p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Источник финансирования: ${request.fundingSource}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Статус согласования: ${formatApprovalStatusLabel(args.requestStatus)}</p>
        <p>Кто согласовал: ${decisionBy}</p>
        ${isFinalApproval ? "<p>Передайте заявку в оплату.</p>" : ""}
        ${args.comment ? `<p>Комментарий: ${args.comment}</p>` : ""}
        <p>View: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendApprovalReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    remindedByEmail: v.string(),
    remindedByName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles: roleDocs, approvals } = data;
    const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
    const recipients = getApprovalRecipientsForApprovals(
      roleDocs,
      pendingApprovals.map((approval) => ({
        role: approval.role,
        department: approval.department,
      })),
      [request.createdByEmail, args.remindedByEmail],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const remindedBy = args.remindedByName
      ? `${args.remindedByName} (${args.remindedByEmail})`
      : args.remindedByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_reminder",
      to: recipients,
      subject: `Напоминание о согласовании: ${request.requestCode ?? request.clientName}`,
      html: `
        <p>Напоминаем о согласовании заявки.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Напомнил: ${remindedBy}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentPlanningRequested = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request, roles } = data;
    const recipients = getPaymentPlanningRecipients(roles);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const owner = getRequestOwnerLabel(request);
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const paymentDeadline = getPaymentDeadlineLabel(request);
    const author = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_planning_requested",
      to: recipients,
      subject: `Заявка согласована: запланируйте оплату ${request.requestCode ?? request.category}`,
      html: `
        <p>Заявка полностью согласована. Нужно запланировать оплату.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Номер заявки: ${request.requestCode ?? "не указан"}</p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Автор заявки: ${author}</p>
        <p>Дедлайн оплаты: ${paymentDeadline}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentRequested = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request, roles } = data;
    const buhRecipients = getPaymentPlanningRecipients(roles);
    if (buhRecipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const owner = getRequestOwnerLabel(request);
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const paymentDeadline = getPaymentDeadlineLabel(request);
    const author = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_requested",
      to: buhRecipients,
      subject: `Требуется оплата: ${request.category}, ${owner.value}`,
      html: `
        <p>Заявка переведена в статус <strong>Требуется оплата</strong>.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Номер заявки: ${request.requestCode ?? "не указан"}</p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Автор заявки: ${author}</p>
        <p>Дедлайн оплаты: ${paymentDeadline}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentRequestedToAuthor = internalAction({
  args: {
    requestId: v.id("requests"),
    actorEmail: v.string(),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const actor = args.actorName ? `${args.actorName} (${args.actorEmail})` : args.actorEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_requested_author",
      to: [request.createdByEmail],
      subject: `Заявка передана в оплату: ${request.requestCode ?? request.category}`,
      html: `
        <p>Заявка переведена в оплату.</p>
        <p>Кто передал: ${actor}</p>
        <p>Дедлайн оплаты: ${getPaymentDeadlineLabel(request)}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendOperationalFieldsChanged = internalAction({
  args: {
    requestId: v.id("requests"),
    summaryLines: v.array(v.string()),
    actorEmail: v.string(),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const actor = args.actorName ? `${args.actorName} (${args.actorEmail})` : args.actorEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "operational_fields_changed",
      to: [request.createdByEmail],
      subject: `В заявке изменены суммы или даты: ${request.requestCode ?? request.category}`,
      html: `
        <p>В заявке изменились финансовые поля.</p>
        <p>Кто изменил: ${actor}</p>
        <ul>${args.summaryLines.map((line) => `<li>${line}</li>`).join("")}</ul>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendRequestUpdatedSummary = internalAction({
  args: {
    requestId: v.id("requests"),
    recipients: v.array(v.string()),
    summaryLines: v.array(v.string()),
    repeatedApproval: v.boolean(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data || args.recipients.length === 0) {
      return;
    }
    const { request } = data;
    const recipients = dedupeEmails(args.recipients, [request.createdByEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const title = request.title ?? `${request.clientName} :: ${request.category}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "request_updated_summary",
      to: recipients,
      subject: args.repeatedApproval
        ? `Повторное согласование: ${request.requestCode ?? "без номера"}`
        : `В заявку внесены изменения: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>По заявке <strong>${title}</strong> внесены изменения.</p>
        ${args.repeatedApproval ? "<p>Заявка отправлена на повторное согласование.</p>" : ""}
        <ul>
          ${args.summaryLines.map((line) => `<li>${line}</li>`).join("")}
        </ul>
        <p>Подробности доступны в истории изменений заявки.</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendApprovalCanceled = internalAction({
  args: {
    requestId: v.id("requests"),
    recipients: v.array(v.string()),
    roles: v.array(v.string()),
    summaryLines: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const recipients = dedupeEmails(args.recipients, [request.createdByEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const title = request.title ?? `${request.clientName} :: ${request.category}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_canceled",
      to: recipients,
      subject: `Согласование отменено: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>По заявке <strong>${title}</strong> обновился маршрут согласования.</p>
        <p>Ваше согласование больше не требуется${args.roles.length ? ` по ролям: ${args.roles.join(", ")}` : ""}.</p>
        ${
          args.summaryLines.length
            ? `<ul>${args.summaryLines.map((line) => `<li>${line}</li>`).join("")}</ul>`
            : ""
        }
        <p>Подробности доступны в истории изменений.</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendApprovalRequestedToRecipients = internalAction({
  args: {
    requestId: v.id("requests"),
    recipients: v.array(v.string()),
    summaryLines: v.array(v.string()),
    repeatedApproval: v.boolean(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const recipients = dedupeEmails(args.recipients, [request.createdByEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const title = request.title ?? `${request.clientName} :: ${request.category}`;
    const owner = getRequestOwnerLabel(request);
    const approvalDeadline = request.approvalDeadline
      ? new Date(request.approvalDeadline).toLocaleDateString("ru-RU")
      : "не задан";
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_requested_repeat",
      to: recipients,
      subject: args.repeatedApproval
        ? `Повторное согласование: ${request.requestCode ?? "без номера"}`
        : `Нужно согласование: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>${args.repeatedApproval ? "Заявка изменена и требует повторного согласования." : "Заявка требует согласования."}</p>
        <p>Наименование заявки: <strong>${title}</strong></p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Источник финансирования: ${request.fundingSource}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Дедлайн согласования: ${approvalDeadline}</p>
        ${
          args.summaryLines.length
            ? `<ul>${args.summaryLines.map((line) => `<li>${line}</li>`).join("")}</ul>`
            : ""
        }
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendAdditionalApprovalRequested = internalAction({
  args: {
    requestId: v.id("requests"),
    targets: v.array(
      v.object({
        role: roleEnum,
        department: v.optional(v.string()),
      }),
    ),
    requestedByRole: roleEnum,
    requestedByName: v.optional(v.string()),
    requestedByEmail: v.optional(v.string()),
    forwardMode: v.optional(v.union(v.literal("approve"), v.literal("defer"))),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    const recipients = getApprovalRecipientsForTargets(roles, args.targets, [request.createdByEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const owner = getRequestOwnerLabel(request);
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const requestedBy = args.requestedByName
      ? `${args.requestedByName}, ${args.requestedByRole}`
      : args.requestedByEmail
        ? `${args.requestedByEmail}, ${args.requestedByRole}`
        : args.requestedByRole;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_requested_additional",
      to: recipients,
      subject: `Дополнительное согласование: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>${
          args.forwardMode === "defer"
            ? "Заявка передана вам на дополнительное согласование, пока текущий согласующий отложил свое решение."
            : "Заявка передана вам на дополнительное согласование."
        }</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Источник финансирования: ${request.fundingSource}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Кто отправил дальше: ${requestedBy}</p>
        <p>Кому передали: ${args.targets
          .map((target) =>
            target.role === "HOD" && target.department
              ? `Руководитель цеха · ${target.department}`
              : target.role,
          )
          .join(", ")}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendAdditionalApprovalForwardedToAuthor = internalAction({
  args: {
    requestId: v.id("requests"),
    targets: v.array(
      v.object({
        role: roleEnum,
        department: v.optional(v.string()),
      }),
    ),
    requestedByRole: roleEnum,
    requestedByName: v.optional(v.string()),
    requestedByEmail: v.optional(v.string()),
    forwardMode: v.optional(v.union(v.literal("approve"), v.literal("defer"))),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const requestedBy = args.requestedByName
      ? `${args.requestedByName}, ${args.requestedByRole}`
      : args.requestedByEmail
        ? `${args.requestedByEmail}, ${args.requestedByRole}`
        : args.requestedByRole;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_forwarded_to_author",
      to: [request.createdByEmail],
      subject: `Отправлено на дополнительное согласование: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>${
          args.forwardMode === "defer"
            ? "Заявка отправлена на дополнительное согласование, а текущий согласующий отложил свое решение."
            : "Заявка отправлена на дополнительное согласование."
        }</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Кто отправил: ${requestedBy}</p>
        <p>Кому передали: ${args.targets
          .map((target) =>
            target.role === "HOD" && target.department
              ? `Руководитель цеха · ${target.department}`
              : target.role,
          )
          .join(", ")}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendCommentMentioned = internalAction({
  args: {
    requestId: v.id("requests"),
    recipients: v.array(v.string()),
    authorEmail: v.string(),
    authorName: v.optional(v.string()),
    commentBody: v.string(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data || args.recipients.length === 0) {
      return;
    }
    const { request } = data;
    const recipients = dedupeEmails(args.recipients, [args.authorEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const author = args.authorName ? `${args.authorName} (${args.authorEmail})` : args.authorEmail;
    const excerpt = args.commentBody.length > 280 ? `${args.commentBody.slice(0, 277)}...` : args.commentBody;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "comment_mentioned",
      to: recipients,
      subject: `Вас отметили в комментарии: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>Вас отметили в комментарии к заявке.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Кто отметил: ${author}</p>
        <p>Комментарий: ${excerpt}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendDeferredApprovalResolved = internalAction({
  args: {
    requestId: v.id("requests"),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    resolvedRole: roleEnum,
    resolvedDepartment: v.optional(v.string()),
    resolverEmail: v.string(),
    resolverName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const resolver = args.resolverName
      ? `${args.resolverName} (${args.resolverEmail})`
      : args.resolverEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "deferred_approval_resolved",
      to: [args.recipientEmail],
      subject: `Дополнительное согласование завершено: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>Дополнительное согласование завершено, можно вернуться к своему решению.</p>
        <p>Наименование заявки: <strong>${request.title ?? `${request.clientName} :: ${request.category}`}</strong></p>
        <p>Кто согласовал: ${resolver}</p>
        <p>Роль: ${
          args.resolvedRole === "HOD" && args.resolvedDepartment
            ? `Руководитель цеха · ${args.resolvedDepartment}`
            : args.resolvedRole
        }</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendRequestViewerAccessGranted = internalAction({
  args: {
    requestId: v.id("requests"),
    recipients: v.array(v.string()),
    grantedByEmail: v.string(),
    grantedByName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data || args.recipients.length === 0) {
      return;
    }
    const { request } = data;
    const recipients = dedupeEmails(args.recipients, [args.grantedByEmail]);
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const grantedBy = args.grantedByName
      ? `${args.grantedByName} (${args.grantedByEmail})`
      : args.grantedByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "request_viewer_access_granted",
      to: recipients,
      subject: `Вам дали доступ к заявке: ${request.requestCode ?? "без номера"}`,
      html: `
        <p>Для вас открыли просмотр и комментарии по заявке.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Кто выдал доступ: ${grantedBy}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentPlanned = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const paymentDeadline = request.paymentDeadline ?? request.neededBy;
    const plannedDateDiffersFromDeadline = Boolean(
      request.paymentPlannedAt &&
        paymentDeadline &&
        getDateKey(request.paymentPlannedAt) !== getDateKey(paymentDeadline),
    );
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_planned",
      to: [request.createdByEmail],
      subject: plannedDateDiffersFromDeadline
        ? `Дата оплаты отличается от дедлайна: ${request.clientName}`
        : `Оплата запланирована: ${request.clientName}`,
      html: `
        <p>BUH запланировал оплату по заявке.</p>
        <p>Дата оплаты: ${formatDate(request.paymentPlannedAt)}</p>
        ${
          plannedDateDiffersFromDeadline
            ? `<p><strong>Дата оплаты отличается от дедлайна автора.</strong></p>
               <p>Дедлайн оплаты в заявке: ${formatDate(paymentDeadline)}</p>`
            : ""
        }
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPlannedPaymentReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    paymentPlannedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    if (
      request.isCanceled ||
      ["draft", "hod_pending", "pending", "rejected", "paid", "closed"].includes(request.status)
    ) {
      return;
    }
    const targetDateKey = getDateKey(args.paymentPlannedAt);
    const plannedPayments = [
      ...(request.paymentSplits ?? [])
        .filter((split: any) => split.nextPaymentAt && getDateKey(split.nextPaymentAt) === targetDateKey)
        .map((split: any) => ({
          amountWithoutVat: split.remainingAmountWithoutVat,
          amountWithVat: undefined,
          vatRate: split.vatRate ?? request.vatRate,
        })),
      ...(request.plannedPaymentSplits ?? []).filter(
        (split: any) => getDateKey(split.plannedAt) === targetDateKey,
      ),
      ...(getDateKey(request.paymentPlannedAt) === targetDateKey
        ? [
            {
              amountWithoutVat: request.plannedPaymentAmount,
              amountWithVat: request.plannedPaymentAmountWithVat,
              vatRate: request.vatRate,
            },
          ]
        : []),
    ].filter((item: any) => item.amountWithoutVat !== undefined || item.amountWithVat !== undefined);
    if (!plannedPayments.length) {
      return;
    }
    const recipients = dedupeEmails(
      roles
        .filter((role) => role.active && role.roles.includes("BUH Payment"))
        .map((role) => role.email),
      [],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const amountLines = plannedPayments
      .map((payment: any) =>
        `<li>${formatAmountPair({
          amountWithoutVat: payment.amountWithoutVat,
          amountWithVat: payment.amountWithVat,
          currency: request.currency,
          vatRate: payment.vatRate ?? request.vatRate,
        })}</li>`,
      )
      .join("");
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "planned_payment_reminder",
      to: recipients,
      subject: `Сегодня нужно оплатить: ${request.requestCode ?? request.clientName}`,
      html: `
        <p>На сегодня запланирована оплата по заявке.</p>
        <p>Дата оплаты: ${formatDate(args.paymentPlannedAt)}</p>
        <p>Сумма:</p>
        <ul>${amountLines}</ul>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
    await ctx.runMutation(internal.requests.markReminderSent, {
      requestId: args.requestId,
      kind: "payment",
      expectedAt: args.paymentPlannedAt,
    });
  },
});

export const sendPaymentDeadlineReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    paymentDeadline: v.number(),
    reminderKind: v.union(v.literal("before"), v.literal("overdue")),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    const dateKey = `${args.reminderKind}:${new Date().toISOString().slice(0, 10)}`;
    if (
      request.status === "paid" ||
      request.status === "closed" ||
      (request.paymentDeadline ?? request.neededBy) !== args.paymentDeadline ||
      request.paymentDeadlineReminderLastDateKey === dateKey
    ) {
      return;
    }
    const buhRecipients = roles
      .filter((role) => role.active && role.roles.includes("BUH Payment"))
      .map((role) => role.email);
    const recipients = Array.from(new Set(buhRecipients));
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const isBefore = args.reminderKind === "before";
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_deadline_reminder",
      to: recipients,
      subject: isBefore
        ? `Завтра дедлайн оплаты: ${request.requestCode ?? request.clientName}`
        : `Просрочен дедлайн оплаты: ${request.requestCode ?? request.clientName}`,
      html: `
        <p>${isBefore ? "Завтра дедлайн оплаты по заявке." : "Оплата по заявке просрочена."}</p>
        <p>Дедлайн оплаты: ${getPaymentDeadlineLabel(request)}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
    await ctx.runMutation(internal.requests.markReminderSent, {
      requestId: args.requestId,
      kind: "payment",
      expectedAt: args.paymentDeadline,
      dateKey,
    });
    if (args.reminderKind === "overdue") {
      await ctx.scheduler.runAfter(24 * 60 * 60 * 1000, internal.emails.sendPaymentDeadlineReminder, {
        requestId: args.requestId,
        paymentDeadline: args.paymentDeadline,
        reminderKind: "overdue",
      });
    }
  },
});

export const sendManualPaymentReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    remindedByEmail: v.string(),
    remindedByName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles } = data;
    const recipients = dedupeEmails(
      roles
        .filter((role) => role.active && role.roles.includes("BUH Payment"))
        .map((role) => role.email),
      [args.remindedByEmail],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const remindedBy = args.remindedByName
      ? `${args.remindedByName} (${args.remindedByEmail})`
      : args.remindedByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_reminder",
      to: recipients,
      subject: `Напоминание об оплате: ${request.requestCode ?? request.clientName}`,
      html: `
        <p>Напоминаем об оплате заявки.</p>
        <p>Напомнил: ${remindedBy}</p>
        <p>Сумма: ${getRequestAmountLabel(request)}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaidNotification = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "paid_notification",
      to: [request.createdByEmail],
      subject: `Заявка оплачена: ${request.clientName}`,
      html: `
        <p>Заявка переведена в статус <strong>Оплачено</strong>.</p>
        <p>Пожалуйста, закройте заявку до конца следующего рабочего дня.</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentAmountChanged = internalAction({
  args: {
    requestId: v.id("requests"),
    previousAmount: v.optional(v.number()),
    previousAmountWithVat: v.optional(v.number()),
    nextAmount: v.optional(v.number()),
    nextAmountWithVat: v.optional(v.number()),
    actorEmail: v.string(),
    actorName: v.optional(v.string()),
    changedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const actor = args.actorName ? `${args.actorName} · ${args.actorEmail}` : args.actorEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_amount_changed",
      to: [request.createdByEmail],
      subject: `Сумма оплаты изменена: ${request.clientName}`,
      html: `
        <p>BUH изменил сумму оплаты по заявке.</p>
        <p>Кто изменил: ${actor}</p>
        <p>Когда: ${new Date(args.changedAt).toLocaleString("ru-RU")}</p>
        <p>Было: ${formatAmountPair({
          amountWithoutVat: args.previousAmount,
          amountWithVat: args.previousAmountWithVat,
          currency: request.currency,
          vatRate: request.vatRate,
        })}</p>
        <p>Стало: ${formatAmountPair({
          amountWithoutVat: args.nextAmount,
          amountWithVat: args.nextAmountWithVat,
          currency: request.currency,
          vatRate: request.vatRate,
        })}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendCloseDeadlineReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    paidAt: v.number(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request } = data;
    if (request.status !== "paid" || request.paidAt !== args.paidAt || request.closeReminderSentAt) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "close_deadline_reminder",
      to: [request.createdByEmail],
      subject: `Нужно закрыть заявку: ${request.clientName}`,
      html: `
        <p>Пора закрыть заявку: срок закрытия истек.</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
    await ctx.runMutation(internal.requests.markReminderSent, {
      requestId: args.requestId,
      kind: "close",
      expectedAt: args.paidAt,
    });
  },
});

export const sendApprovalDeadlineReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    approvalDeadline: v.number(),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      return;
    }
    const { request, roles, approvals } = data;
    if (
      request.status !== "pending" ||
      request.approvalDeadline !== args.approvalDeadline ||
      request.approvalReminderSentAt
    ) {
      return;
    }
    const recipients = getApprovalRecipientsForApprovals(
      roles,
      approvals
        .filter((approval) => approval.status === "pending")
        .map((approval) => ({
          role: approval.role,
          department: approval.department,
        })),
      [request.createdByEmail],
    );
    if (!recipients.length) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "approval_deadline_reminder",
      to: recipients,
      subject: `Просрочено согласование: ${request.requestCode ?? request.clientName}`,
      html: `
        <p>Срок согласования по заявке истек вчера.</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
    await ctx.runMutation(internal.requests.markReminderSent, {
      requestId: args.requestId,
      kind: "approval",
      expectedAt: args.approvalDeadline,
    });
  },
});

export const sendHodValidationRequest = internalAction({
  args: {
    requestId: v.id("requests"),
  },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emails.getRequestData, {
      requestId: args.requestId,
    });
    if (!data) {
      throw new Error("Request not found");
    }
    const { request, roles } = data;
    if (!supportsRequestSpecialists(request.category)) {
      return;
    }
    const specialists = request.specialists ?? [];
    const departments = Array.from(
      new Set(
        [
          ...specialists
            .filter((item: { department?: string; validationSkipped?: boolean }) =>
              requiresContestSpecialistValidation(item),
            )
            .map((item: { department?: string }) => item.department?.trim())
            .filter(Boolean),
        ],
      ),
    ) as string[];
    if (departments.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const author = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    const hodRecipients = roles.filter(
      (role) =>
        role.active &&
        role.roles.includes("HOD") &&
        (role.hodDepartments ?? []).some((dep: string) => departments.includes(dep)),
    );
    for (const recipient of hodRecipients) {
      const visibleDepartments = recipient.hodDepartments ?? [];
      const specialistRows = specialists
        .filter(
          (item: any) =>
            (
              requiresContestSpecialistValidation(item) &&
              item.department &&
              visibleDepartments.includes(item.department)
            ),
        )
        .map(
          (item: any) => `
            <li>
              ${normalizeContestSpecialistSource(item.sourceType) === "contractor" ? "Специалист подрядчика" : "Штатный специалист"}: ${item.name || "Не указан"}<br />
              ${item.contractorLegalEntity ? `ЮЛ подрядчика/поставщика: ${item.contractorLegalEntity}<br />` : ""}
              Цех: ${item.department || "Не указан"}<br />
              ${(item.contractorTypes ?? []).length ? `Тип подрядчика: ${(item.contractorTypes ?? []).join(", ")}<br />` : ""}
              Часы: ${item.hours ?? "Не указаны"}<br />
              Прямые затраты: ${item.directCost ?? "Не указаны"}<br />
              Налоги: ${item.taxAmount ?? "Не указаны"}
            </li>
          `,
        )
        .join("");
      if (!specialistRows) {
        continue;
      }
      await sendEmail(ctx, {
        requestId: args.requestId,
        emailType: "hod_validation_request",
        to: [recipient.email],
        subject: `Валидация цеха: ${request.clientName} :: ${request.category}`,
        html: `
          <p>Пожалуйста, провалидируйте или впишите прямую затрату на специалиста.</p>
          <p>Автор заявки: ${author}</p>
          <p>Наименование заявки: <strong>${requestTitle}</strong></p>
          <p><strong>${request.clientName} :: ${request.category}</strong></p>
          <ul>${specialistRows}</ul>
          <p>Ссылка: <a href="${link}">${link}</a></p>
        `,
      });
    }
  },
});
