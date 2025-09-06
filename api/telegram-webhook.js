import OpenAI from "openai";
import { Redis } from "@upstash/redis";

/* =========================
   ИНИЦИАЛИЗАЦИЯ
   ========================= */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/* =========================
   КОНСТАНТЫ / КЛЮЧИ
   ========================= */
const HISTORY_LEN = 8;
const LANG_KEY = (chatId) => `lang:${chatId}`;

/* =========================
   БЛОК УСЛУГ — ВСТАВЬ СВОЙ СПИСОК
   ========================= */
// ⚠️ Сюда вставь полный перечень услуг (одним текстом). Бот будет опираться ТОЛЬКО на этот список.
const SERVICES_TEXT = `
- масштабирование идеи:
-- Раскрытие потенциала существующей или планируемой компании:
--- определение наилучшего плана реализации вашего проекта;
--- выявление возможностей, которые не были учтены;
--- определение и позиционирование компании на рынке;
--- стратегия развития бренда и ключевые инструменты.
- маркетинговый анализ:
-- Анализ целевого рынка с учетом перспектив:
--- выявление спроса;
--- определение целевой аудитории;
--- определение целевых площадок;
--- анализ конкурентов и цен;
--- заключение и выводы.
- финансовый анализ:
-- Выявление реальной финансовой картины имеющегося бизнеса:
--- фактическая рентабельность и обнаружение убытков;
--- выводы и рекомендации в понятной для руководителя форме;
--- внедрение управленческой отчетности для эффективного ведения бизнеса.
- финансовый план:
-- Прогноз рентабельности планируемого проекта в нескольких вариантах:
--- прогноз доходов, расходов и прибыли;
--- прогноз движения денег;
--- расчет необходимых инвестиций;
--- выявление точки безубыточности;
--- анализ чувствительности к внешним и внутренним факторам.
- бизнес-план:
-- Полное описание проекта в цифрах с учетом всех возможностей и рисков:
--- описание проекта;
--- маркетинговый анализ и стратегия;
--- план реализации проекта;
--- определение полной стоимости организации бизнеса;
--- объем необходимых инвестиций на каждом этапе реализации;
--- анализ планируемых доходов и расходов;
--- расчет рентабельности и окупаемости;
--- SWOT-анализ.
- презентация для инвестора:
-- Краткий бизнес-план проекта для привлечения инвестиций:
--- описание проекта;
--- план освоения и возврата инвестиций;
--- расчет рентабельности и окупаемости;
--- анализ рынка;
--- план реализации проекта;
--- маркетинговый план;
--- финансовый прогноз;
--- SWOT-анализ.
- привлечение инвестиций:
-- Содействие в привлечении инвестиций (при наличии презентации для инвестора):
--- финансовая диагностика компании;
--- составление вариантов предложений для инвестора;
--- разработка тизера и калькулятора инвестиций;
--- запуск рекламы среди потенциальных инвесторов;
--- подготовка руководителя к переговорам с инвесторами;
--- помощь в юридическом оформлении сделки.
- стратегия развития:
-- Определение идеи, миссии, целей и задач по развитию компании:
--- определение миссии для выявления значимости проекта;
--- выявление основных и сопутствующих целей;
--- разработка задач для реализации поставленных целей;
--- определение методологии и инструментов реализации планов;
--- план масштабирования компании;
--- расширение сферы деятельности;
--- расширение целевой аудитории;
--- выстраивание партнерских отношений;
--- создание и укрепление конкурентоспособного бренда;
--- план и сроки реализации стратегии развития.
- концепция работы:
-- Описание работы компании согласно стратегии развития:
--- Основополагающие факторы и определения:
---- позиционирование;
---- целевая аудитория;
---- определение целей и задач.
--- Целенаправленная деятельность по развитию компании:
---- логика планирования мероприятий;
---- принципы проведения PR-акций;
---- организация встреч и конференций;
---- разработка имиджевой продукции;
---- кадровая политика;
---- ценовая политика;
---- совершенствование и расширение линейки продуктов;
---- техника холодных продаж.
--- Медиа-планирование и бюджет:
---- инструменты рекламных кампаний;
---- определение регионов и целевых СМИ;
---- маркетинговый план.
- бизнес-процессы:
-- Анализ, планирование, внедрение, оптимизация и автоматизация деятельности:
--- диагностика текущих бизнес-процессов компании;
--- разработка эффективной карты бизнес-процессов;
--- оптимизация текущей работы и внедрение эффективных методов;
--- разработка обязанностей и регламентов работы сотрудников;
--- автоматизация бизнес-процессов посредством CRM-системы.
- логотип и стиль:
-- Разработка логотипа и фирменного стиля, определяющего образ компании:
--- отражение миссии и деятельности компании;
--- разработка в соответствии с современными трендами;
--- смысловая нагрузка в соответствии с психологией целевой аудитории;
--- учет индивидуальности личности заказчика.
- брендбук:
-- Документация правил использования фирменного стиля:
--- схема и правила использования логотипа;
--- варианты фирменного блока (знак, наименование, слоган);
--- стиль в документообороте (визитки, бланки, папки и т.д.);
--- наружная реклама (вывеска, билборд);
--- печатная реклама (флаер, буклет, рекламный проспект);
--- выставочные материалы (напольный баннер, дизайн стенда);
--- оформление офиса (декор-элементы в фирменном стиле);
--- сувенирная продукция (ручки, блокноты, кружки, кепки, пакеты).
- разработка сайта:
-- Разработка продуманного сайта для получения заявок от клиентов:
--- создание схемы сайта с учетом стратегического развития;
--- отработка логики ведения пользователей и конверсионной воронки;
--- разработка дизайна сайта в соответствии с фирменным стилем;
--- разработка функционала для удобства пользователей;
--- программирование сайта с панелью для самостоятельного управления;
--- разработка и оптимизация мобильной версии;
--- CEO-оптимизация для повышения позиций в поисковиках.
- реклама в интернете:
-- Настройка рекламы в 2ГИС, OLX, объявлений в Google и таргета в Instagram:
--- создание привлекательного профиля в 2ГИС, выбор рекламных инструментов;
--- создание рабочих объявлений в OLX, выбор рекламных инструментов;
--- настройка поисковых объявлений в Google;
--- запуск контекстно-медийной сети (реклама в приложениях);
--- анализ ключевых фраз для повышения эффективности и оптимизации бюджета;
--- дизайн необходимых рекламных макетов;
--- профессиональная настройка таргетированной рекламы;
--- создание рекламных видеороликов по продуктам;
--- аналитика эффективности интернет-рекламы.
- SMM ведение:
-- Полноценное ведение профильной странички в инстаграм (рабочей или личного бренда):
--- разработка стратегии продвижения бренда;
--- составление контент-плана на 1 месяц вперед;
--- профессиональная настройка профиля в Instagram;
--- создание собственной PR-стилистики;
--- создание контента (видеосъемка и дизайн макетов);
--- стабильное размещение контента (посты, reels, stories);
--- аналитика эффективности ведения профиля.
- отдел продаж:
--- Создание или реорганизация отдела продаж, внедрение и адаптация:
--- анализ текущей ситуации по продажам в компании;
--- выявление преимуществ продукта и самой компании;
--- составление скриптов и коммерческих предложений;
--- внедрение системы холодных продаж;
--- обучение персонала навыкам удержания обращений;
--- разработка и внедрение мотивационной системы (ЗП, бонусы, KPI);
--- обучение менеджеров ведению продаж в CRM-системе;
--- настройка этапов и воронок продаж в CRM.
- CRM, автоматизация, ИИ:
-- Перевод всей команды в CRM Битрикс24 для прозрачности и эффективной работы:
--- регистрация и настройка компании в crm-системе Битрикс24;
--- регистрация сотрудников и создание структуры компании;
--- настройка прав пользователей согласно должностей;
--- интеграция и настройка SIP-телефонии, ответственных и записи;
--- интеграция и настройка WhatsApp, Telegram, Instagram, OLX, чат на сайте, форм заявок с сайта;
--- настройка этапов и воронок продаж, смена ответственных;
--- автоматизация бизнес-процессов (задачи, дела, сроки, напоминания);
--- внедрение и обучение ИИ чат-бота для быстрой обработки обращений клиентов 24/7;
--- настройка сквозной аналитики для оценки эффективности рекламы.
- франчайзинг:
-- Разработка и упаковка во франшизу действующего или нового бизнеса:
--- сбор информации и создание концепции франшизы;
--- описание бизнес-процессов компании;
--- создание маркетинговых материалов для франшизы;
--- финансовая модель бизнеса;
--- юридическая упаковка и договоры;
--- подготовка сайта и настройка рекламной кампании;
--- запуск франшизы и обработка первых обращений.
`;

