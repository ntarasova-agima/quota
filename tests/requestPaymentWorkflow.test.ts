import { describe, expect, it } from "vitest";
import {
  adminBackfillPaymentDeadlineReminders,
  adminBackfillCompletedRequestClosures,
  adminBackfillWelcomeBonusPaymentState,
  applyFinplanPaymentPreview,
  sendDailyPaymentDeadlineReminders,
  updatePaymentStatus,
  updateSpecialistFot,
} from "../convex/requests";

type TableName = "requests" | "roles" | "requestTimelineEvents" | "requestChangeLogs";

type FakeDb = {
  tables: Record<TableName, Map<string, any>>;
  get: (id: string) => Promise<any>;
  patch: (id: string, patch: Record<string, any>) => Promise<void>;
  insert: (table: TableName, row: Record<string, any>) => Promise<string>;
  query: (table: TableName) => {
    withIndex: (_indexName: string, callback: (query: { eq: (field: string, value: any) => { field: string; value: any } }) => { field: string; value: any }) => {
      first: () => Promise<any>;
      collect: () => Promise<any[]>;
    };
    collect: () => Promise<any[]>;
  };
};

const USER_ID = "user_finance";
const REQUEST_ID = "request_1";

function createFakeDb(initialRequest: Record<string, any>, roleRecord: Record<string, any>): FakeDb {
  const tables: FakeDb["tables"] = {
    requests: new Map([[REQUEST_ID, { _id: REQUEST_ID, ...initialRequest }]]),
    roles: new Map([[roleRecord.email, { _id: "role_1", ...roleRecord }]]),
    requestTimelineEvents: new Map(),
    requestChangeLogs: new Map(),
  };

  let nextId = 1;

  function rows(table: TableName) {
    return Array.from(tables[table].values());
  }

  return {
    tables,
    async get(id: string) {
      for (const table of Object.values(tables)) {
        if (table.has(id)) {
          return table.get(id);
        }
      }
      return null;
    },
    async patch(id: string, patch: Record<string, any>) {
      for (const table of Object.values(tables)) {
        if (table.has(id)) {
          const current = table.get(id);
          table.set(id, { ...current, ...patch });
          return;
        }
      }
      throw new Error(`Missing row ${id}`);
    },
    async insert(table: TableName, row: Record<string, any>) {
      const id = `${table}_${nextId++}`;
      tables[table].set(id, { _id: id, ...row });
      return id;
    },
    query(table: TableName) {
      return {
        withIndex: (_indexName, callback) => {
          const condition = callback({
            eq: (field, value) => ({ field, value }),
          });
          const matched = rows(table).filter((row) => row[condition.field] === condition.value);
          return {
            async first() {
              return matched[0] ?? null;
            },
            async collect() {
              return matched;
            },
          };
        },
        async collect() {
          return rows(table);
        },
      };
    },
  };
}

function createPaymentCtx(initialRequest: Record<string, any>, roles: string[] = ["BUH Payment"]) {
  const db = createFakeDb(initialRequest, {
    email: "finance@agima.ru",
    fullName: "Finance User",
    active: true,
    roles,
  });
  const scheduled: Array<{ delay: number; args: any }> = [];

  return {
    ctx: {
      auth: {
        async getUserIdentity() {
          return {
            subject: `${USER_ID}|session_1`,
            email: "finance@agima.ru",
            name: "Finance User",
          };
        },
      },
      db,
      scheduler: {
        async runAfter(delay: number, _functionRef: unknown, args: any) {
          scheduled.push({ delay, args });
        },
      },
    },
    db,
    scheduled,
  };
}

function createFotCtx(initialRequest: Record<string, any>) {
  const db = createFakeDb(initialRequest, {
    email: "inside@agima.ru",
    fullName: "Inside Finance User",
    active: true,
    roles: ["BUH Inside"],
  });

  return {
    ctx: {
      auth: {
        async getUserIdentity() {
          return {
            subject: `${USER_ID}|session_1`,
            email: "inside@agima.ru",
            name: "Inside Finance User",
          };
        },
      },
      db,
      scheduler: {
        async runAfter() {},
      },
    },
    db,
  };
}

