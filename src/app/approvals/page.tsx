"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import RequestMetaSummary from "@/components/request-meta-summary";
import { getBuhPaymentStatusSummary, getUnallocatedPaymentAmounts } from "@/lib/requestStatus";
import { formatAmountPair } from "@/lib/vat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverHint } from "@/components/ui/hover-hint";
import { api } from "@/lib/convex";
import { normalizeRequestCategory } from "@/lib/requestRules";

function getRequestDisplayTitle(request: {
  title?: string;
  clientName: string;
  category: string;
}) {
  return request.title?.trim() || `${request.clientName} :: ${normalizeRequestCategory(request.category)}`;
}

export default function ApprovalsPage() {
  const items = useQuery(api.approvals.listPendingForMe);
  const myRoles = useQuery(api.roles.myRoles);
  const [taskTypeFilter, setTaskTypeFilter] = useState<"all" | "approval" | "payment">("all");
  const [buhQuickFilter, setBuhQuickFilter] = useState<"all" | "today" | "overdue">("all");
  const todayStart = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value.getTime();
  }, []);
  const tomorrowStart = useMemo(() => {
    const value = new Date(todayStart);
    value.setDate(value.getDate() + 1);
    return value.getTime();
  }, [todayStart]);
  const visibleItems = useMemo(() => {
    if (!items?.length) {
      return items ?? [];
    }
    const isFinanceRole = myRoles?.some((role) => ["BUH", "CFD"].includes(role));
    let filtered = items;
    if (taskTypeFilter !== "all") {
      filtered = filtered.filter(({ kind }) =>
        taskTypeFilter === "payment" ? kind === "payment" : kind !== "payment",
      );
    }
    if (!isFinanceRole || buhQuickFilter === "all") {
      return filtered;
    }
    return filtered.filter(({ kind, request }) => {
      if (kind !== "payment" || !request.neededBy) {
        return taskTypeFilter === "approval";
      }
      if (buhQuickFilter === "today") {
        return request.neededBy >= todayStart && request.neededBy < tomorrowStart;
      }
      return request.neededBy < todayStart;
    });
  }, [buhQuickFilter, items, myRoles, taskTypeFilter, todayStart, tomorrowStart]);
  const isFinanceRole = myRoles?.some((role) => ["BUH", "CFD"].includes(role));

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Заявки на согласование" />

          <Card className="border-amber-500 ring-1 ring-amber-400/70 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(255,255,255,0.985)_55%,rgba(250,250,249,0.95)_100%)] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <CardHeader>
              <CardTitle>Требуют вашего действия</CardTitle>
              <CardDescription className="text-zinc-500">
                {isFinanceRole
                  ? "Согласования и заявки, ожидающие оплаты."
                  : myRoles?.includes("HOD")
                    ? "Заявки, где нужно провалидировать часы и прямые затраты по вашим цехам."
                    : "Список заявок, где вы указаны как согласующий."}
              </CardDescription>
              <div className="flex flex-wrap gap-2">
                {(myRoles?.some((role) => ["NBD", "AI-BOSS", "COO", "CFD", "HOD", "ADMIN", "BUH"].includes(role))) ? (
                  <>
                    <Button
                      type="button"
                      variant={taskTypeFilter === "all" ? "default" : "outline"}
                      onClick={() => setTaskTypeFilter("all")}
                    >
                      Все действия
                    </Button>
                    <Button
                      type="button"
                      variant={taskTypeFilter === "approval" ? "default" : "outline"}
                      onClick={() => setTaskTypeFilter("approval")}
                    >
                      Нужно согласовать
                    </Button>
                    {isFinanceRole ? (
                      <Button
                        type="button"
                        variant={taskTypeFilter === "payment" ? "default" : "outline"}
                        onClick={() => setTaskTypeFilter("payment")}
                      >
                        Нужна оплата
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {isFinanceRole ? (
                  <>
                  <Button
                    type="button"
                    variant={buhQuickFilter === "all" ? "default" : "outline"}
                    onClick={() => setBuhQuickFilter("all")}
                  >
                    Все даты
                  </Button>
                  <Button
                    type="button"
                    variant={buhQuickFilter === "today" ? "default" : "outline"}
                    onClick={() => setBuhQuickFilter("today")}
                  >
                    Сегодня
                  </Button>
                  <Button
                    type="button"
                    variant={buhQuickFilter === "overdue" ? "default" : "outline"}
                    onClick={() => setBuhQuickFilter("overdue")}
                  >
                    Просрочено
                  </Button>
                  </>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {visibleItems.length ? (
                  visibleItems.map(({ request, kind }) => (
                    (() => {
                      const buhStatusSummary =
                        kind === "payment" ? getBuhPaymentStatusSummary(request) : null;
                      const unallocatedPaymentAmounts =
                        kind === "payment" ? getUnallocatedPaymentAmounts(request) : null;

                      return (
                        <Link
                      key={request._id}
                      href={`/requests/${request._id}`}
                      className="grid min-h-[126px] gap-3 rounded-lg border border-zinc-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.985)_0%,rgba(252,252,251,0.96)_100%)] px-4 py-3 text-sm transition-all hover:border-amber-200 hover:bg-[linear-gradient(135deg,rgba(252,249,244,0.96)_0%,rgba(249,246,241,0.94)_100%)] hover:shadow-[0_10px_30px_rgba(63,63,70,0.08)] md:grid-cols-[minmax(0,1fr)_auto_auto]"
                        >
                      <div className="space-y-2">
                        <div>
                          <div className="font-medium">
                            {getRequestDisplayTitle(request)}
                          </div>
                          <RequestMetaSummary
                            requestCode={request.requestCode}
                            clientName={request.clientName}
                            category={request.category}
                            amount={request.amount}
                            amountWithVat={request.amountWithVat}
                            currency={request.currency}
                            vatRate={request.vatRate}
                            className="text-sm"
                          />
                          {request.createdByName ? (
                            <div className="text-sm text-muted-foreground">{request.createdByName}</div>
                          ) : null}
                          <div className="text-sm text-muted-foreground">
                            <HoverHint
                              label={
                                kind === "payment"
                                  ? "Дата последнего изменения заявки"
                                  : "Дата создания заявки"
                              }
                            >
                              <span>
                                {kind === "payment" ? "Изменено" : "Создано"}:{" "}
                                {new Date(
                                  kind === "payment" ? request.updatedAt : request.createdAt,
                                ).toLocaleDateString("ru-RU")}
                              </span>
                            </HoverHint>
                          </div>
                          {kind === "payment" ? (
                            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                              <div>
                                <HoverHint label="Дата, к которой заявку нужно оплатить">
                                  <span>
                                    Дедлайн оплаты:{" "}
                                    {request.neededBy
                                      ? new Date(request.neededBy).toLocaleDateString("ru-RU")
                                      : "не указан"}
                                  </span>
                                </HoverHint>
                              </div>
                              <div>
                                <HoverHint label="Дата, которую указал BUH для оплаты">
                                  <span>
                                    Когда оплатим:{" "}
                                    {request.paymentPlannedAt
                                      ? new Date(request.paymentPlannedAt).toLocaleDateString("ru-RU")
                                      : "не запланировано"}
                                  </span>
                                </HoverHint>
                              </div>
                              {request.paymentResidualAmount !== undefined ? (
                                <div>
                                  Остаток:{" "}
                                  {formatAmountPair({
                                    amountWithoutVat: request.paymentResidualAmount,
                                    currency: request.currency,
                                    vatRate: request.vatRate,
                                  })}
                                </div>
                              ) : null}
                              {buhStatusSummary?.label === "Есть нераспределенный платеж" &&
                              unallocatedPaymentAmounts ? (
                                <div>
                                  Нераспределено:{" "}
                                  {formatAmountPair({
                                    amountWithoutVat: unallocatedPaymentAmounts.amountWithoutVat,
                                    amountWithVat: unallocatedPaymentAmounts.amountWithVat,
                                    currency: request.currency,
                                    vatRate: request.vatRate,
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : kind === "hod" ? (
                            <div className="mt-2 text-sm text-muted-foreground">
                              Провалидируйте часы и прямые затраты по специалистам вашего цеха.
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right font-medium">
                        <HoverHint label="Сумма заявки">
                          <span>
                            {formatAmountPair({
                              amountWithoutVat: request.amount,
                              amountWithVat: request.amountWithVat,
                              currency: request.currency,
                              vatRate: request.vatRate,
                            })}
                          </span>
                        </HoverHint>
                      </div>
                      <span
                        className={`h-fit rounded-full border px-3 py-1 text-xs font-medium ${
                          kind === "payment"
                            ? buhStatusSummary?.className
                            : kind === "hod"
                              ? "border-violet-200 bg-violet-50 text-violet-700"
                            : "border-amber-200 bg-amber-100 text-amber-800"
                        }`}
                      >
                        {kind === "payment"
                          ? buhStatusSummary?.label
                          : kind === "hod"
                            ? "Провалидируйте затраты"
                            : "Ждет вашего решения"}
                      </span>
                        </Link>
                      );
                    })()
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Пока нет заявок на согласование.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
