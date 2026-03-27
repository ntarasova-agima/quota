"use client";

import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverHint } from "@/components/ui/hover-hint";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/convex";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import RequestMetaSummary from "@/components/request-meta-summary";
import { getRequestStatusSummary } from "@/lib/requestStatus";
import { EXPENSE_CATEGORIES, FUNDING_SOURCES } from "@/lib/constants";

function getRequestDisplayTitle(request: {
  title?: string;
  clientName: string;
  category: string;
}) {
  return request.title?.trim() || `${request.clientName} :: ${request.category}`;
}

function getPendingStatusPresentation(isActionableForViewer: boolean) {
  return isActionableForViewer
    ? {
        label: "Ожидает согласования",
        className: "border-amber-200 bg-amber-100 text-amber-800",
      }
    : {
        label: "Ожидает согласования",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
}

const statusOptions = [
  { value: "all", label: "Все" },
  { value: "draft", label: "Черновик" },
  { value: "hod_pending", label: "Ждет валидации цеха" },
  { value: "pending", label: "Ожидает согласования" },
  { value: "approved", label: "Согласовано" },
  { value: "rejected", label: "Отклонено" },
  { value: "awaiting_payment", label: "Требуется оплата" },
  { value: "payment_planned", label: "Запланирована оплата" },
  { value: "partially_paid", label: "Частично оплачено" },
  { value: "paid", label: "Оплачено" },
  { value: "closed", label: "Заявка закрыта" },
];

function toStartOfDay(value: string) {
  if (!value) {
    return undefined;
  }
  return new Date(`${value}T00:00:00`).getTime();
}

function toEndOfDay(value: string) {
  if (!value) {
    return undefined;
  }
  return new Date(`${value}T23:59:59.999`).getTime();
}

export default function RequestsPage() {
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("all");
  const [myStatusFilter, setMyStatusFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fundingFilter, setFundingFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [myCategoryFilter, setMyCategoryFilter] = useState("all");
  const [myFundingFilter, setMyFundingFilter] = useState("all");
  const [myCreatedFrom, setMyCreatedFrom] = useState("");
  const [myCreatedTo, setMyCreatedTo] = useState("");
  const [mySort, setMySort] = useState("created_desc");
  const [allSort, setAllSort] = useState("created_desc");
  const [myRequestCodeQuery, setMyRequestCodeQuery] = useState("");
  const [allRequestCodeQuery, setAllRequestCodeQuery] = useState("");
  const [myPage, setMyPage] = useState(1);
  const [allPage, setAllPage] = useState(1);
  const [buhDefaultApplied, setBuhDefaultApplied] = useState(false);
  const [archiveSweepDone, setArchiveSweepDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingRequestId, setUpdatingRequestId] = useState<string | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const myRoles = useQuery(api.roles.myRoles, isAuthenticated ? {} : "skip");
  const isApprover = useMemo(
    () => myRoles?.some((role) => ["NBD", "COO", "CFD", "BUH", "HOD", "ADMIN"].includes(role)),
    [myRoles],
  );
  const isAdmin = useMemo(() => myRoles?.includes("ADMIN") ?? false, [myRoles]);
  const isTagViewer = useMemo(
    () => myRoles?.some((role) => ["CFD", "NBD", "COO", "BUH", "ADMIN"].includes(role)) ?? false,
    [myRoles],
  );
  const isBuh = useMemo(() => myRoles?.includes("BUH") ?? false, [myRoles]);
  const rawView = searchParams.get("view") ?? "my";
  const activeView = rawView === "all" && isApprover ? "all" : "my";
  const adContacts = useQuery(api.roles.listAdContacts, isAuthenticated && isApprover ? {} : "skip");
  const cfdTags = useQuery(api.cfdTags.list, isAuthenticated && isTagViewer ? {} : "skip");
  const updatePaymentStatus = useMutation(api.requests.updatePaymentStatus);
  const archiveOldRequests = useMutation(api.requests.archiveOldRequests);
  const myRequests = useQuery(
    api.requests.listMyRequests,
    isAuthenticated
        ? {
            status: myStatusFilter === "all" ? undefined : (myStatusFilter as any),
            category: myCategoryFilter === "all" ? undefined : myCategoryFilter,
            fundingSource: myFundingFilter === "all" ? undefined : myFundingFilter,
            createdFrom: toStartOfDay(myCreatedFrom),
            createdTo: toEndOfDay(myCreatedTo),
            requestCodeQuery: myRequestCodeQuery.trim() || undefined,
            sort: mySort,
            page: myPage,
            pageSize: 20,
          }
      : "skip",
  );
  const allRequests = useQuery(
    api.requests.listAllRequests,
    isAuthenticated && isApprover
      ? {
          status: statusFilter === "all" ? undefined : (statusFilter as any),
          createdByEmail: authorFilter === "all" ? undefined : authorFilter,
          cfdTag:
            tagFilter === "all"
              ? undefined
              : tagFilter === "without_tag"
                ? ""
                : tagFilter,
          category: categoryFilter === "all" ? undefined : categoryFilter,
          fundingSource: fundingFilter === "all" ? undefined : fundingFilter,
          createdFrom: toStartOfDay(createdFrom),
          createdTo: toEndOfDay(createdTo),
          requestCodeQuery: allRequestCodeQuery.trim() || undefined,
          sort: allSort,
          page: allPage,
          pageSize: 20,
        }
      : "skip",
  );

  useEffect(() => {
    if (isBuh && !buhDefaultApplied) {
      setStatusFilter("awaiting_payment");
      setBuhDefaultApplied(true);
    }
  }, [isBuh, buhDefaultApplied]);

  useEffect(() => {
    if (!isAuthenticated || archiveSweepDone) {
      return;
    }
    void archiveOldRequests({})
      .catch(() => undefined)
      .finally(() => setArchiveSweepDone(true));
  }, [archiveOldRequests, archiveSweepDone, isAuthenticated]);
  const myRequestItems = myRequests?.items ?? [];
  const allRequestItems = allRequests?.items ?? [];

  useEffect(() => {
    setMyPage(1);
  }, [myStatusFilter, myCategoryFilter, myFundingFilter, myCreatedFrom, myCreatedTo, mySort, myRequestCodeQuery]);

  useEffect(() => {
    setAllPage(1);
  }, [statusFilter, authorFilter, tagFilter, categoryFilter, fundingFilter, createdFrom, createdTo, allSort, allRequestCodeQuery]);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Заявки" showAdmin={isAdmin} showCreateRequest />

          {activeView === "my" && (
          <Card className="border-emerald-400 ring-1 ring-emerald-300/70 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(255,255,255,0.98)_55%,rgba(248,250,252,0.92)_100%)] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <CardHeader>
              <CardTitle>Мои заявки</CardTitle>
              <CardDescription>Заявки, которые вы создали.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex justify-end">
                <div className="flex flex-wrap justify-end gap-3">
                  <Select value={mySort} onValueChange={setMySort}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Сортировка" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created_desc">По дате создания: новые</SelectItem>
                      <SelectItem value="created_asc">По дате создания: старые</SelectItem>
                      <SelectItem value="updated_desc">По дате изменения: новые</SelectItem>
                      <SelectItem value="updated_asc">По дате изменения: старые</SelectItem>
                      <SelectItem value="deadline_asc">По дедлайну: ближе</SelectItem>
                      <SelectItem value="deadline_desc">По дедлайну: дальше</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-[200px]"
                    placeholder="Поиск по номеру"
                    value={myRequestCodeQuery}
                    onChange={(event) => setMyRequestCodeQuery(event.target.value)}
                  />
                  <Select value={myStatusFilter} onValueChange={setMyStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Статус" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={myCategoryFilter} onValueChange={setMyCategoryFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Категория" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все категории</SelectItem>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={myFundingFilter} onValueChange={setMyFundingFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Источник" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все источники</SelectItem>
                      {FUNDING_SOURCES.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="date"
                    className="w-[180px]"
                    value={myCreatedFrom}
                    onChange={(event) => setMyCreatedFrom(event.target.value)}
                  />
                  <Input
                    type="date"
                    className="w-[180px]"
                    value={myCreatedTo}
                    onChange={(event) => setMyCreatedTo(event.target.value)}
                  />
                </div>
              </div>
              {actionError ? (
                <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {actionError}
                </div>
              ) : null}
              <div className="space-y-3">
                {myRequestItems.length ? (
                  myRequestItems.map(({ request, approvals }) => {
                    const baseStatusSummary = getRequestStatusSummary(request, approvals);
                    const isActionableForViewer =
                      request.status === "pending" &&
                      approvals.some(
                        (approval) =>
                          approval.status === "pending" && (myRoles ?? []).includes(approval.role),
                      );
                    const statusSummary =
                      request.status === "pending"
                        ? getPendingStatusPresentation(isActionableForViewer)
                        : baseStatusSummary;
                    const canSendToPayment = request.status === "approved";
                    const canCloseFromList = ["approved", "paid"].includes(request.status);
                    const canReopenFromList = request.status === "closed";
                    return (
                      <div
                        key={request._id}
                        className="grid gap-3 rounded-lg border border-border px-4 py-3 text-sm transition-all hover:border-zinc-300 hover:bg-[linear-gradient(135deg,rgba(249,250,251,0.98)_0%,rgba(244,244,245,0.96)_100%)] hover:shadow-[0_10px_30px_rgba(63,63,70,0.08)] md:grid-cols-[minmax(0,1fr)_auto_auto]"
                      >
                        <div>
                          <Link href={`/requests/${request._id}`} className="block">
                            <div className="font-medium">
                              {getRequestDisplayTitle(request)}
                              {request.cfdTag ? (
                                <span className="ml-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                  {request.cfdTag}
                                </span>
                              ) : null}
                              {(request.attachmentCount ?? 0) > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                                  <Paperclip className="h-3 w-3" />
                                  {request.attachmentCount}
                                </span>
                              ) : null}
                              {request.archivedAt ? (
                                <span className="ml-2 rounded border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                                  Архив
                                </span>
                              ) : null}
                            </div>
                            <RequestMetaSummary
                              requestCode={request.requestCode}
                              clientName={request.clientName}
                              category={request.category}
                            />
                            <div className="text-muted-foreground">
                              <HoverHint label="Дата создания заявки">
                                <span>Создано: {new Date(request.createdAt).toLocaleDateString("ru-RU")}</span>
                              </HoverHint>{" "}
                              ·{" "}
                              <HoverHint label="Дата последнего изменения заявки">
                                <span>Изменено: {new Date(request.updatedAt).toLocaleDateString("ru-RU")}</span>
                              </HoverHint>
                            </div>
                          </Link>
                          {request.status === "awaiting_payment" && request.awaitingPaymentByEmail ? (
                            <div className="text-muted-foreground">
                              В оплату передал: {request.awaitingPaymentByName ? `${request.awaitingPaymentByName} · ` : ""}
                              {request.awaitingPaymentByEmail}
                            </div>
                          ) : null}
                          {(canSendToPayment || canCloseFromList || canReopenFromList) ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {canSendToPayment ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9"
                                  disabled={updatingRequestId === request._id}
                                  onClick={async () => {
                                    setActionError(null);
                                    setUpdatingRequestId(request._id);
                                    try {
                                      await updatePaymentStatus({
                                        id: request._id,
                                        status: "awaiting_payment",
                                      });
                                    } catch (err) {
                                      setActionError(
                                        err instanceof Error ? err.message : "Не удалось передать в оплату",
                                      );
                                    } finally {
                                      setUpdatingRequestId(null);
                                    }
                                  }}
                                >
                                  Передать в оплату
                                </Button>
                              ) : null}
                              {canCloseFromList ? (
                                <HoverHint
                                  label={
                                    request.status === "approved"
                                      ? "Если оплата по счету не требуется"
                                      : "Подтвердить, что заявка завершена"
                                  }
                                >
                                  <Button
                                    type="button"
                                    size="sm"
                                    className={
                                      request.status === "approved"
                                        ? "h-9 border-slate-300 bg-gradient-to-r from-slate-100 via-zinc-50 to-slate-100 text-slate-800 shadow-[0_0_10px_rgba(148,163,184,0.10)] hover:from-slate-200 hover:via-zinc-100 hover:to-slate-200"
                                        : "h-9 border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 text-amber-900 shadow-[0_0_10px_rgba(245,158,11,0.10)] hover:from-amber-200 hover:via-yellow-100 hover:to-amber-200"
                                    }
                                    disabled={updatingRequestId === request._id}
                                    onClick={async () => {
                                      setActionError(null);
                                      setUpdatingRequestId(request._id);
                                      try {
                                        await updatePaymentStatus({
                                          id: request._id,
                                          status: "closed",
                                        });
                                      } catch (err) {
                                        setActionError(
                                          err instanceof Error ? err.message : "Не удалось закрыть заявку",
                                        );
                                      } finally {
                                        setUpdatingRequestId(null);
                                      }
                                    }}
                                  >
                                    {request.status === "approved"
                                      ? "Принять без оплаты"
                                      : "Закрыть заявку"}
                                  </Button>
                                </HoverHint>
                              ) : null}
                              {canReopenFromList ? (
                                <HoverHint label="Вернуть заявку в предыдущий статус">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9"
                                    disabled={updatingRequestId === request._id}
                                    onClick={async () => {
                                      setActionError(null);
                                      setUpdatingRequestId(request._id);
                                      try {
                                        await updatePaymentStatus({
                                          id: request._id,
                                          status: "reopen" as any,
                                        });
                                      } catch (err) {
                                        setActionError(
                                          err instanceof Error ? err.message : "Не удалось открыть заявку заново",
                                        );
                                      } finally {
                                        setUpdatingRequestId(null);
                                      }
                                    }}
                                  >
                                    Открыть заново
                                  </Button>
                                </HoverHint>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right font-medium">
                          <HoverHint label="Сумма заявки">
                            <span>
                              {request.amount} {request.currency}
                            </span>
                          </HoverHint>
                        </div>
                        <span
                          className={`h-fit rounded-full border px-3 py-1 text-xs ${statusSummary.className}`}
                        >
                          {statusSummary.label}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">Пока нет заявок.</p>
                )}
              </div>
              {myRequests && myRequests.totalPages > 1 ? (
                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Страница {myRequests.page} из {myRequests.totalPages} · всего {myRequests.totalCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={myRequests.page <= 1}
                      onClick={() => setMyPage((page) => Math.max(1, page - 1))}
                    >
                      Назад
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={myRequests.page >= myRequests.totalPages}
                      onClick={() => setMyPage((page) => page + 1)}
                    >
                      Дальше
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          )}

          {isApprover && activeView === "all" && (
            <Card className="border-zinc-200 bg-[linear-gradient(180deg,rgba(250,250,250,0.98)_0%,rgba(244,244,245,0.97)_100%)]">
              <CardHeader className="flex flex-col gap-3">
                <div>
                  <CardTitle>Все заявки</CardTitle>
                  <CardDescription>Полный список заявок.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Select value={allSort} onValueChange={setAllSort}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Сортировка" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created_desc">По дате создания: новые</SelectItem>
                      <SelectItem value="created_asc">По дате создания: старые</SelectItem>
                      <SelectItem value="updated_desc">По дате изменения: новые</SelectItem>
                      <SelectItem value="updated_asc">По дате изменения: старые</SelectItem>
                      <SelectItem value="deadline_asc">По дедлайну: ближе</SelectItem>
                      <SelectItem value="deadline_desc">По дедлайну: дальше</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-[200px]"
                    placeholder="Поиск по номеру"
                    value={allRequestCodeQuery}
                    onChange={(event) => setAllRequestCodeQuery(event.target.value)}
                  />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Фильтр" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={authorFilter} onValueChange={setAuthorFilter}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="От кого заявка" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Все авторы</SelectItem>
                        {adContacts?.map((contact) => (
                          <SelectItem key={contact.email} value={contact.email}>
                            {contact.fullName
                              ? `${contact.fullName}${contact.creatorTitle ? ` · ${contact.creatorTitle}` : ""} · ${contact.email}`
                              : contact.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Категория" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все категории</SelectItem>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={fundingFilter} onValueChange={setFundingFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Источник" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все источники</SelectItem>
                      {FUNDING_SOURCES.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isTagViewer && (
                    <Select value={tagFilter} onValueChange={setTagFilter}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue placeholder="Тег CFD" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все теги</SelectItem>
                        <SelectItem value="without_tag">Без тега</SelectItem>
                        {(cfdTags ?? []).map((tag) => (
                          <SelectItem key={tag._id} value={tag.name}>
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    type="date"
                    className="w-[180px]"
                    value={createdFrom}
                    onChange={(event) => setCreatedFrom(event.target.value)}
                  />
                  <Input
                    type="date"
                    className="w-[180px]"
                    value={createdTo}
                    onChange={(event) => setCreatedTo(event.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {allRequestItems.length ? (
                    allRequestItems.map(({ request, approvals }) => {
                      const baseStatusSummary = getRequestStatusSummary(request, approvals);
                      const isActionableForViewer =
                        request.status === "pending" &&
                        approvals.some(
                          (approval) =>
                            approval.status === "pending" && (myRoles ?? []).includes(approval.role),
                        );
                      const statusSummary =
                        request.status === "pending"
                          ? getPendingStatusPresentation(isActionableForViewer)
                          : baseStatusSummary;
                      return (
                        <Link
                          key={request._id}
                          href={`/requests/${request._id}`}
                          className="grid gap-3 rounded-lg border border-border px-4 py-3 text-sm transition-all hover:border-zinc-300 hover:bg-[linear-gradient(135deg,rgba(249,250,251,0.98)_0%,rgba(244,244,245,0.96)_100%)] hover:shadow-[0_10px_30px_rgba(63,63,70,0.08)] md:grid-cols-[minmax(0,1fr)_auto_auto]"
                        >
                          <div>
                            <div className="font-medium">
                              {getRequestDisplayTitle(request)}
                              {request.cfdTag ? (
                                <span className="ml-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                  {request.cfdTag}
                                </span>
                              ) : null}
                              {(request.attachmentCount ?? 0) > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                                  <Paperclip className="h-3 w-3" />
                                  {request.attachmentCount}
                                </span>
                              ) : null}
                              {request.archivedAt ? (
                                <span className="ml-2 rounded border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                                  Архив
                                </span>
                              ) : null}
                            </div>
                            <RequestMetaSummary
                              requestCode={request.requestCode}
                              clientName={request.clientName}
                              category={request.category}
                            />
                            <div className="text-muted-foreground">
                              <HoverHint label="Сумма заявки">
                                <span>
                                  {request.amount} {request.currency}
                                </span>
                              </HoverHint>
                            </div>
                            <div className="text-muted-foreground">
                              <HoverHint label="Дата создания заявки">
                                <span>Создано: {new Date(request.createdAt).toLocaleDateString("ru-RU")}</span>
                              </HoverHint>
                            </div>
                            {request.status === "awaiting_payment" && request.awaitingPaymentByEmail ? (
                              <div className="text-muted-foreground">
                                В оплату передал: {request.awaitingPaymentByName ? `${request.awaitingPaymentByName} · ` : ""}
                                {request.awaitingPaymentByEmail}
                              </div>
                            ) : null}
                            <div className="text-muted-foreground">
                              {request.createdByName ? `${request.createdByName} · ` : ""}
                              {request.createdByEmail}
                            </div>
                          </div>
                        <div className="text-right font-medium">
                          <HoverHint label="Сумма заявки">
                            <span>
                              {request.amount} {request.currency}
                            </span>
                          </HoverHint>
                        </div>
                          <span
                            className={`h-fit rounded-full border px-3 py-1 text-xs ${statusSummary.className}`}
                          >
                            {statusSummary.label}
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground">Заявок нет.</p>
                  )}
                </div>
                {allRequests && allRequests.totalPages > 1 ? (
                  <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Страница {allRequests.page} из {allRequests.totalPages} · всего {allRequests.totalCount}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={allRequests.page <= 1}
                        onClick={() => setAllPage((page) => Math.max(1, page - 1))}
                      >
                        Назад
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={allRequests.page >= allRequests.totalPages}
                        onClick={() => setAllPage((page) => page + 1)}
                      >
                        Дальше
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </RequireAuth>
  );
}