/* =========================
   УТИЛИТЫ
   ========================= */
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function safeParseItem(item) {
  if (item == null) return null;
  if (typeof item === "object") return item;
  if (typeof item === "string") {
    try { return JSON.parse(item); } catch { return null; }
  }
  return null;
}

/* История */
async function getHistory(chatId) {
  const items = await redis.lrange(`hist:${chatId}`, -HISTORY_LEN, -1);
  return (items || []).map(safeParseItem).filter(Boolean);
}
async function pushHistory(chatId, role, content) {
  const entry = { role, content };
  await redis.rpush(`hist:${chatId}`, JSON.stringify(entry));
  await redis.ltrim(`hist:${chatId}`, -HISTORY_LEN, -1);
}

/* Слоты/бронь */
async function getBooking(chatId) {
  const val = await redis.get(`book:${chatId}`);
  if (!val) return { stage: null, topic: null, name: null, phone: null };
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch {
    return { stage: null, topic: null, name: null, phone: null };
  }
}
async function setBooking(chatId, data) {
  await redis.set(`book:${chatId}`, JSON.stringify(data), { ex: 60 * 60 * 24 });
}
async function clearBooking(chatId) {
  await redis.del(`book:${chatId}`);
}

/* Контакт (кэш) */
async function getContact(chatId) {
  const v = await redis.get(`contact:${chatId}`);
  if (!v) return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}
