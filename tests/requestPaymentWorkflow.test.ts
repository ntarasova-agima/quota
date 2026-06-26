import { describe, expect, it } from "vitest";
import {
  adminBackfillCompletedRequestClosures,
  adminBackfillWelcomeBonusPaymentState,
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

function createPaymentCtx(initialRequest: Record<string, any>) {
  const db = createFakeDb(initialRequest, {
    email: "finance@agima.ru",
    fullName: "Finance User",
    active: true,
    roles: ["BUH Payment"],
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

describe("updatePaymentStatus workflow", () => {
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

  it("backfills old fully completed paid requests without closing pending FOT requests", async () => {
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
      candidates: 1,
      closed: 0,
      requestCodes: ["READY"],
    });
    expect(db.tables.requests.get("ready")?.status).toBe("paid");

    await expect(
      runBackfillCompletedRequestClosures(ctx, { dryRun: false }),
    ).resolves.toMatchObject({
      dryRun: false,
      candidates: 1,
      closed: 1,
      requestCodes: ["READY"],
    });
    expect(db.tables.requests.get("ready")?.status).toBe("closed");
    expect(db.tables.requests.get("ready")?.previousClosedStatus).toBe("paid");
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
});