function createAdminCtx(requests: Array<Record<string, any>>) {
  const db = createFakeDb(requests[0] ?? {}, {
    email: "admin@agima.ru",
    fullName: "Admin User",
    active: true,
    roles: ["ADMIN"],
  });
  db.tables.requests.clear();
  requests.forEach((request, index) => {
    const id = request._id ?? `request_${index + 1}`;
    db.tables.requests.set(id, { _id: id, ...request });
  });

  return {
    ctx: {
      auth: {
        async getUserIdentity() {
          return {
            subject: `${USER_ID}|session_1`,
            email: "admin@agima.ru",
            name: "Admin User",
          };
        },
      },
      db,
      scheduler: {
        async runAfter() {},
      },
    },
    db,
  };
}

function getRequest(db: FakeDb) {
  return db.tables.requests.get(REQUEST_ID);
}

async function runUpdatePaymentStatus(ctx: any, args: Record<string, any>) {
  return await (updatePaymentStatus as any)._handler(ctx, {
    id: REQUEST_ID,
    ...args,
  });
}

async function runApplyFinplanPaymentPreview(ctx: any, args: Record<string, any>) {
  return await (applyFinplanPaymentPreview as any)._handler(ctx, {
    id: REQUEST_ID,
    decision: "apply_matching",
    ...args,
  });
}

async function runUpdateSpecialistFot(ctx: any, args: Record<string, any>) {
  return await (updateSpecialistFot as any)._handler(ctx, {
    requestId: REQUEST_ID,
    ...args,
  });
}

async function runBackfillCompletedRequestClosures(ctx: any, args: Record<string, any>) {
  return await (adminBackfillCompletedRequestClosures as any)._handler(ctx, args);
}

async function runBackfillWelcomeBonusPaymentState(ctx: any, args: Record<string, any>) {
  return await (adminBackfillWelcomeBonusPaymentState as any)._handler(ctx, args);
}

async function runBackfillPaymentDeadlineReminders(ctx: any) {
  return await (adminBackfillPaymentDeadlineReminders as any)._handler(ctx, {});
}

async function runDailyPaymentDeadlineReminders(ctx: any) {
  return await (sendDailyPaymentDeadlineReminders as any)._handler(ctx, {});
}

