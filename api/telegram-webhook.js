import OpenAI from "openai";
import { Redis } from "@upstash/redis";

// ==== Инициализация клиентов ====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ==== Константы ====
const HISTORY_LEN = 8; // последние 8 сообщений
const LANG_KEY = (chatId) => `lang:${chatId}`;

// ==== Утилита чтения "сырого" тела запроса (нужно для serverless) ====
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ==== Безопасный парсер значений из Redis ====
function safeParseItem(item) {
  if (item == null) return null;
  if (typeof item === "object") return item;
  if (typeof item === "string") {
    try { return JSON.parse(item); } catch { return null; }
  }
  return null;
}

// ==== История диалога ====
async function getHistory(chatId) {
  const items = await redis.lrange(`hist:${chatId}`, -HISTORY_LEN, -1);
  return (items || []).map(safeParseItem).filter(Boolean);
}
async function pushHistory(chatId, role, content) {
  const entry = { role, content };
  await redis.rpush(`hist:${chatId}`, JSON.stringify(entry));
  await redis.ltrim(`hist:${chatId}`, -HISTORY_LEN, -1);
}

// ==== Машина слотов записи ====
async function getBooking(chatId) {
  const val = await redis.get(`book:${chatId}`);
  if (!val) {
    return { stage: null, topic: null, name: null, phone: null, last_topic_sent: null };
  }
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch {
    return { stage: null, topic: null, name: null, phone: null, last_topic_sent: null };
  }
}
async function setBooking(chatId, data) {
  await redis.set(`book:${chatId}`, JSON.stringify(data), { ex: 60 * 60 * 24 });
}
async function clearBooking(chatId) {
  await redis.del(`book:${chatId}`);
}

// ==== Профиль контакта (кэшируем имя/телефон на 30 дней) ====
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

// ==== Валидаторы/хелперы ====
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
  return m.sort((a,b)=> (b.match(/\d/g)||[]).length - (a.match(/\d/g)||[]).length)[0].trim();
}
function _cleanTail(str) {
  return (str || "").replace(/[.,;!?…]+$/u, "").trim();
}

// ==== Извлечение имени ====
function extractName(text) {
  if (!text) return null;
  const beforePhone = text.split(/[\+\d][\d\-\s().]{5,}/)[0] || text;
  const parts = beforePhone.split(/[•,;\n]+/).map(s => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cand = parts[i].replace(/^я\s+/i, "");
    if (isNameLike(cand)) return cand;
    const tokens = cand.split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (isNameLike(last)) return last;
  }
  return null;
}

function buildRecentUserBundle(history, currentUserText, n = 6) {
  const recentUsers = history.filter(h => h.role === "user").slice(-n).map(h => h.content || "");
  return [...recentUsers, currentUserText].join(" • ");
}

// ==== Блок услуг (показываем клиенту) ====
// ВСТАВЬ СВОЙ ПОЛНЫЙ СПИСОК
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

// Короткие названия тем (для заявок)
const ALLOWED_TOPICS = [
  "Масштабирование идеи",
  "Маркетинговый анализ",
  "Финансовый анализ",
  "Финансовый план",
  "Бизнес-план",
  "Презентация для инвестора",
  "Привлечение инвестиций",
  "Стратегия развития",
  "Концепция работы",
  "Бизнес-процессы",
  "Логотип и стиль",
  "Брендбук",
  "Разработка сайта",
  "Реклама в интернете",
  "SMM ведение",
  "Отдел продаж",
  "CRM, автоматизация, ИИ",
  "Франчайзинг",
];

