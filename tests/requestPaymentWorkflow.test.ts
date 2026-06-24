import { describe, expect, it } from "vitest";
import { updatePaymentStatus } from "../convex/requests";

type TableName = "requests" | "roles" | "requestTimelineEvents";

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

function getRequest(db: FakeDb) {
  return db.tables.requests.get(REQUEST_ID);
}

async function runUpdatePaymentStatus(ctx: any, args: Record<string, any>) {
  return await (updatePaymentStatus as any)._handler(ctx, {
    id: REQUEST_ID,
    ...args,
  });
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
    expect(getRequest(db)?.status).toBe("paid");
    expect(getRequest(db)?.actualPaidAmount).toBe(100_000);
    expect(getRequest(db)?.paymentResidualAmount).toBeUndefined();
    expect(getRequest(db)?.paidByEmail).toBe("finance@agima.ru");
    expect(scheduled.length).toBeGreaterThan(0);
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