async function setContact(chatId, { name, phone }) {
  await redis.set(`contact:${chatId}`, JSON.stringify({ name, phone }), { ex: 60 * 60 * 24 * 30 });
}
async function clearContact(chatId) {
  await redis.del(`contact:${chatId}`);
}

/* Язык */
function detectLang(text) {
  if (!text) return "ru";
  const hasKazChars = /[әғқңөұүһі]/i.test(text);
  const hasKazHints = /(саламат|салем|сәлем|рахмет|жаксы|жақсы|бар\s*ма|барма|сендер|сиздер|сіздер|сиз|сіз|ия\b|иа\b|жок\b|жоқ\b|калай|қалай)/i.test(text);
  const hasCyr = /[А-Яа-яЁёІіЇїЪъЫыЭэЙй]/.test(text);
  if (hasKazChars || hasKazHints) return "kz";
  if (hasCyr) return "ru";
  return "en";
}
function confidentLangSwitch(text) {
  if (!text || text.trim().length === 0) return null;
  if (/русск|рос/iu.test(text)) return "ru";
  if (/казак|қазақ|казах/iu.test(text)) return "kz";
  if (/english|англ|english please|en\b/iu.test(text)) return "en";
  const hasLatin = /[A-Za-z]/.test(text);
  const hasCyr = /[А-Яа-яЁёІіЇїЪъЫыЭэЙй]/.test(text);
  if (hasLatin && !hasCyr) return "en";
  const hasKazChars = /[әғқңөұүһі]/i.test(text);
  const hasKazHints = /(саламат|салем|рахмет|жаксы|бар\s*ма|сендер|сиздер|ия\b|жок\b|қалай)/i.test(text);
  if (hasKazChars || hasKazHints) return "kz";
  return null;
}

