import OpenAI from "openai";
import { Redis } from "@upstash/redis";

// ==== Инициализация клиентов ====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ==== Константы/ключи ====
const HISTORY_LEN = 8;
const LANG_KEY = (chatId) => `lang:${chatId}`;
const BOOK_KEY = (chatId) => `book:${chatId}`;
const CONTACT_KEY = (chatId) => `contact:${chatId}`;
const LAST_TOPIC_SENT_KEY = (chatId) => `last_topic_sent:${chatId}`;
const LAST_LEAD_HASH_KEY = (chatId, hash) => `lead:${chatId}:${hash}`; // TTL анти-дубль
const LAST_OFFER_KEY = (chatId) => `last_offer:${chatId}`; // последнее предложение консультации (ts+topic)
const OFFERED_TOPIC_KEY = (chatId, slug) => `offered:${chatId}:${slug}`; // факт, что по теме уже предлагали (1 сутки)

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
`.trim();

// ==== ALLOWED_TOPICS — нормализованные темы ====
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

// ==== Вспомогалки Redis ====
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

async function getBooking(chatId) {
  const val = await redis.get(BOOK_KEY(chatId));
  if (!val) return { stage: null, topic: null, name: null, phone: null };
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch {
    return { stage: null, topic: null, name: null, phone: null };
  }
}
async function setBooking(chatId, data) {
  await redis.set(BOOK_KEY(chatId), JSON.stringify(data), { ex: 60 * 60 * 24 });
}
async function clearBooking(chatId) {
  await redis.del(BOOK_KEY(chatId));
}

async function getContact(chatId) {
  const v = await redis.get(CONTACT_KEY(chatId));
  if (!v) return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}
async function setContact(chatId, { name, phone }) {
  const payload = { name: name || undefined, phone: phone || undefined };
  await redis.set(CONTACT_KEY(chatId), JSON.stringify(payload), { ex: 60 * 60 * 24 * 30 });
}

async function setLastOffer(chatId, topic = null) {
  const payload = { ts: Date.now(), topic: topic || null };
  await redis.set(LAST_OFFER_KEY(chatId), JSON.stringify(payload), { ex: 60 * 30 }); // 30 мин
}
async function getLastOffer(chatId) {
  const v = await redis.get(LAST_OFFER_KEY(chatId));
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

async function setLastTopicSent(chatId, topic) {
  await redis.set(LAST_TOPIC_SENT_KEY(chatId), topic, { ex: 60 * 60 * 24 });
}
async function getLastTopicSent(chatId) {
  return (await redis.get(LAST_TOPIC_SENT_KEY(chatId))) || null;
}

async function markLeadHash(chatId, hash) {
  await redis.set(LAST_LEAD_HASH_KEY(chatId, hash), "1", { ex: 60 * 60 * 2 }); // 2 часа
}
async function isLeadHashSeen(chatId, hash) {
  return !!(await redis.get(LAST_LEAD_HASH_KEY(chatId, hash)));
}

async function markTopicOffered(chatId, topic) {
  const slug = slugify(topic);
  await redis.set(OFFERED_TOPIC_KEY(chatId, slug), "1", { ex: 60 * 60 * 24 }); // 24 часа
}
async function wasTopicOffered(chatId, topic) {
  const slug = slugify(topic);
  return !!(await redis.get(OFFERED_TOPIC_KEY(chatId, slug)));
}

// ==== Утилита чтения тела запроса ====
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
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

// ==== Валидаторы/хелперы ====
function isNameLike(t) {
  if (!t) return false;
  if ((t.match(/\d/g) || []).length > 0) return false;
  const s = t.trim();
  if (s.length < 2 || s.length > 40) return false;
  const STOP = /^(здравствуй|здравствуйте|привет|добрый\s*(день|вечер|утро)|салют|hello|hi|сәлем|салем|саламат|да|ок|окей)$/i;
  if (STOP.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 3) return false;
  if (!/[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(s)) return false;
  if (!/(^|\s)[A-ZА-ЯӘҒҚҢӨҰҮҺІ]/.test(s)) return false;
  return true;
}
function phoneOk(t) { return ((t.match(/\d/g) || []).length) >= 6; }
function pickPhone(t) {
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
function normalizeTopic(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase();
  const map = [
    [/сайт|лендинг|landing|web\s*site|страниц/i, "Разработка сайта"],
    [/google.?ads|контекст|gdn|ppc|таргет|2гис|2gis|olx|реклам/i, "Реклама в интернете"],
    [/smm|инстаграм|instagram|контент|stories|reels/i, "SMM ведение"],
    [/логотип|logo|фирменн.*стил|бренд(инг)?/i, "Логотип и стиль"],
    [/брендбук|brand.?book|гайдлайн/i, "Брендбук"],
    [/чат.?бот|ai.?bot|ии.?бот|crm|битрикс|сквозн.*аналитик|автоматизац/i, "CRM, автоматизация, ИИ"],
    [/отдел.*продаж|скрипт|холодн.*звон|kpi/i, "Отдел продаж"],
    [/масштаб|growth|scale|стратегия.*развития|позиционир/i, "Масштабирование идеи"],
    [/маркетинг.*анализ|целев.*аудитор|конкурент|ценообраз/i, "Маркетинговый анализ"],
    [/финанс.*анализ|убытк|unit\s*economics|управленчес/i, "Финансовый анализ"],
    [/финанс.*план|финмодель|финансовая.*модель|движен.*денег/i, "Финансовый план"],
    [/бизнес.?план|swot/i, "Бизнес-план"],
    [/презентац.*инвест|pitch/i, "Презентация для инвестора"],
    [/инвестиц|поиск.*инвест/i, "Привлечение инвестиций"],
    [/мисси|vision|цели.*задачи|стратегия.*развития/i, "Стратегия развития"],
    [/концепц.*работы|имиджев|медиа.?план|маркетинговый\s*план/i, "Концепция работы"],
    [/бизнес.*процесс|карта.*процесс|регламент|оптимизац/i, "Бизнес-процессы"],
    [/франшиз|franchise/i, "Франчайзинг"],
  ];
  for (const [re, t] of map) if (re.test(s)) return t;
  const exact = ALLOWED_TOPICS.find(x => x.toLowerCase() === raw.toLowerCase());
  return exact || null;
}
function guessTopicFromText(txt = "") {
  const t = normalizeTopic(txt);
  return t || null;
}
function buildRecentUserBundle(history, currentUserText, n = 4) {
  const recentUsers = history.filter(h => h.role === "user").slice(-n).map(h => h.content || "");
  return [...recentUsers, currentUserText || ""].join(" • ");
}
function slugify(str) {
  return (str || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-zа-я0-9\-]/gi, "");
}

// ==== Интент-детекторы ====
const CONSENT_RE = /\b(давайте|давай|хочу|нужно|нужна|нужен|запишите|оформ(им|ить)|готов|интересует консультац|да,?\s*(можно|давай|оформляй)|поехали)\b|(^|\s)(👍|👌|✅|ок|okay|окей|go|let'?s)\b/iu;
const SOFT_YES_RE = /^(да|ок|окей|ага|угу|можно|давай|go|👍|👌|✅)\.?$/iu;
const DECLINE_RE = /\b(не\s*нужно|не\s*надо|пока\s*не|позже|сам\s*напишу|передумаю|не\s*звоните|без\s*звонков|просто\s*узнаю|информативно)\b/iu;
const CANCEL_RE = /\b(отмени(ть)?|стоп|передумал|не\s*официал|не\s*оформляй|отмена)\b/iu;

// «умное да»: короткое «да/ок/👍» — если недавно был оффер ИЛИ ассистент только что говорил по теме
async function isSmartConsent(chatId, userText, lastAssistantTopic) {
  if (!SOFT_YES_RE.test(userText)) return false;
  const offer = await getLastOffer(chatId);
  const offerFresh = offer && (Date.now() - (offer.ts || 0) <= 10 * 60 * 1000);
  if (offerFresh) return true;
  // ещё считаем «да» согласием, если прямо перед этим ассистент рассказывал по теме
  if (lastAssistantTopic) return true;
  return false;
}

// ==== Локализация коротких фраз ====
const L = {
  hi: {
    ru: "Здравствуйте! Чем могу помочь?",
    kz: "Сәлеметсіз бе! Қалай көмектесе аламын?",
    en: "Hello! How can I help?",
  },
  askName: {
    ru: "Как к вам обращаться?",
    kz: "Сізге қалай жүгінейін?",
    en: "How should we address you?",
  },
  askPhone: {
    ru: "Оставьте, пожалуйста, номер телефона или WhatsApp.",
    kz: "Телефон немесе WhatsApp нөміріңізді қалдырыңыз.",
    en: "Please share your phone or WhatsApp number.",
  },
  booked: {
    ru: "Спасибо! Передаю информацию менеджеру. Он свяжется с вами.",
    kz: "Рақмет! Ақпаратты менеджерге беремін. Ол хабарласады.",
    en: "Thanks! I’m passing this to a manager. They’ll contact you.",
  },
  resetDone: {
    ru: "История и запись очищены. Начнём заново.",
    kz: "Тарих пен жазылу тазартылды. Қайтадан бастайық.",
    en: "History and booking cleared. Let’s start over.",
  },
  unknownLang: {
    ru: "Поддерживаемые языки: ru, kz, en. Пример: /lang ru",
    kz: "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz",
    en: "Supported languages: ru, kz, en. Example: /lang en",
  }
};

// ==== Компания ====
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
};

// ==== Системный промпт ====
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана).
Направления: ${ALLOWED_TOPICS.join(", ")}.
Полный перечень и описания услуг даны во внешнем блоке SERVICES_TEXT.
Стиль: деловой, дружелюбный, кратко, по делу.
Правила:
- Не используй фразы вроде "сегодня" в приветствии; говори нейтрально.
- Если вопрос о цене/сроках — говори, что расчёт индивидуальный после консультации; сумм и сроков не выдумывай.
- Адрес/телефон/график фиксированы и указаны отдельно (используй только их).
- Ссылку на strateg.kz давай по запросу или когда логично.
- Если запрос вне наших тем — ответь нейтрально и предложи подключить менеджера или отправь ссылку на сайт.
- Не проси "отправить одним сообщением". Принимай данные в любом порядке.
`;

