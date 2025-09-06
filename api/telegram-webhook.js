import OpenAI from "openai";
import { Redis } from "@upstash/redis";

// ==== Клиенты ====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ==== Константы / ключи ====
const HISTORY_LEN = 8;
const LANG_KEY = (chatId) => `lang:${chatId}`;
const LAST_LEAD_KEY = (chatId) => `lastlead:${chatId}`; // для анти-дубликатов

// ==== Справочник услуг (ЗАМЕНИ НА СВОЙ ПОЛНЫЙ СПИСОК) ====
const ALLOWED_TOPICS = [
  "Масштабирование и стратегия развития",
  "Маркетинговый анализ",
  "Финансовый анализ",
  "Финансовый план",
  "Бизнес-план",
  "Презентация для инвестора",
  "Привлечение инвестиций",
  "Стратегия развития",
  "Концепция работы компании",
  "Бизнес-процессы/автоматизация",
  "Логотип и фирменный стиль",
  "Брендбук",
  "Разработка сайта",
  "Реклама в интернете",
  "SMM ведение",
  "Отдел продаж",
  "CRM, автоматизация, ИИ",
  "Франчайзинг",
  "Маркетинг/реклама",
];
const ALLOWED_TOPICS_SET = new Set(ALLOWED_TOPICS);

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
async function getHistory(chatId) {
  const items = await redis.lrange(`hist:${chatId}`, -HISTORY_LEN, -1);
  return (items || []).map(safeParseItem).filter(Boolean);
}
async function pushHistory(chatId, role, content) {
  const entry = { role, content };
  await redis.rpush(`hist:${chatId}`, JSON.stringify(entry));
  await redis.ltrim(`hist:${chatId}`, -HISTORY_LEN, -1);
}

// ==== Booking (ТЕПЕРЬ БЕЗ ВРЕМЕНИ) ====
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

// ==== Contact cache (30 дней) ====
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

// ==== Язык ====
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

// ==== Валидации/парсинг полей ====
function isNameLike(t) {
  if (!t) return false;
  if ((t.match(/\d/g) || []).length > 0) return false;
  const s = t.trim();
  if (s.length < 2 || s.length > 40) return false;
  const STOP = /^(здравствуй|здравствуйте|привет|добрый\s*(день|вечер|утро)|салют|hello|hi|сәлем|салем|саламат|да|ок|окей|today|tomorrow|сегодня|завтра|днём|днем|вечером|утром|а\s*сайты\s*делаете\??|а\s*сколько\s*стоит\??)$/i;
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
  if (!t) return null;
  const m = t.match(/[\+\d][\d\-\s().]{5,}/g);
  if (!m) return null;
  return m.sort((a,b)=> (b.match(/\d/g)||[]).length - (a.match(/\d/g)||[]).length)[0].trim();
}
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

// ==== Темы (регекспы для "угадать" из текста) ====
const TOPIC_PATTERNS = [
  { re: /(масштаб|growth|scale|стратегия\s*развития|позиционир)/i, topic: "Масштабирование и стратегия развития" },
  { re: /(маркетинг(овый)?\s*анализ|анализ\s*рынка|целев(ая|ой)\s*аудитор|конкурент|ценообраз|target\s*market)/i, topic: "Маркетинговый анализ" },
  { re: /(финанс(овый)?\s*анализ|unit\s*economics|управленческ.*отчет|рентабель)/i, topic: "Финансовый анализ" },
  { re: /(финанс(овый)?\s*план|финмодель|финанс(овая)?\s*модель|прогноз\s*(доход|расход|прибы)|cash\s*flow|точка\s*безубыт)/i, topic: "Финансовый план" },
  { re: /(бизнес.?план|бизнесплан|swot)/i, topic: "Бизнес-план" },
  { re: /(презентац(ия)?\s*для\s*инвест|pitch\s*deck)/i, topic: "Презентация для инвестора" },
  { re: /(инвестиц|investment|invest|поиск\s*инвестор)/i, topic: "Привлечение инвестиций" },
  { re: /(концепц(ия)?\s*работы|позиционирование|имидж|pr.?акц|медиа.?план|маркетинговый\s*план)/i, topic: "Концепция работы компании" },
  { re: /(бизнес.?процесс|регламент|оптимизац|автоматизац|crm(?!\s*веден))/i, topic: "Бизнес-процессы/автоматизация" },
  { re: /(логотип|logo|фирменн(ый|ого)?\s*стил|бренд(инг)?)/i, topic: "Логотип и фирменный стиль" },
  { re: /(брендбук|brand.?book|гайдлайн|guideline)/i, topic: "Брендбук" },
  { re: /(сайт|веб.?сайт|web\s*site|site|лендинг|landing)/i, topic: "Разработка сайта" },
  { re: /(google.?ads|гугл|контекст|кмс|gdn|ppc|cpc|2gis|olx|таргет)/i, topic: "Реклама в интернете" },
  { re: /(smm|инстаграм|instagram|контент.?план|reels|stories)/i, topic: "SMM ведение" },
  { re: /(отдел\s*продаж|скрипт|холодн(ые)?\s*звон|kpi|коммерческое\s*предложение)/i, topic: "Отдел продаж" },
  { re: /(crm|битрикс|bitrix|сквозн.*аналитик|chat.?bot|чат.?бот|ии.?бот|ai.?bot)/i, topic: "CRM, автоматизация, ИИ" },
  { re: /(франшиз|franchise|франчайзинг)/i, topic: "Франшизинг" },
  { re: /(маркетолог|gtm|go.?to.?market|стратегия\s*продвижения|реклама)/i, topic: "Маркетинг/реклама" },
];
function guessTopics(text) {
  const u = (text || "").toLowerCase();
  const found = new Set();
  for (const p of TOPIC_PATTERNS) if (p.re.test(u) && ALLOWED_TOPICS_SET.has(p.topic)) found.add(p.topic);
  return Array.from(found);
}
function buildRecentUserBundle(history, currentUserText, n = 4) {
  const recentUsers = history.filter(h => h.role === "user").slice(-n).map(h => h.content || "");
  return [...recentUsers, currentUserText].join(" • ");
}

