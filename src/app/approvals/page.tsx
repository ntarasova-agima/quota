"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import DateRangeFilter from "@/components/date-range-filter";
import RequestMetaSummary from "@/components/request-meta-summary";
import { getBuhPaymentStatusSummary, getUnallocatedPaymentAmounts } from "@/lib/requestStatus";
import { formatAmountPair } from "@/lib/vat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverHint } from "@/components/ui/hover-hint";
import { Input } from "@/components/ui/input";
import SearchableSelect from "@/components/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/convex";
import { normalizeRequestCategory } from "@/lib/requestRules";
import { EMPTY_BUSINESS_CATEGORY, EXPENSE_CATEGORIES, FUNDING_SOURCES } from "@/lib/constants";
import { hasFinanceApproverRole } from "@/lib/financeRole";

function getRequestDisplayTitle(request: {
  title?: string;
  clientName: string;
  category: string;
}) {
  return request.title?.trim() || `${request.clientName} :: ${normalizeRequestCategory(request.category)}`;
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

function summarizeStatuses(statusFilters: string[]) {
  if (statusFilters.length === 0) {
    return "Все статусы";
  }
  if (statusFilters.length === 1) {
    return statusOptions.find((item) => item.value === statusFilters[0])?.label ?? "1 статус";
  }
  return `Статусы: ${statusFilters.length}`;
}

function toStartOfDay(value?: string) {
  if (!value) {
    return undefined;
  }
  return new Date(`${value}T00:00:00`).getTime();
}

function toEndOfDay(value?: string) {
  if (!value) {
    return undefined;
  }
  return new Date(`${value}T23:59:59.999`).getTime();
}

export default function ApprovalsPage() {
  const items = useQuery(api.approvals.listPendingForMe);
  const myRoles = useQuery(api.roles.myRoles);
  const myProfile = useQuery(api.roles.myProfile);
  const adContacts = useQuery(api.roles.listAdContacts);
  const businessCategories = useQuery(api.businessCategories.list, {});
  const [taskTypeFilter, setTaskTypeFilter] = useState<"all" | "approval" | "payment">("all");
  const [buhQuickFilter, setBuhQuickFilter] = useState<"all" | "today" | "overdue">("all");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [businessCategoryFilter, setBusinessCategoryFilter] = useState("all");
  const [fundingFilter, setFundingFilter] = useState("all");
  const [specialistFilter, setSpecialistFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [createdMonth, setCreatedMonth] = useState("");
  const [requestCodeQuery, setRequestCodeQuery] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const isFinanceHead = useMemo(
    () => hasFinanceApproverRole({ roles: myRoles ?? [], hodDepartments: myProfile?.hodDepartments ?? [] }),
    [myProfile?.hodDepartments, myRoles],
  );
  const isFinanceRole = myRoles?.includes("BUH") || isFinanceHead;
  const canFilterByTags = myRoles?.some((role) => ["CFD", "BUH", "COO", "ADMIN"].includes(role)) || isFinanceHead;
  const cfdTags = useQuery(api.cfdTags.list, canFilterByTags ? {} : "skip");
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
  const businessCategoryOptions = businessCategories ?? [
    { _id: "empty", name: EMPTY_BUSINESS_CATEGORY },
  ];
  const authorOptions = useMemo(
    () => [
      { value: "all", label: "Все авторы", searchText: "все авторы" },
      ...((adContacts ?? []).map((contact) => ({
        value: contact.email,
        label: contact.fullName || contact.email,
        subtitle: [contact.creatorTitle, contact.email].filter(Boolean).join(" · "),
        searchText: [contact.fullName, contact.creatorTitle, contact.email].filter(Boolean).join(" "),
      }))),
    ],
    [adContacts],
  );
  const tagOptions = useMemo(
    () => [
      { value: "all", label: "Все теги", searchText: "все теги" },
      { value: "without_tag", label: "Без тега", searchText: "без тега" },
      ...((cfdTags ?? []).map((tag) => ({
        value: tag.name,
        label: tag.name,
        subtitle: tag.department || undefined,
        searchText: `${tag.name} ${tag.department ?? ""}`,
      }))),
    ],
    [cfdTags],
  );
  const visibleItems = useMemo(() => {
    if (!items) {
      return [];
    }
    let filtered = [...items];
    if (taskTypeFilter !== "all") {
      filtered = filtered.filter(({ kind }) =>
        taskTypeFilter === "payment" ? kind === "payment" : kind !== "payment",
      );
    }
    if (isFinanceRole && buhQuickFilter !== "all") {
      filtered = filtered.filter(({ kind, request }) => {
        if (kind !== "payment" || !request.neededBy) {
          return false;
        }
        if (buhQuickFilter === "today") {
          return request.neededBy >= todayStart && request.neededBy < tomorrowStart;
        }
        return request.neededBy < todayStart;
      });
    }
    if (statusFilters.length > 0) {
      filtered = filtered.filter(({ request }) => statusFilters.includes(request.status));
    }
    if (authorFilter !== "all") {
      filtered = filtered.filter(({ request }) => request.createdByEmail === authorFilter);
    }
    if (tagFilter !== "all") {
      filtered = filtered.filter(({ request }) =>
        tagFilter === "without_tag" ? !request.cfdTag?.trim() : request.cfdTag === tagFilter,
      );
    }
    if (categoryFilter !== "all") {
      filtered = filtered.filter(
        ({ request }) =>
          normalizeRequestCategory(request.category) === normalizeRequestCategory(categoryFilter),
      );
    }
    if (businessCategoryFilter !== "all") {
      filtered = filtered.filter(
        ({ request }) =>
          (request.businessCategory ?? EMPTY_BUSINESS_CATEGORY) === businessCategoryFilter,
      );
    }
    if (fundingFilter !== "all") {
      filtered = filtered.filter(({ request }) => request.fundingSource === fundingFilter);
    }
    if (isFinanceRole && specialistFilter === "with_specialists") {
      filtered = filtered.filter(({ request }) => (request.specialists?.length ?? 0) > 0);
    }
    const createdFromTimestamp = toStartOfDay(createdFrom);
    const createdToTimestamp = toEndOfDay(createdTo);
    if (createdFromTimestamp !== undefined) {
      filtered = filtered.filter(({ request }) => request.createdAt >= createdFromTimestamp);
    }
    if (createdToTimestamp !== undefined) {
      filtered = filtered.filter(({ request }) => request.createdAt <= createdToTimestamp);
    }
    if (requestCodeQuery.trim()) {
      const normalizedQuery = requestCodeQuery.trim().toLowerCase();
      filtered = filtered.filter(({ request }) =>
        (request.requestCode ?? "").toLowerCase().includes(normalizedQuery),
      );
    }
    filtered.sort((left, right) => {
      if (sort === "updated_asc") return left.request.updatedAt - right.request.updatedAt;
      if (sort === "created_desc") return right.request.createdAt - left.request.createdAt;
      if (sort === "created_asc") return left.request.createdAt - right.request.createdAt;
      if (sort === "deadline_asc") {
        return (left.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER) - (right.request.approvalDeadline ?? Number.MAX_SAFE_INTEGER);
      }
      if (sort === "deadline_desc") {
        return (right.request.approvalDeadline ?? 0) - (left.request.approvalDeadline ?? 0);
      }
      if (sort === "business_category_asc") {
        return (left.request.businessCategory ?? "").localeCompare(
          right.request.businessCategory ?? "",
          "ru",
        );
      }
      if (sort === "business_category_desc") {
        return (right.request.businessCategory ?? "").localeCompare(
          left.request.businessCategory ?? "",
          "ru",
        );
      }
      return right.request.updatedAt - left.request.updatedAt;
    });
    return filtered;
  }, [
    authorFilter,
    buhQuickFilter,
    businessCategoryFilter,
    categoryFilter,
    createdFrom,
    createdTo,
    fundingFilter,
    isFinanceRole,
    items,
    requestCodeQuery,
    sort,
    statusFilters,
    specialistFilter,
    tagFilter,
    taskTypeFilter,
    todayStart,
    tomorrowStart,
  ]);

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
                {(myRoles?.some((role) => ["NBD", "AI-BOSS", "COO", "CFD", "HOD", "ADMIN", "BUH"].includes(role)) || isFinanceHead) ? (
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
              <div className="mb-4 flex flex-wrap gap-3">
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Сортировка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="updated_desc">По дате изменения: новые</SelectItem>
                    <SelectItem value="updated_asc">По дате изменения: старые</SelectItem>
                    <SelectItem value="created_desc">По дате создания: новые</SelectItem>
                    <SelectItem value="created_asc">По дате создания: старые</SelectItem>
                    <SelectItem value="deadline_asc">По дедлайну: ближе</SelectItem>
                    <SelectItem value="deadline_desc">По дедлайну: дальше</SelectItem>
                    <SelectItem value="business_category_asc">По категории: А-Я</SelectItem>
                    <SelectItem value="business_category_desc">По категории: Я-А</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="w-[200px]"
                  placeholder="Поиск по номеру"
                  value={requestCodeQuery}
                  onChange={(event) => setRequestCodeQuery(event.target.value)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-[220px] justify-between">
                      <span className="truncate">{summarizeStatuses(statusFilters)}</span>
                      <span className="text-xs text-muted-foreground">{statusFilters.length || "Все"}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[240px]">
                    {statusOptions
                      .filter((option) => option.value !== "all")
                      .map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={statusFilters.includes(option.value)}
                          onCheckedChange={(checked) =>
                            setStatusFilters((current) =>
                              checked
                                ? [...current, option.value]
                                : current.filter((value) => value !== option.value),
                            )
                          }
                        >
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Тип заявки" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все типы заявок</SelectItem>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={businessCategoryFilter} onValueChange={setBusinessCategoryFilter}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Категория" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все категории</SelectItem>
                    {businessCategoryOptions.map((category) => (
                      <SelectItem key={category._id} value={category.name}>
                        {category.name}
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
                <SearchableSelect
                  className="w-[240px]"
                  value={authorFilter}
                  options={authorOptions}
                  placeholder="Автор"
                  searchPlaceholder="Найти автора"
                  onValueChange={setAuthorFilter}
                />
                {isFinanceRole ? (
                  <Select value={specialistFilter} onValueChange={setSpecialistFilter}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="Специалисты" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все заявки</SelectItem>
                      <SelectItem value="with_specialists">В заявке есть специалисты</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {canFilterByTags ? (
                  <SearchableSelect
                    className="w-[240px]"
                    value={tagFilter}
                    options={tagOptions}
                    placeholder="Тег заявки"
                    searchPlaceholder="Найти тег"
                    onValueChange={setTagFilter}
                  />
                ) : null}
                <DateRangeFilter
                  className="w-[250px]"
                  value={{
                    from: createdFrom,
                    to: createdTo,
                    monthKey: createdMonth,
                  }}
                  onChange={(nextValue) => {
                    setCreatedMonth(nextValue.monthKey);
                    setCreatedFrom(nextValue.from);
                    setCreatedTo(nextValue.to);
                  }}
                />
              </div>
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
                                  Не распределено:{" "}
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