// ==== Входящий webhook ====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.statusCode = 405; return res.end("Method Not Allowed"); }

    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (!headerSecret || headerSecret !== process.env.TELEGRAM_SECRET_TOKEN) {
      res.statusCode = 401; return res.end("Unauthorized");
    }

    const raw = await readBody(req);
    const update = raw ? JSON.parse(raw) : {};
    const message = update.message || update.edited_message || null;

    if (!message || !message.text) {
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    const chatId = message.chat.id;
    const userText = (message.text || "").trim();

    // ===== Язык/команды =====
    if (/^\/lang\b/i.test(userText)) {
      const parts = userText.split(/\s+/);
      const code = (parts[1] || "").toLowerCase();
      if (["ru","kz","en"].includes(code)) {
        await redis.set(LANG_KEY(chatId), code, { ex: 60 * 60 * 24 * 30 });
        await sendTG(chatId, code === "ru" ? "Язык интерфейса установлен: ru." : code === "kz" ? "Интерфейс тілі орнатылды: kz." : "Interface language set to: en.");
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText) || "ru";
        await sendTG(chatId, L.unknownLang[current] || L.unknownLang.ru);
      }
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    if (userText === "/reset") {
      await redis.del(`hist:${chatId}`);
      await clearBooking(chatId);
      await redis.del(LAST_TOPIC_SENT_KEY(chatId));
      await redis.del(LAST_OFFER_KEY(chatId));
      // контакт оставляем — удобно для повторных обращений
      const langAfterReset = (await redis.get(LANG_KEY(chatId))) || "ru";
      await redis.set(LANG_KEY(chatId), langAfterReset, { ex: 60 * 60 * 24 * 30 });
      await sendTG(chatId, L.resetDone[langAfterReset] || L.resetDone.ru);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    if (userText === "/whoami") {
      await sendTG(chatId, `chat.id: ${chatId}`);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // язык
    const stored = await redis.get(LANG_KEY(chatId));
    const guess = confidentLangSwitch(userText);
    let lang = (stored || guess || "ru");
    if (!stored || (guess && guess !== stored)) {
      lang = guess || "ru";
      await redis.set(LANG_KEY(chatId), lang, { ex: 60 * 60 * 24 * 30 });
    }

    // ===== Слоты/контакты/история =====
    const booking = await getBooking(chatId);
    const contact = await getContact(chatId) || {};
    const history = await getHistory(chatId);
    const lastAssistantText = history.filter(h => h.role === "assistant").slice(-1)[0]?.content || "";
    const bundle = buildRecentUserBundle(history, userText, 4);

    // Тема из текста пользователя / бандла / последнего ответа ассистента
    const topicFromUser = guessTopicFromText(userText);
    const topicFromBundle = guessTopicFromText(bundle);
    const topicFromAssistant = guessTopicFromText(lastAssistantText);
    const topicNow = topicFromUser || topicFromBundle || topicFromAssistant || booking.topic || null;

    // ===== Отмена/отказ — останавливаем сбор =====
    if (CANCEL_RE.test(userText) || DECLINE_RE.test(userText)) {
      await clearBooking(chatId);
      await redis.del(LAST_OFFER_KEY(chatId));
      await pushHistory(chatId, "user", userText);
      const msg = lang === "kz" ? "Түсіндім. Қосымша сұрақтарыңыз болса, жазыңыз."
        : lang === "en" ? "Understood. If you have other questions, feel free to ask."
        : "Понял. Если появятся вопросы — пишите.";
      await pushHistory(chatId, "assistant", msg);
      await sendTG(chatId, msg);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Согласие на консультацию =====
    const explicitYes = CONSENT_RE.test(userText);
    const smartYes = await isSmartConsent(chatId, userText, topicFromAssistant);
    const wantsConsultation = explicitYes || smartYes;

    if (wantsConsultation) {
      const b = { ...booking, stage: "collect" };
      if (topicNow) b.topic = topicNow;

      // Подцепим имя/телефон из реплики
      const name1 = extractName(userText);
      const phone1 = pickPhone(userText);
      if (!b.name && name1 && isNameLike(name1)) b.name = name1;
      if (!b.phone && phone1 && phoneOk(phone1)) b.phone = phone1;

      // Подстрахуем контактами
      if (!b.name && contact?.name) b.name = contact.name;
      if (!b.phone && contact?.phone) b.phone = contact.phone;

      // Если всё есть — шлём лид
      if (b.topic && b.name && b.phone) {
        await sendLeadAndReset(chatId, b.topic, b.name, b.phone, lang);
        res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
      }

      // иначе спросим недостающее
      await setBooking(chatId, b);
      const ask = !b.name ? (L.askName[lang] || L.askName.ru) : (L.askPhone[lang] || L.askPhone.ru);
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", ask);
      await sendTG(chatId, ask);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Уже в процессе сбора (имя/тел по очереди) =====
    if (booking.stage === "collect") {
      const b = { ...booking };

      const name1 = extractName(userText);
      const phone1 = pickPhone(userText);
      if (!b.name && name1 && isNameLike(name1)) b.name = name1;
      if (!b.phone && phone1 && phoneOk(phone1)) b.phone = phone1;

      if (!b.name && contact?.name) b.name = contact.name;
      if (!b.phone && contact?.phone) b.phone = contact.phone;

      if (!b.topic && topicNow) b.topic = topicNow;

      if (b.topic && b.name && b.phone) {
        await sendLeadAndReset(chatId, b.topic, b.name, b.phone, lang);
        res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
      }

      await setBooking(chatId, b);
      const ask = !b.name ? (L.askName[lang] || L.askName.ru) : (L.askPhone[lang] || L.askPhone.ru);
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", ask);
      await sendTG(chatId, ask);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Обычный ИИ-ответ =====
    const languageLine = lang === "ru" ? "Отвечай на русском языке."
      : lang === "kz" ? "Жауапты қазақ тілінде бер."
      : "Reply in English.";

    const systemPrompt = [
      baseSystemPrompt,
      `Адрес: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Время работы: ${COMPANY_INFO.worktime}.`,
      `SERVICES_TEXT: ${SERVICES_TEXT}`,
      languageLine,
      `Напоминание ассистенту:
- Не пиши "сегодня" и "одним сообщением".
- Если клиент интересуется услугой (${ALLOWED_TOPICS.join(", ")}), можно мягко предложить консультацию одной фразой (без навязчивости).`,
    ].join("\n");

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
      (history.length === 0 ? (L.hi[lang] || L.hi.ru) : "Принято.");

    // Санитайзер
    reply = sanitizeAssistant(reply);

    // ==== Анти-повтор оффера по теме ====
    // Определим тему в ответе ассистента (если её не было в topicNow)
    const topicInReply = guessTopicFromText(reply);
    const topical = topicNow || topicInReply || null;

    // Если в ответе есть предложение консультации,
    // но по этой теме мы уже предлагали за последние 24 часа — вырежем CTA из ответа
    if (hasConsultOffer(reply) && topical && await wasTopicOffered(chatId, topical)) {
      reply = stripConsultOffer(reply);
      // и НЕ ставим заново last_offer / offered-topic
    } else if (hasConsultOffer(reply)) {
      // пометим, что оффер был (для «умного да»)
      await setLastOffer(chatId, topical || null);
      // и запомним, что по теме предлагали (чтобы не повторяться)
      if (topical) await markTopicOffered(chatId, topical);
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

// ==== Санитайзер/оффер-хелперы ====
function sanitizeAssistant(t) {
  if (!t) return t;
  let s = t;
  s = s.replace(/\bсегодня\b/gi, ""); // в приветствиях/CTA убрать
  s = s.replace(/одним сообщением/gi, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}
function hasConsultOffer(t) {
  if (!t) return false;
  return /(консультац|созвон|обсудим детали|встретить|могу помочь оформить|организовать консультацию|оформим консультацию)/i.test(t);
}
function stripConsultOffer(t) {
  if (!t) return t;
  // Удалим предложения/фразы с ключами «консультац/созвон/обсудим детали/оформим консультацию»
  // Грубо режем по предложениям.
  const sentences = t.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(s => !/(консультац|созвон|обсудим детали|встретить|оформ(им|ить)\s+консультац|организовать консультацию)/i.test(s));
  const res = kept.join(" ");
  return res.trim() || t; // если вдруг всё вырезали — оставим исходник
}

// ==== Отправка лида ====
async function sendLeadAndReset(chatId, topic, name, phone, lang) {
  const normTopic = normalizeTopic(topic) || topic || "Консультация";

  // анти-дубль (на 2 часа)
  const hash = `${normTopic}|${(name||"").trim().toLowerCase()}|${(phone||"").replace(/\D/g, "")}`;
  if (await isLeadHashSeen(chatId, hash)) {
    const pre = L.booked[lang] || L.booked.ru;
    await pushHistory(chatId, "assistant", pre);
    await sendTG(chatId, pre);
    await clearBooking(chatId);
    return;
  }

  const adminId = getAdminId();
  if (adminId) {
    const adminMsg =
      `🆕 Новая заявка чатбота:\n` +
      `Тема: ${normTopic}\n` +
      `Имя: ${name || "-"}\n` +
      `Телефон: ${phone || "-"}\n` +
      `Источник: tg chat_id ${chatId}`;
    await sendTG(adminId, adminMsg);
  } else {
    console.error("ADMIN_CHAT_ID is not set or empty");
  }

  await setContact(chatId, { name, phone });
  await setLastTopicSent(chatId, normTopic);
  await markLeadHash(chatId, hash);
  await clearBooking(chatId);
  await redis.del(LAST_OFFER_KEY(chatId));

  const preReply = L.booked[lang] || L.booked.ru;
  await pushHistory(chatId, "assistant", preReply);
  await sendTG(chatId, preReply);
}

// ==== Отправка сообщения в Telegram ====
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
