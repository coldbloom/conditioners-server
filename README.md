# conditioners-server
"dev": "nodemon build/index.js"

🚦 Запуск проекта
🔥 Режим разработки
```bash
    "ts-node-dev --respawn --transpile-only --clear src/server.ts"
```
ts-node-dev
    Это замена связки ts-node + nodemon — инструмент, который:
    Запускает TypeScript-код без предварительной компиляции в JS (ts-node)
    Автоматически перезагружает сервер при изменениях файлов (nodemon)

--respawn
    Что делает: Перезапускает процесс при его аварийном завершении
    Зачем: Если сервер упадёт с ошибкой, он автоматически перезапустится 
    Аналог: Как nodemon, но встроен в ts-node-dev

--transpile-only
    Что делает: Компилирует TS в JS без проверки типов
    Зачем: Ускоряет перезагрузку в 2-5 раз (пропускает долгую проверку типов)
    Осторожно: Ошибки типов не будут мешать работе, но могут проскользнуть в runtime
    Альтернатива: Без флага — медленнее, но безопаснее

--clear
    Что делает: Очищает консоль при каждом перезапуске
    Зачем: Убирает «мусор» от предыдущих запусков, чтобы логи были чище


npm install pm2 -g

pm2 start dist/server.js --name "my-app"
pm2 save
pm2 startup

бэк называется server в pm2

## MVP: клики по телефону MedTaxi

`POST /api/call-clicks` принимает факт нажатия телефонной ссылки и пишет событие
в stdout одной строкой с префиксом `[call-click]`. Ответ: `202` и
`{"accepted":true,"eventId":"..."}`. Это подтверждение приёма клика, а не звонка.

После ответа `202` backend асинхронно отправляет уведомление в Telegram и предлагает
оператору заполнить результат звонка. Ошибка Telegram не меняет уже отправленный
браузеру ответ; она появляется в логах с `eventId`. События также остаются в
`pm2 logs server`.

БД и миграций пока нет. Незавершённые формы, блокировки между операторами и список
обработанных кликов хранятся в памяти процесса и сбрасываются при рестарте. Итоговая
карточка остаётся в Telegram, но ещё не сохраняется в постоянное хранилище.

Новые router подключены отдельно перед существующими middleware. CORS и
Telegram-маршрутизация `/api/feedback` не изменены. Новые зависимости не нужны.

### Telegram-форма MedTaxi

Используется существующий бот из `FREEZE_MASTER_TELEGRAM_TOKEN`, уведомления идут в
`FREEZE_MASTER_CHAT_ID`. После клика бот присылает кнопку «Оформить заявку», затем
последовательно запрашивает телефон клиента, адреса, дату/время по Москве, вес,
положение пациента и цену. Перед завершением показывает карточку с подтверждением,
повторным заполнением и отменой. `/cancel` отменяет активный черновик.

Добавьте в `.env`:

```dotenv
TELEGRAM_WEBHOOK_SECRET=случайная_строка
TELEGRAM_OPERATOR_IDS=123456789
PUBLIC_BACKEND_URL=https://api.example.ru
```

`TELEGRAM_OPERATOR_IDS` — необязательный список Telegram user ID через запятую.
Если он пуст, форму могут заполнять все участники `FREEZE_MASTER_CHAT_ID`. Для
рабочей группы рекомендуется явно указать операторов. Token и webhook secret нельзя
передавать во frontend или писать в логи.

`FREEZE_MASTER_CHAT_ID` может быть числовым ID чата (`-100...`) или публичным
`@username`. Числовой ID надёжнее: он не изменится при переименовании чата.

После выкладки backend зарегистрируйте webhook (публичный адрес должен использовать
HTTPS):

```bash
npm run telegram:set-webhook
```

Telegram будет отправлять `message` и `callback_query` на
`POST /api/telegram/webhook`. Endpoint проверяет secret header, chat ID и allowlist
операторов. Повтор одного `update_id` в рамках работающего процесса игнорируется.

### Локальная проверка

Backend использует имеющийся `.env`. Значения работающих сервисов не заменяйте
примером из `.env.example`. Для локального backend достаточно свободного порта:

```bash
PORT=3235 npm run dev
```

Во frontend задайте в `.env.local` и перезапустите Next.js:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3235/api
```

Нажатие «Позвонить» отправляет JSON с `Content-Type: text/plain;charset=UTF-8`.
Такой формат позволяет браузеру отправить запрос без предварительного OPTIONS;
обычный `application/json` также поддерживается. Пример проверки backend:

```bash
curl -i http://localhost:3235/api/call-clicks \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: text/plain;charset=UTF-8' \
  --data '{"eventId":"8039e6de-b47c-4c6e-8507-b128e1739e6c","trackingId":"hero","phone":"+79895052785","page":"/donetsk","utm":{"source":"yandex","campaign":"donetsk"},"clientTimestamp":"2026-09-20T12:33:59.000Z"}'
```

Обязательные поля: `eventId` (UUID), `trackingId`, `phone`, `page` (pathname).
Опциональные: `referrer`, `utm` (`source`, `medium`, `campaign`, `content`, `term`),
`yclid`, `sessionId` (UUID), `clientTimestamp` (ISO UTC).
Сервер добавляет `receivedAt` и `userAgent` из запроса. IP в лог не записывается.

### CORS и ограничения

Для кликов разрешён `MEDTAXI_URL`. Дополнительные origins можно перечислить через
запятую в `CALL_CLICK_ALLOWED_ORIGINS`. В development автоматически разрешены
`http://localhost:3000` и `http://127.0.0.1:3000`. В production запускайте процесс
с `NODE_ENV=production`; localhost тогда требует явного добавления в список.
Запрос без Origin разрешён для серверной диагностики. CORS не является авторизацией.

Невалидное тело получает `400`, неизвестный origin — `403`, тело больше 16 КБ —
`413`. Есть ограничение 120 запросов в минуту на сетевой адрес одного процесса
(`429` при превышении). За reverse proxy посетители могут делить этот лимит:
настройка `trust proxy` работающего API не изменялась. Для нескольких процессов
или большой нагрузки нужен лимит на прокси. Счётчики сбрасываются при рестарте.

### Проверки и запуск в production

```bash
npm test
npm run build
```

Для production необходимо доставить обновлённый код, собрать его и перезапустить
существующий процесс. Обычный workflow после доставки кода:

```bash
npm run build
NODE_ENV=production pm2 restart server --update-env
pm2 logs server
```

Без этого старый процесс продолжит отвечать `404 Cannot POST /api/call-clicks`.
Для отладки из локального frontend production backend требует явного
`CALL_CLICK_ALLOWED_ORIGINS=http://localhost:3000`; предпочтительно проверять на
локальном backend. Секреты Telegram остаются только в существующем backend `.env`.