describe("updatePaymentStatus workflow", () => {
  it("does not schedule stale before-payment or overdue reminders on the deadline day", async () => {
    const { ctx, scheduled } = createPaymentCtx(
      {
        createdBy: "author",
        createdByEmail: "author@agima.ru",
        category: "Закупка",
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
        status: "approved",
        amount: 50_000,
        amountWithVat: 61_000,
        vatRate: 22,
        currency: "RUB",
        paymentDeadline: new Date("2030-05-20T00:00:00.000Z").getTime(),
        isCanceled: false,
        createdAt: new Date("2030-05-20T12:00:00.000Z").getTime(),
        updatedAt: new Date("2030-05-20T12:00:00.000Z").getTime(),
      },
      ["ADMIN"],
    );
    const originalNow = Date.now;
    Date.now = () => new Date("2030-05-20T12:00:00.000Z").getTime();
    try {
      await runBackfillPaymentDeadlineReminders(ctx);
    } finally {
      Date.now = originalNow;
    }

    expect(scheduled.map((item) => item.args.reminderKind)).toEqual([]);
  });

  it("schedules payment deadline reminders only for the daily run date", async () => {
    const { ctx, scheduled } = createPaymentCtx(
      {
        createdBy: "author",
        createdByEmail: "author@agima.ru",
        category: "Закупка",
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
        status: "approved",
        amount: 50_000,
        amountWithVat: 61_000,
        vatRate: 22,
        currency: "RUB",
        paymentDeadline: new Date("2030-05-20T00:00:00.000Z").getTime(),
        isCanceled: false,
        createdAt: new Date("2030-05-19T05:00:00.000Z").getTime(),
        updatedAt: new Date("2030-05-19T05:00:00.000Z").getTime(),
      },
      ["ADMIN"],
    );
    const originalNow = Date.now;
    Date.now = () => new Date("2030-05-19T05:00:00.000Z").getTime();
    try {
      await runDailyPaymentDeadlineReminders(ctx);
    } finally {
      Date.now = originalNow;
    }

    expect(scheduled.map((item) => item.args)).toEqual([
      {
        requestId: REQUEST_ID,
        paymentDeadline: new Date("2030-05-20T00:00:00.000Z").getTime(),
        reminderKind: "before",
        dateKey: "2030-05-19",
      },
    ]);
  });

  it("schedules overdue payment reminders from the daily run after the deadline day", async () => {
    const { ctx, scheduled } = createPaymentCtx(
      {
        createdBy: "author",
        createdByEmail: "author@agima.ru",
        category: "Закупка",
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
        status: "approved",
        amount: 50_000,
        amountWithVat: 61_000,
        vatRate: 22,
        currency: "RUB",
        paymentDeadline: new Date("2030-05-20T00:00:00.000Z").getTime(),
        isCanceled: false,
        createdAt: new Date("2030-05-21T05:00:00.000Z").getTime(),
        updatedAt: new Date("2030-05-21T05:00:00.000Z").getTime(),
      },
      ["ADMIN"],
    );
    const originalNow = Date.now;
    Date.now = () => new Date("2030-05-21T05:00:00.000Z").getTime();
    try {
      await runDailyPaymentDeadlineReminders(ctx);
    } finally {
      Date.now = originalNow;
    }

    expect(scheduled.map((item) => item.args)).toEqual([
      {
        requestId: REQUEST_ID,
        paymentDeadline: new Date("2030-05-20T00:00:00.000Z").getTime(),
        reminderKind: "overdue",
        dateKey: "2030-05-21",
      },
    ]);
  });

  it("allows BUH Transit to plan payments", async () => {
    const { db, ctx } = createPaymentCtx(
      {
        createdBy: "author",
        createdByEmail: "author@agima.ru",
        category: "Транзит",
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
        status: "approved",
        amount: 50_000,
        amountWithVat: 61_000,
        vatRate: 22,
        currency: "RUB",
        paymentDeadline: new Date("2030-05-20").getTime(),
        isCanceled: false,
        createdAt: new Date("2030-04-01").getTime(),
        updatedAt: new Date("2030-04-01").getTime(),
      },
      ["BUH Transit"],
    );

    await runUpdatePaymentStatus(ctx, {
      status: "payment_planned",
      paymentPlannedAt: new Date("2030-05-10").getTime(),
    });

    expect(getRequest(db)?.status).toBe("payment_planned");
    expect(getRequest(db)?.paymentPlannedByEmail).toBe("finance@agima.ru");
  });

  it("moves approved request through payment planning, partial payment, and final payment", async () => {
    const { ctx, db, scheduled } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "approved",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      neededBy: new Date("2030-05-15").getTime(),
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, { status: "awaiting_payment" });
    expect(getRequest(db)?.status).toBe("awaiting_payment");
    expect(getRequest(db)?.awaitingPaymentByEmail).toBe("finance@agima.ru");

    await runUpdatePaymentStatus(ctx, {
      status: "payment_planned",
      paymentPlannedAt: new Date("2030-05-10").getTime(),
    });
    expect(getRequest(db)?.status).toBe("payment_planned");
    expect(getRequest(db)?.plannedPaymentAmount).toBe(100_000);
    expect(getRequest(db)?.paymentResidualAmount).toBe(100_000);

    await runUpdatePaymentStatus(ctx, {
      status: "partially_paid",
      actualPaidAmount: 40_000,
      actualPaidAt: new Date("2030-05-10").getTime(),
    });
    expect(getRequest(db)?.status).toBe("partially_paid");
    expect(getRequest(db)?.actualPaidAmount).toBe(40_000);
    expect(getRequest(db)?.paymentResidualAmount).toBe(60_000);
    expect(getRequest(db)?.paymentSplits).toHaveLength(1);

    await runUpdatePaymentStatus(ctx, {
      status: "paid",
      actualPaidAt: new Date("2030-05-12").getTime(),
    });
    expect(getRequest(db)?.status).toBe("closed");
    expect(getRequest(db)?.previousClosedStatus).toBe("paid");
    expect(getRequest(db)?.actualPaidAmount).toBe(100_000);
    expect(getRequest(db)?.paymentResidualAmount).toBeUndefined();
    expect(getRequest(db)?.paidByEmail).toBe("finance@agima.ru");
    expect(scheduled.length).toBeGreaterThan(0);
  });

  it("keeps a fully paid request open while FOT is pending", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "approved",
      amount: 100_000,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      specialists: [
        { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: false },
        { id: "contractor-1", sourceType: "contractor", directCost: 90_000 },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, {
      status: "paid",
      actualPaidAt: new Date("2030-05-12").getTime(),
    });

    expect(getRequest(db)?.status).toBe("paid");
    expect(getRequest(db)?.previousClosedStatus).toBeUndefined();
  });

  it("auto-closes when payment completes after FOT is already recorded", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "approved",
      amount: 100_000,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      specialists: [
        { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: true },
        { id: "contractor-1", sourceType: "contractor", directCost: 90_000 },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, {
      status: "paid",
      actualPaidAt: new Date("2030-05-12").getTime(),
    });

    expect(getRequest(db)?.status).toBe("closed");
    expect(getRequest(db)?.previousClosedStatus).toBe("paid");
  });

  it("auto-closes when FOT is recorded after full payment", async () => {
    const { ctx, db } = createFotCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "paid",
      amount: 100_000,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      paidAt: new Date("2030-05-12").getTime(),
      paidByEmail: "finance@agima.ru",
      specialists: [
        { id: "internal-1", name: "Штатник", sourceType: "internal", directCost: 10_000, fotRecorded: false },
        { id: "contractor-1", name: "Подрядчик", sourceType: "contractor", directCost: 90_000 },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdateSpecialistFot(ctx, {
      specialistId: "internal-1",
      fotRecorded: true,
      fotMonth: "2030-05",
    });

    expect(getRequest(db)?.status).toBe("closed");
    expect(getRequest(db)?.previousClosedStatus).toBe("paid");
  });

  it("auto-closes when FOT is recorded and no contractor payment is needed", async () => {
    const { ctx, db } = createFotCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "approved",
      amount: 100_000,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      specialists: [
        { id: "internal-1", name: "Штатник", sourceType: "internal", directCost: 100_000, fotRecorded: false },
        { id: "contractor-1", name: "Подрядчик без оплаты", sourceType: "contractor" },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdateSpecialistFot(ctx, {
      specialistId: "internal-1",
      fotRecorded: true,
      fotMonth: "2030-05",
    });

    expect(getRequest(db)?.status).toBe("closed");
    expect(getRequest(db)?.previousClosedStatus).toBe("approved");
  });

  it("backfills old fully completed requests without closing pending FOT requests", async () => {
    const { ctx, db } = createAdminCtx([
      {
        _id: "ready",
        requestCode: "READY",
        status: "paid",
        isCanceled: false,
        category: "Закупка",
        paidAt: new Date("2030-05-12").getTime(),
      },
      {
        _id: "approved_ready",
        requestCode: "APPROVED_READY",
        status: "approved",
        isCanceled: false,
        category: "Конкурсное задание",
        specialists: [
          { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: true },
          { id: "contractor-1", sourceType: "contractor" },
        ],
      },
      {
        _id: "welcome_ready",
        requestCode: "WELCOME_READY",
        status: "approved",
        isCanceled: false,
        category: "Welcome-бонус",
      },
      {
        _id: "pending_fot",
        requestCode: "FOT",
        status: "paid",
        isCanceled: false,
        category: "Конкурсное задание",
        paidAt: new Date("2030-05-12").getTime(),
        specialists: [
          { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: false },
        ],
      },
      {
        _id: "already_closed",
        requestCode: "CLOSED",
        status: "closed",
        isCanceled: false,
      },
    ]);

    await expect(
      runBackfillCompletedRequestClosures(ctx, { dryRun: true }),
    ).resolves.toMatchObject({
      dryRun: true,
      candidates: 3,
      closed: 0,
      requestCodes: ["APPROVED_READY", "WELCOME_READY", "READY"],
    });
    expect(db.tables.requests.get("ready")?.status).toBe("paid");
    expect(db.tables.requests.get("approved_ready")?.status).toBe("approved");
    expect(db.tables.requests.get("welcome_ready")?.status).toBe("approved");

    await expect(
      runBackfillCompletedRequestClosures(ctx, { dryRun: false }),
    ).resolves.toMatchObject({
      dryRun: false,
      candidates: 3,
      closed: 3,
      requestCodes: ["APPROVED_READY", "WELCOME_READY", "READY"],
    });
    expect(db.tables.requests.get("ready")?.status).toBe("closed");
    expect(db.tables.requests.get("ready")?.previousClosedStatus).toBe("paid");
    expect(db.tables.requests.get("approved_ready")?.status).toBe("closed");
    expect(db.tables.requests.get("approved_ready")?.previousClosedStatus).toBe("approved");
    expect(db.tables.requests.get("welcome_ready")?.status).toBe("closed");
    expect(db.tables.requests.get("welcome_ready")?.previousClosedStatus).toBe("approved");
    expect(db.tables.requests.get("pending_fot")?.status).toBe("paid");
    expect(db.tables.requests.get("already_closed")?.status).toBe("closed");
  });

  it("rejects payment actions for Welcome bonus requests", async () => {
    const { ctx } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Welcome-бонус",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "approved",
      amount: 20_000,
      amountWithVat: 24_400,
      vatRate: 22,
      currency: "RUB",
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await expect(
      runUpdatePaymentStatus(ctx, {
        status: "payment_planned",
        paymentPlannedAt: new Date("2030-05-10").getTime(),
      }),
    ).rejects.toThrow("Welcome-бонус не передается в оплату");
  });

  it("cleans old Welcome bonus payment state", async () => {
    const { ctx, db } = createAdminCtx([
      {
        _id: "welcome_planned",
        requestCode: "WB",
        category: "Welcome-бонус",
        status: "payment_planned",
        isCanceled: false,
        amount: 20_000,
        plannedPaymentAmount: 5_000,
        plannedPaymentAmountWithVat: 6_100,
        paymentResidualAmount: 20_000,
        paymentPlannedAt: new Date("2030-05-10").getTime(),
        paymentPlannedByEmail: "finance@agima.ru",
        actualPaidAmount: 1_000,
      },
      {
        _id: "purchase_planned",
        requestCode: "BUY",
        category: "Закупка",
        status: "payment_planned",
        isCanceled: false,
        plannedPaymentAmount: 5_000,
      },
    ]);

    await expect(
      runBackfillWelcomeBonusPaymentState(ctx, { dryRun: true }),
    ).resolves.toMatchObject({
      dryRun: true,
      candidates: 1,
      cleaned: 0,
      requestCodes: ["WB"],
    });
    expect(db.tables.requests.get("welcome_planned")?.status).toBe("payment_planned");

    await expect(
      runBackfillWelcomeBonusPaymentState(ctx, { dryRun: false }),
    ).resolves.toMatchObject({
      dryRun: false,
      candidates: 1,
      cleaned: 1,
      requestCodes: ["WB"],
    });
    expect(db.tables.requests.get("welcome_planned")?.status).toBe("approved");
    expect(db.tables.requests.get("welcome_planned")?.plannedPaymentAmount).toBeUndefined();
    expect(db.tables.requests.get("welcome_planned")?.paymentPlannedAt).toBeUndefined();
    expect(db.tables.requests.get("purchase_planned")?.status).toBe("payment_planned");
  });

  it("uses the tag submitted with a payment action before quota validation", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      status: "approved",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      paymentDeadline: new Date("2030-05-20").getTime(),
      neededBy: new Date("2030-05-15").getTime(),
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, {
      status: "payment_planned",
      paymentPlannedAt: new Date("2030-05-10").getTime(),
      plannedPaymentAmount: 40_000,
      planningMode: "partial",
      cfdTag: "Офис",
    });

    expect(getRequest(db)?.status).toBe("payment_planned");
    expect(getRequest(db)?.cfdTag).toBe("Офис");
    expect(getRequest(db)?.plannedPaymentAmount).toBe(40_000);
  });

  it("does not allow request authors without finance roles to apply Finplan preview", async () => {
    const { ctx } = createPaymentCtx(
      {
        createdBy: USER_ID,
        createdByEmail: "finance@agima.ru",
        category: "Закупка",
        fundingSource: "Квоты AGIMA",
        cfdTag: "Офис",
        status: "approved",
        amount: 100_000,
        amountWithVat: 122_000,
        vatRate: 22,
        currency: "RUB",
        isCanceled: false,
        createdAt: new Date("2030-04-01").getTime(),
        updatedAt: new Date("2030-04-01").getTime(),
      },
      [],
    );

    await expect(
      runApplyFinplanPaymentPreview(ctx, {
        rows: [
          {
            id: "100",
            costSumNet: 100_000,
            paymentState: "planned",
            warnings: [],
          },
        ],
      }),
    ).rejects.toThrow("Применить данные Финплана может админ или BUH-роль");
  });

  it.each(["BUH Inside", "BUH Outsource"])(
    "allows %s to apply Finplan preview",
    async (role) => {
      const { ctx, db } = createPaymentCtx(
        {
          createdBy: "author",
          createdByEmail: "author@agima.ru",
          category: "Закупка",
          fundingSource: "Квоты AGIMA",
          cfdTag: "Офис",
          status: "approved",
          amount: 100_000,
          amountWithVat: 122_000,
          vatRate: 22,
          currency: "RUB",
          isCanceled: false,
          createdAt: new Date("2030-04-01").getTime(),
          updatedAt: new Date("2030-04-01").getTime(),
        },
        [role],
      );

      await runApplyFinplanPaymentPreview(ctx, {
        rows: [
          {
            id: "100",
            costSumNet: 100_000,
            costSum: 122_000,
            effectivePaymentDate: "10.05.2030",
            paymentState: "planned",
            warnings: [],
          },
        ],
      });

      expect(getRequest(db)).toMatchObject({
        status: "payment_planned",
        finplanEntered: true,
        finplanEntryIds: ["100"],
      });
    },
  );

  it("saves an empty Finplan preview as awaiting payment and clears the Finplan mark for open requests", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: "author",
      createdByEmail: "author@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "paid",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      isCanceled: false,
      finplanEntered: true,
      finplanEntryIds: ["manual-1", "checked-1"],
      finplanVerifiedCostIds: ["checked-1"],
      paymentSplits: [{ splitNumber: 1, amountWithoutVat: 100_000, paidAt: new Date("2030-05-10").getTime() }],
      actualPaidAmount: 100_000,
      paidAt: new Date("2030-05-10").getTime(),
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await expect(runApplyFinplanPaymentPreview(ctx, { rows: [] })).resolves.toEqual({
      status: "awaiting_payment",
    });

    expect(getRequest(db)).toMatchObject({
      status: "awaiting_payment",
      finplanEntered: false,
      finplanEntryIds: ["manual-1"],
    });
    expect(getRequest(db)?.finplanVerifiedCostIds).toBeUndefined();
    expect(getRequest(db)?.paymentSplits).toBeUndefined();
    expect(getRequest(db)?.actualPaidAmount).toBeUndefined();
  });

  it("clears the Finplan mark when an empty Finplan preview is saved for a closed request", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: "author",
      createdByEmail: "author@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "closed",
      previousClosedStatus: "paid",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      isCanceled: false,
      finplanEntered: true,
      finplanEntryIds: ["manual-1", "checked-1"],
      finplanVerifiedCostIds: ["checked-1"],
      paymentSplits: [{ splitNumber: 1, amountWithoutVat: 100_000, paidAt: new Date("2030-05-10").getTime() }],
      actualPaidAmount: 100_000,
      paidAt: new Date("2030-05-10").getTime(),
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runApplyFinplanPaymentPreview(ctx, { rows: [] });

    expect(getRequest(db)).toMatchObject({
      status: "awaiting_payment",
      finplanEntered: false,
      finplanEntryIds: ["manual-1"],
      finplanAutoSyncClosedEnabled: true,
    });
  });

  it("applies positive Finplan rows even when another matched row has no amount", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: "author",
      createdByEmail: "author@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "approved",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runApplyFinplanPaymentPreview(ctx, {
      rows: [
        {
          id: "positive",
          costSumNet: 40_000,
          costSum: 48_800,
          effectivePaymentDate: "10.05.2030",
          paymentState: "planned",
          warnings: [],
        },
        {
          id: "missing",
          effectivePaymentDate: "15.05.2030",
          paymentState: "needs_planning",
          warnings: ["В строке нет суммы без НДС: затраты требуют планирования"],
        },
      ],
    });

    expect(getRequest(db)).toMatchObject({
      status: "payment_planned",
      finplanEntered: true,
      finplanEntryIds: ["positive", "missing"],
      finplanVerifiedCostIds: ["positive", "missing"],
      plannedPaymentAmount: 40_000,
      paymentResidualAmount: 100_000,
    });
  });

  it("does not apply negative Finplan rows to Aurum payments or verified IDs", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: "author",
      createdByEmail: "author@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "approved",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runApplyFinplanPaymentPreview(ctx, {
      rows: [
        {
          id: "negative",
          costSumNet: -1000,
          costSum: -1220,
          effectivePaymentDate: "10.05.2030",
          paymentState: "planned",
          warnings: ["В строке отрицательная сумма без НДС: строка не будет обновлять Aurum"],
        },
      ],
    });

    expect(getRequest(db)).toMatchObject({
      status: "awaiting_payment",
      finplanEntered: false,
    });
    expect(getRequest(db)?.finplanEntryIds).toBeUndefined();
    expect(getRequest(db)?.finplanVerifiedCostIds).toBeUndefined();
    expect(getRequest(db)?.plannedPaymentAmount).toBeUndefined();
  });

  it("rejects payment actions for canceled requests", async () => {
    const { ctx } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "approved",
      amount: 100_000,
      amountWithVat: 122_000,
      vatRate: 22,
      currency: "RUB",
      isCanceled: true,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await expect(
      runUpdatePaymentStatus(ctx, { status: "awaiting_payment" }),
    ).rejects.toThrow("Сначала возобновите заявку");
  });

  it("requires currency rate for foreign currency payment planning", async () => {
    const { ctx } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Закупка",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Офис",
      status: "awaiting_payment",
      amount: 1_000,
      amountWithVat: 1_220,
      vatRate: 22,
      currency: "USD",
      paymentDeadline: new Date("2030-05-20").getTime(),
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await expect(
      runUpdatePaymentStatus(ctx, {
        status: "payment_planned",
        paymentPlannedAt: new Date("2030-05-10").getTime(),
      }),
    ).rejects.toThrow("Для валютной заявки укажите курс валюты");
  });

  it("does not close a request while internal specialist FOT is pending", async () => {
    const { ctx } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "paid",
      amount: 100_000,
      currency: "RUB",
      specialists: [
        { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: false },
        { id: "contractor-1", sourceType: "contractor", directCost: 90_000 },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await expect(
      runUpdatePaymentStatus(ctx, { status: "closed" }),
    ).rejects.toThrow("Сначала отметьте вынос ФОТ");
  });

  it("allows an internal-only request to close after FOT is recorded", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "approved",
      amount: 10_000,
      currency: "RUB",
      specialists: [
        { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: true },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, { status: "closed" });
    expect(getRequest(db)?.status).toBe("closed");
  });

  it("allows a request with only zero-amount contractor payment to close after FOT is recorded", async () => {
    const { ctx, db } = createPaymentCtx({
      createdBy: USER_ID,
      createdByEmail: "finance@agima.ru",
      category: "Конкурсное задание",
      fundingSource: "Квоты AGIMA",
      cfdTag: "Тендер",
      status: "approved",
      amount: 10_000,
      currency: "RUB",
      specialists: [
        { id: "internal-1", sourceType: "internal", directCost: 10_000, fotRecorded: true },
        { id: "contractor-1", sourceType: "contractor", fotRecorded: true },
      ],
      isCanceled: false,
      createdAt: new Date("2030-04-01").getTime(),
      updatedAt: new Date("2030-04-01").getTime(),
    });

    await runUpdatePaymentStatus(ctx, { status: "closed" });
    expect(getRequest(db)?.status).toBe("closed");
  });
});
