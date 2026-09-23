/** Первые рекламные параметры посетителя, сохранённые frontend в рамках вкладки. */
export interface CallClickUtm {
  /** Рекламная система или сайт, например yandex. */
  source?: string;
  /** Тип трафика, например cpc. */
  medium?: string;
  /** Название рекламной кампании. */
  campaign?: string;
  /** Объявление или вариант рекламного материала. */
  content?: string;
  /** Поисковый запрос или ключевая фраза. */
  term?: string;
}

/** Только факт нажатия tel:-ссылки. Не подтверждает, что звонок состоялся. */
export interface CallClickInput {
  /** UUID отдельного клика; позволяет найти событие в логах frontend и backend. */
  eventId: string;
  /** Семантическое имя кнопки, например hero или footer. */
  trackingId: string;
  /** Номер из ссылки, например +79895052785. */
  phone: string;
  /** Текущий pathname без query/hash, например /donetsk. */
  page: string;
  /** Внешняя страница, с которой начался визит, если браузер её сообщил. */
  referrer?: string;
  /** Первые UTM-параметры текущего визита. */
  utm?: CallClickUtm;
  /** Рекламный идентификатор Яндекса. */
  yclid?: string;
  /** Анонимный UUID вкладки; это не авторизация и не fingerprint. */
  sessionId?: string;
  /** Время по часам браузера. Сервер дополнительно записывает собственное время. */
  clientTimestamp?: string;
}

/** Проверенное событие с серверным временем приёма. */
export interface AcceptedCallClick extends CallClickInput {
  receivedAt: string;
  userAgent?: string;
}
