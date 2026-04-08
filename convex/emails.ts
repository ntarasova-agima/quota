import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const decisionEnum = v.union(v.literal("approved"), v.literal("rejected"));
const roleEnum = v.union(
  v.literal("AD"),
  v.literal("NBD"),
  v.literal("AI-BOSS"),
  v.literal("COO"),
  v.literal("CFD"),
  v.literal("BUH"),
  v.literal("HOD"),
  v.literal("ADMIN"),
);

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
  return request.category === "Закупка сервисов"
    ? {
        label: "Получатель сервиса",
        value: request.clientName,
      }
    : {
        label: "Клиент",
        value: request.clientName,
      };
}

function getBaseUrl() {
  return process.env.EMAIL_BASE_URL ?? "http://localhost:3000";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function dedupeEmails(emails: string[], excludedEmails: string[] = []) {
  const excluded = new Set(excludedEmails.map(normalizeEmail));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const normalized = normalizeEmail(email);
    if (!normalized || excluded.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(email);
  }
  return result;
}

function getActiveRoleEmails(roleDocs: Array<{ active: boolean; roles: string[]; email: string }>, roles: string[]) {
  if (!roles.length) {
    return [];
  }
  return dedupeEmails(
    roleDocs
      .filter((doc) => doc.active && doc.roles.some((role) => roles.includes(role)))
      .map((doc) => doc.email),
  );
}

function getApprovalRecipients(
  roleDocs: Array<{ active: boolean; roles: string[]; email: string }>,
  roles: string[],
  excludedEmails: string[] = [],
) {
  if (!roles.length) {
    return [];
  }
  const recipients = new Set<string>();
  const adminFallback = dedupeEmails(getActiveRoleEmails(roleDocs, ["ADMIN"]), excludedEmails);
  for (const role of roles) {
    const assignedRecipients = dedupeEmails(getActiveRoleEmails(roleDocs, [role]), excludedEmails);
    if (assignedRecipients.length > 0) {
      assignedRecipients.forEach((email) => recipients.add(email));
      continue;
    }
    adminFallback.forEach((email) => recipients.add(email));
  }
  return Array.from(recipients);
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
    const { request, roles: roleDocs } = data;
    const roles = request.requiredRoles;
    if (roles.length === 0) {
      return;
    }
    const recipients = getApprovalRecipients(roleDocs, roles, [request.createdByEmail]);
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
    const neededBy = request.neededBy
      ? new Date(request.neededBy).toLocaleDateString("ru-RU")
      : "не задано";
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
        <p>Сумма: ${request.amount} ${request.currency}</p>
        <p>Дедлайн согласования: ${approvalDeadline}</p>
        <p>Нужны деньги к: ${neededBy}</p>
        <p>Review: <a href="${link}">${link}</a></p>
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
        <p>Сумма: ${request.amount} ${request.currency}</p>
        <p>Статус согласования: ${formatApprovalStatusLabel(args.requestStatus)}</p>
        <p>Кто согласовал: ${decisionBy}</p>
        ${isFinalApproval ? "<p>Передайте заявку в оплату.</p>" : ""}
        ${args.comment ? `<p>Комментарий: ${args.comment}</p>` : ""}
        <p>View: <a href="${link}">${link}</a></p>
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
    const { request, roles, approvals } = data;
    const buhRecipients = roles
      .filter((role) => role.active && role.roles.includes("BUH"))
      .map((role) => role.email);
    if (buhRecipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const owner = getRequestOwnerLabel(request);
    const requestTitle = request.title ?? `${request.clientName} :: ${request.category}`;
    const paymentDeadline = request.neededBy
      ? new Date(request.neededBy).toLocaleDateString("ru-RU")
      : "не задан";
    const author = request.createdByName
      ? `${request.createdByName} (${request.createdByEmail})`
      : request.createdByEmail;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_requested",
      to: Array.from(new Set(buhRecipients)),
      subject: `Требуется оплата: ${request.category}, ${owner.value}`,
      html: `
        <p>Заявка переведена в статус <strong>Требуется оплата</strong>.</p>
        <p>Наименование заявки: <strong>${requestTitle}</strong></p>
        <p>Номер заявки: ${request.requestCode ?? "не указан"}</p>
        <p>${owner.label}: ${owner.value}</p>
        <p>Автор заявки: ${author}</p>
        <p>Дедлайн оплаты: ${paymentDeadline}</p>
        <p>Сумма: ${request.amount} ${request.currency}</p>
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
    const link = `${getBaseUrl()}/requests/${request._id}`;
    const title = request.title ?? `${request.clientName} :: ${request.category}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "request_updated_summary",
      to: Array.from(new Set(args.recipients)),
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
        <p>Сумма: ${request.amount} ${request.currency}</p>
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
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_planned",
      to: [request.createdByEmail],
      subject: `Оплата запланирована: ${request.clientName}`,
      html: `
        <p>BUH запланировал оплату по заявке.</p>
        <p>Дата оплаты: ${
          request.paymentPlannedAt
            ? new Date(request.paymentPlannedAt).toLocaleDateString("ru-RU")
            : "не указана"
        }</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
  },
});

export const sendPaymentDeadlineReminder = internalAction({
  args: {
    requestId: v.id("requests"),
    plannedAt: v.number(),
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
      request.status === "paid" ||
      request.status === "closed" ||
      request.paymentPlannedAt !== args.plannedAt ||
      request.paymentReminderSentAt
    ) {
      return;
    }
    const buhRecipients = roles
      .filter((role) => role.active && role.roles.includes("BUH"))
      .map((role) => role.email);
    const recipients = Array.from(new Set([request.createdByEmail, ...buhRecipients]));
    if (recipients.length === 0) {
      return;
    }
    const link = `${getBaseUrl()}/requests/${request._id}`;
    await sendEmail(ctx, {
      requestId: args.requestId,
      emailType: "payment_deadline_reminder",
      to: recipients,
      subject: `Дедлайн оплаты истек: ${request.clientName}`,
      html: `
        <p>Срок оплаты по заявке истек вчера.</p>
        <p>Сумма: ${request.amount} ${request.currency}</p>
        <p>Ссылка: <a href="${link}">${link}</a></p>
      `,
    });
    await ctx.runMutation(internal.requests.markReminderSent, {
      requestId: args.requestId,
      kind: "payment",
      expectedAt: args.plannedAt,
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
    const pendingRoles = approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => approval.role);
    const recipients = getApprovalRecipients(roles, pendingRoles, [request.createdByEmail]);
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
    if (request.category !== "Конкурсное задание") {
      return;
    }
    const specialists = request.specialists ?? [];
    const departments = Array.from(
      new Set(
        specialists
          .map((item: { department?: string }) => item.department?.trim())
          .filter(Boolean),
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
          (item: { department?: string }) =>
            item.department && visibleDepartments.includes(item.department),
        )
        .map(
          (item: {
            name?: string;
            department?: string;
            hours?: number;
            directCost?: number;
          }) => `
            <li>
              Специалист: ${item.name || "Не указан"}<br />
              Цех: ${item.department || "Не указан"}<br />
              Часы: ${item.hours ?? "Не указаны"}<br />
              Прямые затраты: ${item.directCost ?? "Не указаны"}
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