// ==== Локализация ====
const L = {
  hi: {
    ru: "Здравствуйте! Я ИИ-ассистент компании START. Чем могу помочь?",
    kz: "Сәлеметсіз бе! Мен START компаниясының ЖИ-көмекшісімін. Қалай көмектесе аламын?",
    en: "Hello! I’m START’s AI assistant. How can I help?",
  },
  askContacts: {
    ru: "Чтобы оформить консультацию, пришлите одним сообщением: Имя и телефон (можно с +7 / пробелами).",
    kz: "Кеңес жазылу үшін, бір хабарламада: Атыңыз және телефон нөміріңізді жіберіңіз (+7 / бос орындар болуы мүмкін).",
    en: "To book a consultation, please send in one message: your name and phone number (+7 and spaces are OK).",
  },
  booked: {
    ru: "Спасибо! Передаю информацию менеджеру. Он свяжется с вами для подтверждения.",
    kz: "Рақмет! Ақпаратты менеджерге беремін. Ол растау үшін сізбен хабарласады.",
    en: "Thanks! I’ll pass this to a manager who will contact you to confirm.",
  },
  needPhone: {
    ru: "Пожалуйста, отправьте номер телефона (можно с +7 / пробелами).",
    kz: "Телефон нөмірін жіберіңіз (мүмкін +7 / бос орындармен).",
    en: "Please send a phone number (+7 and spaces are OK).",
  },
  needName: {
    ru: "Пожалуйста, укажите имя (буквы, без цифр).",
    kz: "Есіміңізді жазыңыз (әріптер, цифрсыз).",
    en: "Please send your name (letters only).",
  },
};

// ==== Company info (для промпта) ====
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
};

// ==== Системный промпт для ответов ====
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана). Сайт: https://strateg.kz/.
Стиль: деловой, дружелюбный, краткий (1–8 предложений).
Важно:
- В приветствии НЕ используй слова вроде "сегодня"/"today".
- Сначала консультируй по сути вопроса. Не навязывай запись на консультацию, если пользователь не выразил согласие.
- Предлагай консультацию мягко и только когда это логично.
- Если пользователь явно согласился на консультацию — попроси одним сообщением имя и телефон (без вопроса про время).
- Адрес компании: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Время работы: ${COMPANY_INFO.worktime}.
- Для описания услуг используй список SERVICES_TEXT.
- Для классификации темы заявки используй только названия из ALLOWED_TOPICS.
`;

// ==== LLM-экстракция JSON ====
async function extractWithLLM(history, userText, lang) {
  const guidance = `
Верни строго JSON с ключами:
- intent: "consult" | "question" | "other"
- consent: boolean  // пользователь явно согласен оформить консультацию (давай, записывай, нужен менеджер, оформите и т.п.)
- topics: string[]  // только явно упомянутые услуги из списка allowed_topics, не придумывай
- name: string | null  // только если явно указал; иначе null
- phone: string | null // только если явно указал; иначе null