// Регэкспы для детекции тем по сообщениям
const TOPIC_PATTERNS = [
  { re: /(масштаб|growth|scale|стратегия\s*развития|позиционир)/i, topic: "Масштабирование идеи" },
  { re: /(маркетинг(овый)?\s*анализ|анализ\s*рынка|целев(ая|ой)\s*аудитор|конкурент|ценообраз)/i, topic: "Маркетинговый анализ" },
  { re: /(финанс(овый)?\s*анализ|рентабельн|убытк|unit\s*economics|управленческ.*отчет)/i, topic: "Финансовый анализ" },
  { re: /(финанс(овый)?\s*план|финмодель|финанс(овая)?\s*модель|прогноз\s*(доход|расход|прибы)|движен(ие)?\s*денег|точка\s*безубыт)/i, topic: "Финансовый план" },
  { re: /(бизнес.?план|бизнесплан|bp\s*project|swot)/i, topic: "Бизнес-план" },
  { re: /(презентац(ия)?\s*для\s*инвест|invest(or)?\s*pitch|pitch\s*deck)/i, topic: "Презентация для инвестора" },
  { re: /(инвестиц|investment|invest|поиск\s*инвестор)/i, topic: "Привлечение инвестиций" },
  { re: /(мисси(я)?|vision|цели\s*и\s*задачи|стратеги(я)?\s*развития)/i, topic: "Стратегия развития" },
  { re: /(концепц(ия)?\s*работы|позиционирование|имидж|pr.?акц|медиа.?план|маркетинг(овый)?\s*план)/i, topic: "Концепция работы" },
  { re: /(бизнес.?процесс|карта\s*процесс|регламент|оптимизац|автоматизац|crm(?!\s*веден))/i, topic: "Бизнес-процессы" },
  { re: /(логотип|logo|фирменн(ый|ого)?\s*стил|бренд(инг)?|brand\s*identity)/i, topic: "Логотип и стиль" },
  { re: /(брендбук|brand.?book|гайдлайн|guideline)/i, topic: "Брендбук" },
  { re: /(сайт|веб.?сайт|web\s*site|site|лендинг|landing|интернет[-\s]?страниц)/i, topic: "Разработка сайта" },
  { re: /(google.?ads|google|гугл|контекст|кмс|gdn|cpc|ppc|2гис|2gis|olx|таргет|реклам[аы]\s*(в|на)\s*(google|гугл|интернет))/i, topic: "Реклама в интернете" },
  { re: /(smm|инстаграм|instagram|ведение\s*профил|контент.?план|stories|reels|контент\s*маркетинг)/i, topic: "SMM ведение" },
  { re: /(отдел\s*продаж|sales\s*dept|скрипт|холодн(ые)?\s*звон|kpi|коммерческое\s*предложение)/i, topic: "Отдел продаж" },
  { re: /(crm|битрикс|bitrix|автоматизац|сквозн.*аналитик|chat.?bot|чат.?бот|ии.?бот|ai.?bot)/i, topic: "CRM, автоматизация, ИИ" },
  { re: /(франшиз|franchise|франчайзинг)/i, topic: "Франчайзинг" },
];

function guessTopicsFromText(text) {
  const u = (text || "").toLowerCase();
  const found = new Set();
  for (const p of TOPIC_PATTERNS) if (p.re.test(u)) found.add(p.topic);
  return Array.from(found);
}
function pickFirstAllowed(topics) {
  for (const t of topics) if (ALLOWED_TOPICS.includes(t)) return t;
  return null;
}
function inferTopicFromHistory(history, currentUserText = "") {
  const bundle = buildRecentUserBundle(history, currentUserText, 6);
  const topics = guessTopicsFromText(bundle);
  return pickFirstAllowed(topics) || null;
}
function hasAllBookingFields(b) {
  return !!(b && b.topic && b.name && b.phone);
}

// Явное согласие на консультацию (шире)
const CONSENT_RE =
/(хочу(?!\s*отказ)|давай(те)?|по(?:й|ш)ли|запиши(те)?|оформ(им|ить)\s*(?:консульт|встречу)|нужна\s*консультац|консультант|оператор|менеджер|человек|переключи(те)|позови(те)|можно\s*консультац|организуем\s*консультац|да,\s*хочу)/i;

// ==== Локализация служебных фраз ====
const L = {
  hi: {
    ru: "Здравствуйте! Чем могу помочь?",
    kz: "Сәлеметсіз бе! Қалай көмек бере аламын?",
    en: "Hello! How can I help?"
  },
  askNamePhone: {
    ru: "Отлично. Пожалуйста, укажите ваше имя и телефон.",
    kz: "Тамаша. Атыңызды және телефон нөміріңізді жазыңыз.",
    en: "Great. Please share your name and phone number."
  },
  booked: {
    ru: "Передаю информацию менеджеру. Он свяжется с вами для подтверждения.",
    kz: "Ақпаратты менеджерге беремін. Ол растау үшін сізбен хабарласады.",
    en: "I’ll pass this to a manager, who will contact you to confirm."
  },
  needPhone: {
    ru: "Пожалуйста, укажите телефон.",
    kz: "Телефон нөмірін жазыңыз.",
    en: "Please share your phone number."
  },
  needName: {
    ru: "Как к вам обращаться? Пожалуйста, укажите имя.",
    kz: "Қалай жүгінейін? Атыңызды жазыңыз.",
    en: "How should we address you? Please share your name."
  },
  resetDone: {
    ru: "История и запись очищены. Начнём заново.",
    kz: "Тарих пен жазылу тазартылды. Қайтадан бастайық.",
    en: "History and booking cleared. Let’s start over."
  }
};

