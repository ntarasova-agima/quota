# Aurum: карта модулей и логики

Дата актуализации: 24.04.2026

Этот файл помогает быстро понять, где в коде лежит ключевой функционал Aurum.

## Заявки

- [`src/app/requests/new/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/requests/new/page.tsx) — форма создания заявки
- [`src/app/requests/[id]/edit/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/requests/%5Bid%5D/edit/page.tsx) — редактирование заявки
- [`src/app/requests/[id]/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/requests/%5Bid%5D/page.tsx) — карточка заявки, согласование, оплата, комментарии, теги
- [`src/app/requests/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/requests/page.tsx) — списки заявок, фильтры и поиск

## Бизнес-правила формы

- [`src/lib/requestRules.ts`](/Users/ntarasova/Documents/New%20project/quota/src/lib/requestRules.ts) — типы заявок, источники финансирования, правила по цехам, логика получателя сервиса
- [`src/lib/requestFields.ts`](/Users/ntarasova/Documents/New%20project/quota/src/lib/requestFields.ts) — прикладные вычисления формы, транзит, даты, методы оплаты
- [`src/lib/departments.ts`](/Users/ntarasova/Documents/New%20project/quota/src/lib/departments.ts) — список цехов и нормализация legacy-значений
- [`src/lib/vat.ts`](/Users/ntarasova/Documents/New%20project/quota/src/lib/vat.ts) — расчет сумм без НДС и с НДС

## Согласование и доступ

- [`convex/approvals.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/approvals.ts) — согласование, допсогласование, напоминания
- [`convex/requestWorkflow.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/requestWorkflow.ts) — расчет маршрута и статусов согласования
- [`convex/requestAccessHelpers.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/requestAccessHelpers.ts) — доступ к заявкам, viewer access, правила просмотра для HOD

## Оплата

- [`convex/requests.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/requests.ts) — жизненный цикл заявки, передача в оплату, планирование и фиксация платежей, теги заявки
- [`src/app/requests/[id]/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/requests/%5Bid%5D/page.tsx) — UI оплаты и платежной ленты

## Квоты и теги

- [`convex/quotas.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/quotas.ts) — таблицы квот, история изменений, ручное списание по тегам, права ролей
- [`convex/quotaUsage.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/quotaUsage.ts) — единый расчет фактического использования квоты по заявкам
- [`convex/cfdTags.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/cfdTags.ts) — справочник тегов и права на его изменение
- [`src/app/administration-quota/administrationQuotaClient.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/administration-quota/administrationQuotaClient.tsx) — UI общей квотной таблицы AGIMA
- [`src/app/cfd-tags/page.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/app/cfd-tags/page.tsx) — UI справочника тегов

## Комментарии, файлы и коммуникация

- [`convex/comments.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/comments.ts) — комментарии, mention-логика, треды
- [`convex/attachments.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/attachments.ts) — загрузка и хранение файлов
- [`convex/emails.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/emails.ts) — email-уведомления
- [`convex/timeline.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/timeline.ts) и [`convex/timelineHelpers.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/timelineHelpers.ts) — таймлайн событий

## Схема данных

- [`convex/schema.ts`](/Users/ntarasova/Documents/New%20project/quota/convex/schema.ts) — роли, заявки, согласования, комментарии, файлы, теги, квоты, история

## Навигация и шапка

- [`src/components/AppHeader.tsx`](/Users/ntarasova/Documents/New%20project/quota/src/components/AppHeader.tsx) — основные переходы между разделами по ролям

## Документация

- [`README.md`](/Users/ntarasova/Documents/New%20project/quota/README.md) — общий обзор проекта
- [`docs/aurum-user-guide.md`](/Users/ntarasova/Documents/New%20project/quota/docs/aurum-user-guide.md) — пользовательская инструкция
- [`docs/aurum-user-guide.txt`](/Users/ntarasova/Documents/New%20project/quota/docs/aurum-user-guide.txt) — версия для Confluence wiki markup
- [`docs/aurum-business-process.md`](/Users/ntarasova/Documents/New%20project/quota/docs/aurum-business-process.md) — диаграмма процесса заявки