Правила:
- Не добавляй ничего кроме JSON.
- Не выдумывай значения: если не уверенно — ставь null/[]/false.
- intent="consult" если пользователь просит записать/оформить консультацию/связаться/нужен менеджер/перезвонить и т.п.
- Если он просто задаёт вопросы — intent="question".
`.trim();

  const messages = [
    { role: "system", content: guidance },
    { role: "system", content: `allowed_topics:\n${ALLOWED_TOPICS.map(t=>`- ${t}`).join("\n")}` },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0,
    });
    const raw = resp.choices?.[0]?.message?.content || "{}";
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const cut = jsonStart >= 0 && jsonEnd >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : "{}";
    const parsed = JSON.parse(cut);
    // Санити
    return {
      intent: ["consult", "question", "other"].includes(parsed.intent) ? parsed.intent : "other",
      consent: !!parsed.consent,
      topics: Array.isArray(parsed.topics) ? parsed.topics.filter(t => ALLOWED_TOPICS_SET.has(t)) : [],
      name: typeof parsed.name === "string" ? parsed.name : null,
      phone: typeof parsed.phone === "string" ? parsed.phone : null,
    };
  } catch (e) {
    console.error("LLM extract error:", e);
    return { intent: "other", consent: false, topics: [], name: null, phone: null };
  }
}

// ==== Вспомогалки для лидов ====
function hasAllBookingFields(b) {
  return !!(b && b.topic && b.name && b.phone);
}
function decideNextStage(b) {
  if (!b.name)  return "namephone";
  if (!b.phone) return "namephone";
  return null;
}
async function sendLead(adminId, { topic, name, phone }, chatId) {
  const msg =
    `🆕 Новая заявка чатбота:\n` +
    `Тема: ${topic || "-"}\n` +
    `Имя: ${name || "-"}\n` +
    `Телефон: ${phone || "-"}\n` +
    `Источник: tg chat_id ${chatId}`;
  return await sendTG(adminId, msg);
}
function mergeTopics(...arrs) {
  const set = new Set();
  for (const arr of arrs) (arr || []).forEach(t => { if (ALLOWED_TOPICS_SET.has(t)) set.add(t); });
  return Array.from(set);
}

// ==== Telegram ====
function getAdminId() {
  const raw = (process.env.ADMIN_CHAT_ID || "").replace(/^[\'"]|[\'"]$/g, "");
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

// ==== Основной обработчик ====
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

    // ===== Команды =====
    if (/^\/lang\b/i.test(userText)) {
      const parts = userText.split(/\s+/);
      const code = (parts[1] || "").toLowerCase();
      if (code === "ru" || code === "kz" || code === "en") {
        await redis.set(LANG_KEY(chatId), code, { ex: 60 * 60 * 24 * 30 });
        const msg = { ru:"Язык интерфейса установлен: ru.", kz:"Интерфейс тілі орнатылды: kz.", en:"Interface language set to: en." }[code];
        await sendTG(chatId, msg);
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText) || "ru";
        const unknown = {
          ru: "Поддерживаемые языки: ru, kz, en. Пример: /lang ru",
          kz: "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz",
          en: "Supported languages: ru, kz, en. Example: /lang en",
        }[current] || "Supported languages: ru, kz, en.";
        await sendTG(chatId, unknown);
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
      const msg = { ru:"История и запись очищены. Начнём заново.", kz:"Тарих пен жазылу тазартылды. Қайтадан бастайық.", en:"History and booking cleared. Let’s start over." }[langAfterReset];
      await sendTG(chatId, msg);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
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

    // ===== Язык =====
    const stored = await redis.get(LANG_KEY(chatId));
    const guess = confidentLangSwitch(userText);
    let lang = (stored || guess || detectLang(userText) || "ru");
    if (!stored || (guess && guess !== stored)) {
      await redis.set(LANG_KEY(chatId), lang, { ex: 60 * 60 * 24 * 30 });
    }

    // ===== Приветствие: фикс (не даём модели шанс на "сегодня") =====
    const history = await getHistory(chatId);
    if (history.length === 0 && !/^\/(lang|reset|whoami|pingadmin)\b/i.test(userText)) {
      const hi = L.hi[lang] || L.hi.ru;
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", hi);
      await sendTG(chatId, hi);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Слоты (без времени) =====
    const booking = await getBooking(chatId);
    let handled = false;
    let preReply = null;

    // LLM-экстракция + локальные эвристики
    const hist = await getHistory(chatId);
    const extraction = await extractWithLLM(hist, userText, lang);

    // Консенсус по темам: из LLM + эвристика последних сообщений
    const bundle = buildRecentUserBundle(hist, userText, 4);
    const topicsFromGuess = guessTopics(userText).concat(guessTopics(bundle));
    let mergedTopics = mergeTopics(extraction.topics, topicsFromGuess);
    if (mergedTopics.length === 0 && booking.topic) mergedTopics = [booking.topic];

    // Контакт из кэша
    const knownContact = await getContact(chatId);

    // Явное согласие?
    const consentRegex = /(запиш|оформ|давай|свяж|нужен\s*менеджер|перезвон|консультац|booking|consult)/i;
    const consent = extraction.consent || consentRegex.test(userText);

    // Попробуем собрать лид «one-shot» из текущего сообщения
    let nameHit = extraction.name || extractName(userText);
    if (nameHit && !isNameLike(nameHit)) nameHit = null;
    let phoneHit = extraction.phone || pickPhone(userText);
    if (phoneHit && !phoneOk(phoneHit)) phoneHit = null;

    // Автозаполнение booking
    if (!booking.topic && mergedTopics.length) booking.topic = mergedTopics.join(", ");
    if (!booking.name && nameHit)  booking.name  = nameHit;
    if (!booking.phone && phoneHit) booking.phone = phoneHit;

    // REUSE CONTACT: если контакты уже известны, не просим снова
    const effectiveName  = booking.name  || knownContact?.name  || null;
    const effectivePhone = booking.phone || knownContact?.phone || null;

    // Анти-дубликат по последнему лиду (по топикам)
    const lastLeadRaw = await redis.get(LAST_LEAD_KEY(chatId));
    const lastLead = lastLeadRaw ? safeParseItem(lastLeadRaw) : null;
    const lastTopics = new Set((lastLead?.topics || []));
    const newOnlyTopics = mergedTopics.filter(t => !lastTopics.has(t));

    // === Решение: консультировать или собирать лид ===
    if (consent || phoneHit) {
      // Пользователь согласен / дал телефон → оформляем
      const topicsForLead = (newOnlyTopics.length ? newOnlyTopics : mergedTopics).join(", ") || booking.topic || "Консультация";

      // Если нет имени/телефона — попросим ОДНИМ сообщением
      if (!effectiveName || !effectivePhone) {
        preReply = L.askContacts[lang] || L.askContacts.ru;
      } else {
        // Отправляем лид
        const adminId = getAdminId();
        if (adminId) {
          await sendLead(adminId, {
            topic: topicsForLead,
            name: effectiveName,
            phone: effectivePhone,
          }, chatId);
        }
        await setContact(chatId, { name: effectiveName, phone: effectivePhone });
        await redis.set(LAST_LEAD_KEY(chatId), JSON.stringify({ topics: mergedTopics }), { ex: 60 * 60 * 6 });
        await clearBooking(chatId);
        preReply = L.booked[lang] || L.booked.ru;
      }
      handled = true;
    }

    // === Если не оформляем — обычная консультация ===
    if (!handled) {
      // короткая консультация по вопросу
      const languageLine = lang === "ru" ? "Отвечай на русском языке."
        : lang === "kz" ? "Жауапты қазақ тілінде бер."
        : "Reply in English.";

      const systemPrompt = baseSystemPrompt + "\n" + languageLine;

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

      let reply = completion.choices?.[0]?.message?.content?.slice(0, 3500) || "";
      if (!reply || reply.trim().length < 3) {
        reply = {
          ru: "Могу помочь консультацией по нашим услугам. Чем именно вам помочь?",
          kz: "Біздің қызметтер бойынша кеңес бере аламын. Нақты қалай көмектесейін?",
          en: "I can help with a consultation on our services. What specifically would you like to discuss?",
        }[lang];
      }

      // Мягкий оффер в конце (без навязывания)
      const softOffer = {
        ru: "\n\nЕсли хотите оформить консультацию, пришлите одним сообщением: Имя и телефон.",
        kz: "\n\nЕгер консультация керек болса, бір хабарламада: Атыңыз бен телефон нөміріңізді жіберіңіз.",
        en: "\n\nIf you’d like to book a consultation, please send your name and phone in one message.",
      }[lang];
      reply = reply + softOffer;

      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", reply);
      await sendTG(chatId, reply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // === Отправка сервисных реплик (askContacts/booked) ===
    if (handled && preReply) {
      await setBooking(chatId, booking); // на случай, если чего-то подхватили
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // Фоллбек (не должен сработать)
    await pushHistory(chatId, "user", userText);
    await pushHistory(chatId, "assistant", "Принял, спасибо!");
    await sendTG(chatId, "Принял, спасибо!");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}
