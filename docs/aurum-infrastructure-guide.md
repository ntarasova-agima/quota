# Aurum: памятка для инфраструктуры, эксплуатации и технической поддержки

*Дата актуализации: 24.04.2026*

## 1. Что это за сервис

Aurum — внутренний сервис AGIMA для создания, согласования, оплаты и сопровождения заявок на бюджет и затраты.

Сервис покрывает полный цикл:
- создание и редактирование заявок;
- согласование по ролям и цехам;
- HOD-валидацию прямых затрат;
- передачу в оплату;
- планирование полных и частичных платежей;
- учет квот AGIMA, цехов и тегов;
- комментарии, вложения, viewer access, таймлайн и email-лог.

## 2. Актуальная архитектура

Сейчас система состоит из трех основных частей:

- frontend: Next.js 16 / React 19;
- backend и data layer: Convex Cloud;
- почта: SMTP через Next API route `/api/email/send` и `nodemailer`.

Ключевая особенность текущей реализации:
- вход по коду работает только для почт `@agima.ru`;
- Convex сам инициирует отправку писем через frontend endpoint `/api/email/send`;
- frontend должен быть доступен извне по URL, который видит Convex.

## 3. Контуры и домены

### Production

- frontend: `https://aurum.agima.ru`
- Convex deployment: `https://cloud.aurum.agima.ru`

### Stage

- frontend: `https://stage.aurum.agima.ru`
- Convex deployment: `https://cloud.stage.aurum.agima.ru`

## 4. Текущее размещение

Рабочая модель на апрель 2026:

- frontend развернут на сервере `AURUM` (`10.104.0.74`);
- deployment orchestration идет через Dokploy;
- backend и база данных не живут на этой VM, а находятся в managed Convex;
- SMTP — внешний относительно приложения, но внутренний по инфраструктуре AGIMA.

Текущие frontend-приложения в Dokploy:

- production service: `aurum-frontend-dwhw3q`
- stage service: `aurum-frontend-stage-emwas7`

Текущие server-side clones:

- production code: `/etc/dokploy/applications/aurum-frontend-dwhw3q/code`
- stage code: `/etc/dokploy/applications/aurum-frontend-stage-emwas7/code`

## 5. Релизный контур и текущий обходной путь

Нормальный целевой путь — redeploy через Dokploy.

Но на текущий момент есть важный инфраструктурный нюанс:

- у Dokploy периодически ломается SSH handshake до `AURUM`;
- из-за этого обычный redeploy из Dokploy может падать до шага сборки.

Текущий рабочий обходной путь, которым реально выкатывается frontend:

1. Обновить код в `main` и `stage`.
2. Задеплоить Convex отдельно в нужный environment.
3. Получить рабочий SSH-доступ к `AURUM`.
4. На сервере fast-forward соответствующий clone:
   - `main` для prod
   - `stage` для stage
5. Собрать Docker image на самом сервере.
6. Выполнить `docker service update --image ... --force ...` для нужного сервиса.
7. Проверить:
   - `docker service ls`
   - `https://aurum.agima.ru`
   - `https://stage.aurum.agima.ru`

Важно:
- секреты, API keys и SSH private keys не должны храниться в репозитории;
- в документации допускается хранить только названия сервисов, домены и paths к code clones.

## 6. Актуальный стек

### Frontend

- Next.js `16.1.6`
- React `19.2.3`
- Tailwind CSS
- shadcn/ui

### Backend

- Convex
- `@convex-dev/auth`

### Почта

- `nodemailer`
- SMTP relay `agima.ru`

### Инструменты разработки

- TypeScript
- ESLint
- Vitest

## 7. Актуальные env-переменные

### Обязательные для frontend/runtime

- `NEXT_PUBLIC_CONVEX_URL`
- `EMAIL_BASE_URL`
- `EMAIL_API_BASE_URL`
- `EMAIL_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`

### Обязательные для auth / Convex email flow

- `CONVEX_SITE_URL`
- `EMAIL_BASE_URL`
- `EMAIL_API_BASE_URL`
- `EMAIL_API_KEY`

### Рекомендуемые SMTP env

- `SMTP_SECURE`
- `SMTP_SERVERNAME`
- `SMTP_DOMAIN`
- `SMTP_USER`
- `SMTP_PASS`

### Для CLI / deploy

- `CONVEX_DEPLOYMENT`

Важно:
- в текущем коде используются `CONVEX_SITE_URL`, `EMAIL_BASE_URL`, `EMAIL_API_BASE_URL`, а не старые `SITE_URL` / `NEXT_PUBLIC_CONVEX_SITE_URL`;
- `JWT_PRIVATE_KEY` и `JWKS` в текущем коде Aurum не используются, старые памятки на них больше ориентироваться не должны;
- если сломан `EMAIL_API_BASE_URL`, письма могут перестать уходить даже при живом SMTP;
- если сломан `CONVEX_SITE_URL`, ломается auth provider для входа по коду.