// ==== Адрес/телефон/график — фикс ====
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
};

// ==== Базовый системный промпт ====
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана). Сайт: https://strateg.kz/.
Стиль: деловой, дружелюбный, краткий (1–8 предложений).

Правила ответа:
- В приветствии НЕ используй слова вроде "сегодня"/"today".
- Сначала консультируй по сути вопроса. Консультацию предлагай мягко и по делу.
- Если пользователь ЯВНО согласился на консультацию — попроси ИМЯ и ТЕЛЕФОН (как угодно, не требуй формат).
- Не упоминай и не спрашивай время. Время менеджер уточнит сам.
- Не используй фразы вида "пришлите одним сообщением".
- Для перечисления и описания услуг опирайся СТРОГО на список ниже (SERVICES_TEXT). Если услуга в списке — отвечай, что мы этим занимаемся.
- Для темы заявки используй только краткие названия из ALLOWED_TOPICS.
- Если заявка по теме уже отправлена, новые заявки создавай только при ЯВНОМ согласии и только если тема НОВАЯ.

=== SERVICES_TEXT (список услуг для ответов пользователю) ===
${SERVICES_TEXT}

=== ALLOWED_TOPICS (краткие названия тем для заявок) ===
${ALLOWED_TOPICS.map(s => "- " + s).join("\n")}
`;

// ==== Основной обработчик вебхука ====
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

    // ===== Язык: авто-детект + ручная команда =====
    if (/^\/lang\b/i.test(userText)) {
      const parts = userText.split(/\s+/);
      const code = (parts[1] || "").toLowerCase();
      if (code === "ru" || code === "kz" || code === "en") {
        await redis.set(LANG_KEY(chatId), code, { ex: 60 * 60 * 24 * 30 });
        const msg = { ru: "Язык интерфейса установлен: ru.", kz: "Интерфейс тілі орнатылды: kz.", en: "Interface language set to: en." }[code];
        await sendTG(chatId, msg);
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true }));
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || "ru";
        const unknownLang = {
          ru: "Поддерживаемые языки: ru, kz, en. Пример: /lang ru",
          kz: "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz",
          en: "Supported languages: ru, kz, en. Example: /lang en"
        }[current] || "Supported languages: ru, kz, en.";
        await sendTG(chatId, unknownLang);
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true }));
      }
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
    let lang = (stored || guess || "ru");
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

    // ===== Слоты записи =====
    const booking = await getBooking(chatId) || { stage: null, topic: null, name: null, phone: null, last_topic_sent: null };
    let handled = false;
    let preReply = null;

    // 0) Согласие на консультацию → ставим stage=collect, тему берём из истории если надо
    if (!booking.stage && CONSENT_RE.test(userText)) {
      const history = await getHistory(chatId);
      const chosenFromNow = pickFirstAllowed(guessTopicsFromText(userText));
      booking.topic = chosenFromNow || inferTopicFromHistory(history, userText) || booking.topic || null;
      booking.stage = "collect";
      await setBooking(chatId, booking);
      preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
      handled = true;
    }

    // 1) Если пользователь прислал имя и/или телефон сразу (без явного согласия) — не форсим лид,
    // но если ранее было согласие (stage=collect), то используем это.
    if (!handled && (hasPhone(userText) || /меня зовут|я\s*—|я\s*-/i.test(userText) || isNameLike(userText))) {
      const history = await getHistory(chatId);
      const bundle = buildRecentUserBundle(history, userText, 6);
      const name = extractName(userText) || extractName(bundle);
      const phone = pickPhone(userText) || pickPhone(bundle);
      // Если уже в режиме сбора — подставляем данные
      if (booking.stage === "collect") {
        if (name && isNameLike(name)) booking.name = booking.name || name;
        if (phone && phoneOk(phone))  booking.phone = booking.phone || phone;
        // тема как фоллбэк
        if (!booking.topic) booking.topic = inferTopicFromHistory(history, userText) || "Консультация";

        if (hasAllBookingFields(booking)) {
          await sendLeadAndReset(chatId, lang, booking);
          handled = true;
        } else {
          if (!booking.name && !booking.phone) preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
          else if (!booking.name) preReply = L.needName[lang] || L.needName.ru;
          else if (!booking.phone) preReply = L.needPhone[lang] || L.needPhone.ru;
          await setBooking(chatId, booking);
          handled = true;
        }
      }
    }

    // 2) Повторные темы после уже отправленной заявки:
    if (!handled && CONSENT_RE.test(userText)) {
      const history = await getHistory(chatId);
      const chosen = pickFirstAllowed([
        ...guessTopicsFromText(userText),
        ...guessTopicsFromText(buildRecentUserBundle(history, userText, 6))
      ]);
      const distinctNew = chosen && chosen !== booking.last_topic_sent;
      if (distinctNew) {
        booking.topic = chosen;
        booking.name = null; booking.phone = null;
        booking.stage = "collect";
        await setBooking(chatId, booking);
        preReply = L.askNamePhone[lang] || L.askNamePhone.ru;
        handled = true;
      }
    }

    if (handled && preReply) {
      preReply = sanitizeAssistant(preReply);
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Обычный ИИ-ответ =====
    const history = await getHistory(chatId);
    const languageLine = lang === "ru" ? "Отвечай на русском языке."
      : lang === "kz" ? "Жауапты қазақ тілінде бер."
      : "Reply in English.";

    const systemPrompt = baseSystemPrompt + "\n" + languageLine;
    const maybeHi = history.length === 0 ? (L.hi[lang] || L.hi.ru) : null;

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

    let reply =
      completion.choices?.[0]?.message?.content?.slice(0, 3500) ||
      (maybeHi || "Готово. Какой следующий вопрос?");

    reply = sanitizeAssistant(reply);

    if (history.length === 0 && (!reply || reply.trim().length < 3)) {
      reply = maybeHi;
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

// ==== Хелперы для логики ====
function sanitizeAssistant(text) {
  if (!text) return text;
  let t = text;
  t = t.replace(/одним сообщением[^.!\n]*[.!\n]?/gi, "").trim();
  t = t.replace(/Если хотите оформить консультацию[^.!\n]*[.!\n]?/gi, "").trim();
  t = t.replace(/Как я могу помочь вам сегодня\?/gi, "Чем могу помочь?").trim();
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

async function sendLeadAndReset(chatId, lang, booking) {
  // Фоллбэк темы из истории, если вдруг пусто
  const history = await getHistory(chatId);
  if (!booking.topic) booking.topic = inferTopicFromHistory(history) || "Консультация";

  const adminId = getAdminId();
  if (adminId) {
    const adminMsg =
      `🆕 Новая заявка чатбота:\n` +
      `Тема: ${booking.topic || "Консультация"}\n` +
      `Имя: ${booking.name || "-"}\n` +
      `Телефон: ${booking.phone || "-"}\n` +
      `Источник: tg chat_id ${chatId}`;
    await sendTG(adminId, adminMsg);
  } else {
    console.error("ADMIN_CHAT_ID is not set or empty");
  }

  const preReply = L.booked[lang] || L.booked.ru;
  await setContact(chatId, { name: booking.name, phone: booking.phone });
  await setBooking(chatId, { stage: null, topic: null, name: null, phone: null, last_topic_sent: booking.topic || "Консультация" });

  await pushHistory(chatId, "assistant", preReply);
  await sendTG(chatId, preReply);
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

function getAdminId() {
  const raw = (process.env.ADMIN_CHAT_ID || "").trim().replace(/^[\'"]|[\'"]$/g, "");
  return raw;
}
async function sendTG(chatId, text) {
  const resp = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  if (!resp.ok) {
    const body = await resp.text();
    console.error("sendTG error", resp.status, body, "chat_id=", chatId);
  }
  return resp;
}