/* Валидации и парсеры (БЕЗ времени) */
function isNameLike(t) {
  if (!t) return false;
  if ((t.match(/\d/g) || []).length > 0) return false;
  const s = t.trim();
  if (s.length < 2 || s.length > 40) return false;
  const STOP = /^(здравствуй|здравствуйте|привет|добрый\s*(день|вечер|утро)|салют|hello|hi|сәлем|салем|саламат|да|ок|окей|today|tomorrow|сегодня|завтра|днём|днем|вечером|утром)$/i;
  if (STOP.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 3) return false;
  if (!/[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(s)) return false;
  if (!/(^|\s)[A-ZА-ЯӘҒҚҢӨҰҮҺІ]/.test(s)) return false;
  return true;
}
function phoneOk(t) { return ((t.match(/\d/g) || []).length) >= 6; }
function hasPhone(t) { return ((t.match(/\d/g) || []).length) >= 6; }
function pickPhone(t) {
  const m = t.match(/[\+\d][\d\-\s().]{5,}/g);
  if (!m) return null;
  return m
    .sort((a, b) => (b.match(/\d/g) || []).length - (a.match(/\d/g) || []).length)[0]
    .trim();
}
function _cleanTail(str) {
  return (str || "").replace(/[.,;!?…]+$/u, "").trim();
}

/* Имя из текста */
function extractName(text) {
  if (!text) return null;
  const beforePhone = text.split(/[\+\d][\d\-\s().]{5,}/)[0] || text;
  const parts = beforePhone.split(/[•,;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cand = parts[i].replace(/^я\s+/i, "");
    if (isNameLike(cand)) return cand;
    const tokens = cand.split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (isNameLike(last)) return last;
  }
  return null;
}

/* Темы */
const TOPIC_PATTERNS = [
  { re: /(масштаб|growth|scale|стратегия\s*развития|развитие бренда|позиционир(ование)?)/i, topic: "Масштабирование и стратегия развития" },
  { re: /(маркетинг(овый)?\s*анализ|анализ\s*рынка|целев(ая|ой)\s*аудитор|конкурент|ценообраз|target\s*market)/i, topic: "Маркетинговый анализ" },
  { re: /(финанс(овый)?\s*анализ|рентабельн|убытк|unit\s*economics|управленческ.*отчет)/i, topic: "Финансовый анализ" },
  { re: /(финанс(овый)?\s*план|финмодель|финанс(овая)?\s*модель|прогноз\s*(доход|расход|прибы)|движен(ие)?\s*денег|точка\s*безубыт|sensitivity)/i, topic: "Финансовый план" },
  { re: /(бизнес.?план|бизнесплан|bp\s*project|swot)/i, topic: "Бизнес-план" },
  { re: /(презентац(ия)?\s*для\s*инвест|invest(or)?\s*pitch|pitch\s*deck)/i, topic: "Презентация для инвестора" },
  { re: /(инвестиц|investment|invest|поиск\s*инвестор)/i, topic: "Привлечение инвестиций" },
  { re: /(мисси(я)?|vision|цели\s*и\s*задачи|стратеги(я)?\s*развития)/i, topic: "Стратегия развития" },
  { re: /(концепц(ия)?\s*работы|позиционирование|imidz|имиджев.*продукц|pr.?акц|медиа.?план|маркетинговый\s*план)/i, topic: "Концепция работы компании" },
  { re: /(бизнес.?процесс|карта\s*процесс|регламент|оптимизац|автоматизац|crm(?!\s*веден))/i, topic: "Бизнес-процессы/автоматизация" },
  { re: /(логотип|logo|фирменн(ый|ого)?\s*стил|бренд(инг)?|фирстил|brand\s*identity)/i, topic: "Логотип и фирменный стиль" },
  { re: /(брендбук|brand.?book|гайдлайн|guideline)/i, topic: "Брендбук" },
  { re: /(сайт|веб.?сайт|web\s*site|site|лендинг|landing|интернет[-\s]?страниц)/i, topic: "Разработка сайта" },
  { re: /(google.?ads|google|гугл(?:е)?|реклам[аы]\s*(?:в|на)\s*(?:google|гугл(?:е)?)|контекст(?:ная)?\s*реклам|контекст|кмс|контекстно-?медийн|gdn|cpc|ppc|2гис|2gis|olx|таргет)/i, topic: "Реклама в интернете" },
  { re: /(smm|инстаграм|instagram|ведение\s*профил|контент.?план|stories|reels|контент\s*маркетинг)/i, topic: "SMM ведение" },
  { re: /(отдел\s*продаж|sales\s*dept|скрипт|холодн(ые)?\s*звон|kpi|коммерческое\s*предложение)/i, topic: "Отдел продаж" },
  { re: /(crm|битрикс|bitrix|автоматизац|сквозн.*аналитик|chat.?bot|чат.?бот|ии.?бот|ai.?bot)/i, topic: "CRM, автоматизация, ИИ" },
  { re: /(франшиз|franchise|франчайзинг)/i, topic: "Франчайзинг" },
  { re: /(маркетолог|gtm|go.?to.?market|стратегия\s*продвижения)/i, topic: "Маркетинг/реклама" },
];
function guessTopics(userText, lastAssistant = "") {
  const u = (userText || "").toLowerCase();
  const a = (lastAssistant || "").toLowerCase();
  const found = new Set();
  for (const p of TOPIC_PATTERNS) if (p.re.test(u)) found.add(p.topic);
  for (const p of TOPIC_PATTERNS) if (p.re.test(a)) found.add(p.topic);
  return Array.from(found);
}
function buildRecentUserBundle(history, currentUserText, n = 4) {
  const recentUsers = history.filter((h) => h.role === "user").slice(-n).map((h) => h.content || "");
  return [...recentUsers, currentUserText].join(" • ");
}

/* Автонаполнение (БЕЗ времени) */
async function tryAutofillFrom(chatId, booking, userText) {
  const hist = await getHistory(chatId);
  const lastA = hist.filter((h) => h.role === "assistant").slice(-1)[0];
  const bundle = buildRecentUserBundle(hist, userText, 4);

  // NAME
  if (!booking.name || booking.name === "-") {
    const n = extractName(userText) || extractName(bundle);
    if (n && isNameLike(n)) booking.name = n;
  }
  // PHONE
  if (!booking.phone || booking.phone === "-") {
    const p = pickPhone(userText) || pickPhone(bundle);
    if (p && phoneOk(p)) booking.phone = p;
  }
  // TOPIC
  if (!booking.topic || booking.topic === "Консультация") {
    const fromMsg = guessTopics(userText, lastA?.content || "");
    const fromBundle = guessTopics(bundle, lastA?.content || "");
    const topicsArr = Array.from(new Set([...fromMsg, ...fromBundle]));
    if (topicsArr.length) booking.topic = topicsArr.join(", ");
  }
  return booking;
}

/* Проверки слотов */
function hasAllBookingFields(b) {
  return !!(b && b.topic && b.name && b.phone);
}
function decideNextStage(b) {
  if (!b.name || b.name === "-") return "name";
  if (!b.phone || b.phone === "-") return "phone";
  return null;
}

/* Локализация */
const L = {
  hi: {
    ru: "Здравствуйте! Я ИИ-ассистент компании START. Чем могу помочь?",
    kz: "Сәлеметсіз бе! Мен START компаниясының ЖИ-көмекшісімін. Қалай көмектесе аламын?",
    en: "Hello! I’m START’s AI assistant. How can I help?",
  },
  askNamePhone: {
    ru: "Готово оформить консультацию. Пришлите, пожалуйста, одним сообщением: ваше имя и телефон.",
    kz: "Кеңеске жазуды бастаймын. Өтінемін, бір хабарламада аты-жөніңізді және телефон нөміріңізді жіберіңіз.",
    en: "Great, I’ll arrange a consultation. Please send your name and phone in one message.",
  },
  askOnlyName: {
    ru: "Спасибо! И ещё, как к вам обращаться?",
    kz: "Рақмет! Тағы, сізге қалай жүгінейін?",
    en: "Thanks! And how should we address you?",
  },
  askOnlyPhone: {
    ru: "Спасибо! И ещё, укажите, пожалуйста, номер телефона.",
    kz: "Рақмет! Тағы, телефон нөміріңізді жіберіңізші.",
    en: "Thanks! And please share your phone number.",
  },
  booked: {
    ru: "Передаю информацию менеджеру. Он свяжется с вами для подтверждения. Спасибо!",
    kz: "Ақпаратты менеджерге беремін. Ол растау үшін сізбен хабарласады. Рақмет!",
    en: "I’m passing this to a manager. They’ll contact you to confirm. Thank you!",
  },
  resetDone: {
    ru: "История и запись очищены. Начнём заново.",
    kz: "Тарих пен жазылу тазартылды. Қайтадан бастайық.",
    en: "History and booking cleared. Let’s start over.",
  },
  langSet: (lang) =>
    ({
      ru: `Язык интерфейса установлен: ${lang}.`,
      kz: `Интерфейс тілі орнатылды: ${lang}.`,
      en: `Interface language set to: ${lang}.`,
    }[lang]),
  unknownLang: {
    ru: "Поддерживаемые языки: ru, kz, en. Пример: /lang ru",
    kz: "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz",
    en: "Supported languages: ru, kz, en. Example: /lang en",
  },
};

/* Реквизиты компании */
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
};

/* Системный промпт */
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана).
Твоя задача: коротко и по делу консультировать ТОЛЬКО по услугам из блока SERVICES_TEXT ниже, а в конце уместно предложить оформить консультацию при интересе пользователя.
Никогда не используй в приветствии слова «сегодня» / «today». Приветствие фиксированное и выдаётся вне модели.
Если спрашивают про цены/сроки — отвечай, что расчёт индивидуальный после консультации (не выдумывай суммы/сроки).
Адрес: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Время работы: ${COMPANY_INFO.worktime}.
Полный перечень услуг: см. блок SERVICES_TEXT (используй только эти услуги, ничего не придумывай сверх).
`;

/* Триггеры */
const confirmYesRe = /\b(да|ок|давай|оформи(ть)?|запиши|пусть\s*перезвонят|консультаци(я|ю)\s*нужн|yes|confirm|go ahead)\b/i;
const priceIntentRe = /(стоим|цен|сколько\s*стоит|price|cost|срок|когда\s*сдела(ете|ть))/i;
const topicIntentRe = /(сайт|веб.?сайт|лендинг|логотип|брендбук|google\s*ads|реклам|таргет|инстаграм|instagram|smm|бот|чат.?бот|crm|автоматизац|финанс|маркетинг|бизнес.?план|презентац|инвестиц|франшиз)/i;

/* Админ */
function getAdminId() {
  const raw = (process.env.ADMIN_CHAT_ID || "").replace(/^[\'"]|[\'"]$/g, "");
  return raw;
}
async function sendTG(chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    console.error("sendTG error", resp.status, body, "chat_id=", chatId);
  }
  return resp;
}

/* =========================
   ОСНОВНОЙ ХЕНДЛЕР
   ========================= */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (!headerSecret || headerSecret !== process.env.TELEGRAM_SECRET_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    const raw = await readBody(req);
    const update = raw ? JSON.parse(raw) : {};
    const message = update.message || update.edited_message || null;
    if (!message || !message.text) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    const chatId = message.chat.id;
    const userText = (message.text || "").trim();

    /* Команды */
    if (/^\/lang\b/i.test(userText)) {
      const parts = userText.split(/\s+/);
      const code = (parts[1] || "").toLowerCase();
      if (code === "ru" || code === "kz" || code === "en") {
        await redis.set(LANG_KEY(chatId), code, { ex: 60 * 60 * 24 * 30 });
        await sendTG(chatId, L.langSet(code));
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText) || "ru";
        await sendTG(chatId, L.unknownLang[current] || L.unknownLang.ru);
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    if (userText === "/reset") {
      await redis.del(`hist:${chatId}`);
      await redis.del(`book:${chatId}`);
      await clearContact(chatId);
      const langAfterReset = (await redis.get(LANG_KEY(chatId))) || "ru";
      await redis.set(LANG_KEY(chatId), langAfterReset, { ex: 60 * 60 * 24 * 30 });
      await sendTG(chatId, L.resetDone[langAfterReset] || L.resetDone.ru);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    const stored = await redis.get(LANG_KEY(chatId));
    const guess = confidentLangSwitch(userText);
    let lang = stored || guess || "ru";
    if (!stored || (guess && guess !== stored)) {
      lang = guess || "ru";
      await redis.set(LANG_KEY(chatId), lang, { ex: 60 * 60 * 24 * 30 });
    }

    if (userText === "/whoami") {
      await sendTG(chatId, `chat.id: ${chatId}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }
    if (userText === "/pingadmin") {
      const adminId = getAdminId();
      if (!adminId) {
        await sendTG(chatId, "ADMIN_CHAT_ID не задан");
      } else {
        await sendTG(adminId, "✅ Тест: сообщение администратору из бота");
        await sendTG(chatId, `Отправил тест админу: ${adminId}`);
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    /* Слоты */
    const booking = await getBooking(chatId);
    let handled = false;
    let preReply = null;

    // Попробуем дозаполнить (имя/тел/тему) оппортунистически
    await tryAutofillFrom(chatId, booking, userText);

    // 0) Если это первое сообщение — всегда отдаём своё приветствие, без модели
    const historyBefore = await getHistory(chatId);
    if (historyBefore.length === 0) {
      const hi = L.hi[lang] || L.hi.ru;
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", hi);
      await sendTG(chatId, hi);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // 1) Ожидание подтверждения на оффер
    if (!handled && booking.stage === "confirm" && confirmYesRe.test(userText)) {
      // подтвердил — спрашиваем ИМЯ+ТЕЛ одним сообщением, если чего-то нет
      if (!booking.name && !booking.phone) {
        preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
      } else if (!booking.name) {
        preReply = L.askOnlyName[lang] || L.askOnlyName.ru;
      } else if (!booking.phone) {
        preReply = L.askOnlyPhone[lang] || L.askOnlyPhone.ru;
      } else {
        // вдруг всё уже есть
        preReply = L.booked[lang] || L.booked.ru;
        const adminId = getAdminId();
        if (adminId) {
          const adminMsg =
            `🆕 Новая заявка чатбота:\n` +
            `Тема: ${booking.topic || "-"}\n` +
            `Имя: ${booking.name || "-"}\n` +
            `Телефон: ${booking.phone || "-"}\n` +
            `Источник: tg chat_id ${chatId}`;
          await sendTG(adminId, adminMsg);
        }
        await setContact(chatId, { name: booking.name, phone: booking.phone });
        await clearBooking(chatId);
      }
      handled = true;
    }

    // 2) ONE-SHOT: если пользователь прислал телефон в любом месте — можно сразу завершать (при наличии темы)
    if (!handled && hasPhone(userText)) {
      const phone = pickPhone(userText);
      if (phone) booking.phone = phone;
      // если темы нет — попытаемся вычислить по сообщению
      if (!booking.topic || booking.topic === "Консультация") {
        const hist = await getHistory(chatId);
        const lastA = hist.filter((h) => h.role === "assistant").slice(-1)[0];
        const all = Array.from(new Set([
          ...guessTopics(userText, lastA?.content || ""),
          ...guessTopics(buildRecentUserBundle(hist, userText, 4), lastA?.content || "")
        ]));
        if (all.length) booking.topic = all.join(", ");
      }
      // имя — если есть
      const n = extractName(userText);
      if (n && isNameLike(n)) booking.name = n;

      if (hasAllBookingFields(booking)) {
        preReply = L.booked[lang] || L.booked.ru;
        const adminId = getAdminId();
        if (adminId) {
          const adminMsg =
            `🆕 Новая заявка чатбота:\n` +
            `Тема: ${booking.topic}\n` +
            `Имя: ${booking.name}\n` +
            `Телефон: ${booking.phone}\n` +
            `Источник: tg chat_id ${chatId}`;
          await sendTG(adminId, adminMsg);
        }
        await setContact(chatId, { name: booking.name, phone: booking.phone });
        await clearBooking(chatId);
        handled = true;
      } else {
        // чего-то не хватает — спросим недостающие поля
        await setBooking(chatId, booking);
        const next = decideNextStage(booking);
        if (next === "name") preReply = L.askOnlyName[lang] || L.askOnlyName.ru;
        else if (next === "phone") preReply = L.askOnlyPhone[lang] || L.askOnlyPhone.ru;
        else preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
        handled = true;
      }
    }

    // 3) Слот name
    if (!handled && booking.stage === "name") {
      if (isNameLike(userText)) {
        booking.name = userText.trim();
        const next = decideNextStage(booking);
        if (!next && hasAllBookingFields(booking)) {
          preReply = L.booked[lang] || L.booked.ru;
          const adminId = getAdminId();
          if (adminId) {
            const adminMsg =
              `🆕 Новая заявка чатбота:\n` +
              `Тема: ${booking.topic || "-"}\n` +
              `Имя: ${booking.name || "-"}\n` +
              `Телефон: ${booking.phone || "-"}\n` +
              `Источник: tg chat_id ${chatId}`;
            await sendTG(adminId, adminMsg);
          }
          await setContact(chatId, { name: booking.name, phone: booking.phone });
          await clearBooking(chatId);
        } else {
          booking.stage = next || "phone";
          await setBooking(chatId, booking);
          preReply = L.askOnlyPhone[lang] || L.askOnlyPhone.ru;
        }
      } else {
        preReply = (lang === "kz")
          ? "Есім тек мәтін түрінде керек (цифрларсыз). Қалай жазылады?"
          : (lang === "en")
          ? "Please send just your name (letters only)."
          : "Пожалуйста, укажите только имя (без цифр). Как к вам обращаться?";
      }
      handled = true;
    }

    // 4) Слот phone
    if (!handled && booking.stage === "phone") {
      if (phoneOk(userText)) {
        booking.phone = pickPhone(userText) || userText;
        if (hasAllBookingFields(booking)) {
          preReply = L.booked[lang] || L.booked.ru;
          const adminId = getAdminId();
          if (adminId) {
            const adminMsg =
              `🆕 Новая заявка чатбота:\n` +
              `Тема: ${booking.topic || "-"}\n` +
              `Имя: ${booking.name || "-"}\n` +
              `Телефон: ${booking.phone || "-"}\n` +
              `Источник: tg chat_id ${chatId}`;
            await sendTG(adminId, adminMsg);
          }
          await setContact(chatId, { name: booking.name, phone: booking.phone });
          await clearBooking(chatId);
        } else {
          const next = decideNextStage(booking);
          booking.stage = next || "name";
          await setBooking(chatId, booking);
          preReply = (next === "name" ? (L.askOnlyName[lang] || L.askOnlyName.ru) : (L.askOnlyPhone[lang] || L.askOnlyPhone.ru));
        }
      } else {
        preReply = (lang === "kz")
          ? "Телефон нөмірін жіберіңіз (мүмкін +7 / бос орындармен)."
          : (lang === "en")
          ? "Please send a phone number (you can include +7 / spaces)."
          : "Пожалуйста, отправьте номер телефона (можно с +7 / пробелами).";
      }
      handled = true;
    }

    // 5) Если пользователь сам меняет тему и просит «записать» (явное согласие), но слотов нет
    if (!handled && confirmYesRe.test(userText)) {
      // есть ли тема?
      if (!booking.topic || booking.topic === "Консультация") {
        // попробуем вытащить из контекста
        await tryAutofillFrom(chatId, booking, userText);
        if (!booking.topic || booking.topic === "Консультация") {
          // если так и нет — пусть продолжим без темы (редко)
          booking.topic = "Консультация";
        }
      }
      // стартуем сбор имени/телефона одним сообщением
      booking.stage = decideNextStage(booking) || "name";
      await setBooking(chatId, booking);
      if (!booking.name && !booking.phone) preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
      else if (!booking.name) preReply = L.askOnlyName[lang] || L.askOnlyName.ru;
      else if (!booking.phone) preReply = L.askOnlyPhone[lang] || L.askOnlyPhone.ru;
      handled = true;
    }

    /* Если что-то из слотов уже обработали — отправим подготовленный ответ */
    if (handled && preReply) {
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    /* ===== Обычный ИИ-ответ + мягкий оффер ===== */
    const history = await getHistory(chatId);
    const languageLine = lang === "ru" ? "Отвечай на русском языке."
      : lang === "kz" ? "Жауапты қазақ тілінде бер."
      : "Reply in English.";

    // Сформируем подсказку модели: услуги берём из SERVICES_TEXT
    const systemPrompt = `${baseSystemPrompt}\n\n=== SERVICES_TEXT START ===\n${SERVICES_TEXT}\n=== SERVICES_TEXT END ===\n${languageLine}`;

    // Ответ модели
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userText },
    ];
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
    });
    let reply = completion.choices?.[0]?.message?.content?.slice(0, 3500);

    // Если вопрос про цену/срок — нормализуем ответ и в конце дадим оффер
    const foundTopics = guessTopics(userText, "");
    const offerTopic = foundTopics.length ? foundTopics.join(", ") : null;

    // Мягкий оффер: только если НЕ в процессе слотов и нет явного телефона в тексте
    if ((!booking.stage || booking.stage === null) && !hasPhone(userText)) {
      if (offerTopic) {
        const offerLine = lang === "ru"
          ? `\n\nЕсли хотите, оформлю консультацию по теме: ${offerTopic}. Напишите «да» — спрошу имя и телефон одним сообщением.`
          : lang === "kz"
          ? `\n\nҚаласаңыз, осы тақырып бойынша консультацияға жазып қоямын: ${offerTopic}. «Иә» деп жазыңыз — ат-жөніңіз бен телефонды бір хабарламада сұраймын.`
          : `\n\nIf you want, I can arrange a consultation on: ${offerTopic}. Reply “yes” — I’ll ask for your name and phone in one message.`;
        reply = (reply || "").trim() + offerLine;
        // отметим, что ожидаем подтверждение
        booking.stage = "confirm";
        booking.topic = booking.topic || offerTopic;
        await setBooking(chatId, booking);
      }
    }

    // Фолбэк, если модель вдруг молчит
    if (!reply || reply.trim().length < 3) {
      reply = (lang === "ru")
        ? "Готово. Чем ещё помочь?"
        : (lang === "kz") ? "Дайын. Тағы не көмектесейін?" : "All set. How else can I help?";
    }

    await pushHistory(chatId, "user", userText);
    await pushHistory(chatId, "assistant", reply);
    await sendTG(chatId, reply);

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}