## 8. Почта и авторизация

### Вход

- пользователь вводит email;
- допускаются только `@agima.ru`;
- код входа отправляется письмом;
- письмо шлется через Convex -> frontend `/api/email/send` -> SMTP.

### Отправка писем

Письма используются для:

- входа по коду;
- новых согласований;
- напоминаний о согласовании;
- передачи в оплату;
- напоминаний об оплате;
- изменений по оплате;
- упоминаний в комментариях;
- выдачи viewer access;
- HOD-валидации;
- прочих системных событий.

Если письма не приходят, проверять по порядку:

1. Жив ли frontend URL, на который смотрит `EMAIL_API_BASE_URL`.
2. Отдает ли `/api/email/send` корректный ответ.
3. Корректны ли `EMAIL_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`.
4. Нет ли ошибок в `requestEmailLogs`.
5. Нет ли SMTP timeout / TLS проблем.

## 9. Наблюдаемость и точки проверки

Минимум, который должен мониториться:

- доступность `https://aurum.agima.ru`
- доступность `https://stage.aurum.agima.ru`
- работоспособность `NEXT_PUBLIC_CONVEX_URL`
- отправка писем через `/api/email/send`
- статус docker services на `AURUM`

Что полезно проверять при инциденте:

- карточку заявки;
- вкладку `Таймлайн`;
- вкладку `Изменения`;
- `requestEmailLogs`;
- `approvals`;
- `roles`;
- текущий `status` заявки;
- `viewerAccess`, если проблема в видимости.

## 10. Ключевые таблицы и данные

Основные таблицы, с которыми реально работает текущий сервис:

- `requests`
- `approvals`
- `roles`
- `comments`
- `requestAttachments`
- `requestChangeLogs`
- `requestTimelineEvents`
- `requestEmailLogs`
- `cfdTags`
- `requestBusinessCategories`
- `administrationQuotas`
- `quotaChangeLogs`
- `requestCounters`

Важно:
- в schema все еще есть legacy-таблицы `presalesQuotas`, `aiToolQuotas`, `cfdQuotas`, `cooQuotas`;
- основной пользовательский путь сейчас идет через `administrationQuotas` и единую модель `Квоты AGIMA`;
- legacy-таблицы нужны скорее для обратной совместимости и старых сценариев, не как основная продуктовая модель.

## 11. Что особенно важно техподдержке

Типовые инциденты:

- не приходит код входа;
- заявка не видна в списке;
- заявка не ушла нужному согласующему;
- завис маршрут через HOD;
- не проходит передача в оплату;
- BUH/CFD не могут распределить платеж;
- сумма не списалась из квоты или списалась неожиданно;
- в UI показан сырой backend error.

Первая линия проверки:

1. Открыть карточку заявки.
2. Проверить `status`.
3. Проверить `approvals` и pending approvals.
4. Проверить `viewerAccess`.
5. Проверить, есть ли `requestTimelineEvents`.
6. Проверить, уходили ли письма в `requestEmailLogs`.
7. Если вопрос про квоты — проверить `administrationQuotas` и `quotaChangeLogs`.

## 12. Release checklist

Перед выкладкой:

1. `npx convex codegen`
2. `npm test`
3. `npm run build`
4. Деплой Convex в нужный environment
5. Redeploy frontend
6. Smoke test:
   - sign-in по коду
   - создание заявки
   - согласование
   - передача в оплату
   - планирование оплаты
   - частичная оплата
   - закрытие заявки

## 13. Known issues и ограничения

- Dokploy SSH redeploy path сейчас ненадежен, поэтому фронт иногда приходится выкатывать вручную на сервере.
- Сервис зависит от внешнего Convex deployment: при проблемах на стороне Convex frontend может быть жив, а бизнес-операции — нет.
- Email-контур зависит сразу от трех слоев:
  - Convex function
  - frontend `/api/email/send`
  - SMTP relay
- В коде есть legacy-квотные сценарии; для новых инцидентов ориентироваться нужно на единую модель квот AGIMA.

## 14. Где смотреть дальше

- общая пользовательская инструкция: `docs/aurum-user-guide.md`
- пользовательская wiki-версия: `docs/aurum-user-guide.txt`
- памятка по сопровождению и текущим сценариям: `docs/aurum-operating-guide.md`
- карта функционала: `docs/aurum-functional-map.md`
- диаграмма бизнес-процесса: `docs/aurum-business-process.md`
