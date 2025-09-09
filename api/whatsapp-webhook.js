// api/whatsapp-webhook.js
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

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

// WhatsApp Cloud API
const META_WA_TOKEN = process.env.META_WA_TOKEN; // постоянный токен (System User)
const META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID; // номер WA (id)
const META_WA_VERIFY_TOKEN = process.env.META_WA_VERIFY_TOKEN; // твой «секрет» для верификации вебхука
const META_APP_SECRET = process.env.META_APP_SECRET || ""; // для подписи X-Hub-Signature-256 (опционал, но лучше указать)

const LANG_KEY = (id) => `wa:lang:${id}`;
const BOOK_KEY = (id) => `wa:book:${id}`;
const CONTACT_KEY = (id) => `wa:contact:${id}`;
const LAST_OFFER_KEY = (id) => `wa:last_offer:${id}`; // { topic, ts }
const COMBINE_MULTI_TOPICS = true;

/* =========================
   БЛОК УСЛУГ — ВСТАВЬ СВОЙ СПИСОК 
   ========================= */
const SERVICES_TEXT = `
- логотип и стиль:
-- Разработка логотипа и фирменного стиля, определяющего образ компании:
--- отражение миссии и деятельности компании;
--- разработка в соответствии с современными трендами;
--- смысловая нагрузка в соответствии с психологией целевой аудитории;
--- учет индивидуальности личности заказчика.
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
- SMM продвижение:
-- Полноценное ведение профильной странички в инстаграм (рабочей или личного бренда):
--- разработка стратегии продвижения бренда;
--- составление контент-плана на 1 месяц вперед;
--- профессиональная настройка профиля в Instagram;
--- создание собственной PR-стилистики;
--- создание контента (видеосъемка и дизайн макетов);
--- стабильное размещение контента (посты, reels, stories);
--- аналитика эффективности ведения профиля.
- отдел продаж / call-center:
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
--- разработка и обучение ИИ чат-бота для быстрой обработки обращений клиентов 24/7;
--- настройка сквозной аналитики для оценки эффективности рекламы.
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
- презентация проекта:
-- Краткий бизнес-план проекта:
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
- франчайзинг:
-- Разработка и упаковка во франшизу действующего или нового бизнеса:
--- сбор информации и создание концепции франшизы;
--- описание бизнес-процессов компании;
--- создание маркетинговых материалов для франшизы;
--- финансовая модель бизнеса;
--- юридическая упаковка и договоры;
--- подготовка сайта и настройка рекламной кампании;
--- запуск франшизы и обработка первых обращений.
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
async function getHistory(id) {
  const items = await redis.lrange(`hist:${id}`, -HISTORY_LEN, -1);
  return (items || []).map(safeParseItem).filter(Boolean);
}
async function pushHistory(id, role, content) {
  const entry = { role, content };
  await redis.rpush(`hist:${id}`, JSON.stringify(entry));
  await redis.ltrim(`hist:${id}`, -HISTORY_LEN, -1);
}

/* Слоты заявки (WA-версия): только name, city, sphere + topic */
async function getBooking(id) {
  const val = await redis.get(BOOK_KEY(id));
  if (!val) return { stage: null, topic: null, name: null, city: null, sphere: null };
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch {
    return { stage: null, topic: null, name: null, city: null, sphere: null };
  }
}
async function setBooking(id, data) {
  await redis.set(BOOK_KEY(id), JSON.stringify(data), { ex: 60 * 60 * 24 });
}
async function clearBooking(id) {
  await redis.del(BOOK_KEY(id));
}

/* Контакт (кэш 30 дней) — храним хотя бы имя профиля WA */
async function getContact(id) {
  const v = await redis.get(CONTACT_KEY(id));
  if (!v) return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}
async function setContact(id, { name }) {
  await redis.set(CONTACT_KEY(id), JSON.stringify({ name: name || null }), { ex: 60 * 60 * 24 * 30 });
}
async function clearContact(id) {
  await redis.del(CONTACT_KEY(id));
}

/* Последнее предложение (для «умного да») */
async function setLastOffer(id, topic) {
  const payload = { topic, ts: Date.now() };
  await redis.set(LAST_OFFER_KEY(id), JSON.stringify(payload), { ex: 60 * 30 });
}
async function getLastOffer(id) {
  const v = await redis.get(LAST_OFFER_KEY(id));
  if (!v) return null;
  try { return JSON.parse(v) } catch { return null; }
}
async function clearLastOffer(id) {
  await redis.del(LAST_OFFER_KEY(id));
}

/* Язык */
function detectLang(text) {
  if (!text) return "ru";
  const hasKazChars = /[әғқңөұүһі]/i.test(text);
  const hasKazHints = /(саламат|салем|сәлем|рахмет|жаксы|жақсы|бар\s*ма|сендер|сиздер|ия\b|жок\b|қалай)/i.test(text);
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

/* Имя (берём и из профиля), простая нормализация */
function normalizeName(name) {
  if (!name) return name;
  let s = String(name).trim();
  s = s.replace(/\b([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ])([a-zа-яёәғқңөұүһі-]*)/giu,
    (_, a, b) => a.toUpperCase() + (b || "").toLowerCase()
  );
  return s.trim();
}
function isNameLike(t) {
  if (!t) return false;
  if (/[!?]/.test(t)) return false;
  if ((t.match(/\d/g) || []).length > 0) return false;
  const words = t.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 2) return false;
  return /^[\p{L}-]+$/u.test(words.join(""));
}

/* Темы — как в TG */
const TOPIC_PATTERNS = [
  { re: /(масштаб|growth|scale|стратегия\s*развития|позиционир(ование)?)/i, topic: "Масштабирование и стратегия развития" },
  { re: /(маркетинг(овый)?\s*анализ|анализ\s*рынка|целев(ая|ой)\s*аудитор|конкурент|ценообраз)/i, topic: "Маркетинговый анализ" },
  { re: /(финанс(овый)?\s*анализ|unit\s*economics|финанс(овый)?\s*аудит|управленческ.*отчет)/i, topic: "Финансовый анализ" },
  { re: /(финанс(овый)?\s*план|финмодель|фин.?модель|финанс(овая)?\s*модель|прогноз|движен(ие)?\s*денег|точка\s*безубыт)/i, topic: "Финансовый план" },
  { re: /(бизнес.?план|бизнесплан|swot)/i, topic: "Бизнес-план" },
  { re: /(през(ентац(ия|ии|ию)|а|у|ку|ка|ент(?![а-я]))(\s*проекта|компании|о компании)?|pitch\s*deck)/i, topic: "Презентация проекта" },
  { re: /(инвестиц|investment|поиск\s*инвестор)/i, topic: "Привлечение инвестиций" },
  { re: /(стратеги(я)?\s*развития|vision)/i, topic: "Стратегия развития" },
  { re: /(концепц(ия)?\s*работы|позиционирование|имиджев)/i, topic: "Концепция работы компании" },
  { re: /(бизнес.?процесс|регламент|оптимизац|автоматизац|crm(?!\s*веден))/i, topic: "Бизнес-процессы/автоматизация" },
  { re: /(логотип|лого\b|logo|бренд(инг)?|фирменн(ый|ого)?\s*стил)/i, topic: "Логотип и фирменный стиль" },
  { re: /(бренд.?бук|брэнд.?бук|brand.?book|гайдлайн|guideline)/i, topic: "Брендбук" },
  { re: /(сайт|веб.?сайт|web\s*site|site|лендинг|лэндинг|landing)/i, topic: "Разработка сайта" },
  { re: /(реклам(а|у|ы|е|ой)\b|таргет(?![а-я])|таргетинг(?![а-я])|google.?ads|контекст|кмс|gdn|ppc|2gis|olx)/i, topic: "Реклама в интернете" },
  { re: /(смм|smm|инстаграм|instagram|stories|reels|контент\s*маркетинг)/i, topic: "SMM ведение" },
  { re: /(отдел\s*продаж|скрипт|холодн(ые)?\s*звон|kpi|коммерческое\s*предложение|менеджер)/i, topic: "Отдел продаж" },
  { re: /(crm|битрикс.?24|црм|срм|amo.?crm|bitrix|сквозн.*аналитик|chat.?bot|чат.?бот|ии.?бот|ai.?bot)/i, topic: "CRM, автоматизация, ИИ" },
  { re: /(франшиз|franchise|франчайзи.?нг)/i, topic: "Франчайзинг" },
  { re: /(маркетолог|gtm|go.?to.?market|стратегия\s*продвижения)/i, topic: "Маркетинг/реклама" },
];
function guessTopicsAll(userText) {
  const u = (userText || "").toLowerCase();
  const set = new Set();
  for (const p of TOPIC_PATTERNS) if (p.re.test(u)) set.add(p.topic);
  return Array.from(set);
}

/* Научим бота понимать формат «Имя, Город, Сфера» в одном сообщении */
function parseInlineLead(text) {
  if (!text) return null;
  const parts = text.split(/[,\n;/]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const name = normalizeName(parts[0]);
    const city = parts[1].slice(0, 100);
    const sphere = parts.slice(2).join(", ").slice(0, 200);
    if (isNameLike(name)) return { name, city, sphere };
  }
  return null;
}

/* Автозаполнение из сообщения + профиля WA */
async function tryAutofillFrom(id, booking, userText, waProfileName) {
  if (!booking.name && waProfileName && isNameLike(waProfileName)) {
    booking.name = normalizeName(waProfileName);
  }
  const topicsHit = guessTopicsAll(userText);
  if (!booking.topic && topicsHit.length === 1) booking.topic = topicsHit[0];
  if (topicsHit.length > 1) booking.topic = COMBINE_MULTI_TOPICS ? topicsHit.join(", ") : topicsHit[0];
  return booking;
}

/* Проверки слотов */
function hasAllBookingFields(b) {
  const hasTopic = b.topic && b.topic.trim().length;
  return !!(b && hasTopic && b.name && b.city && b.sphere);
}
function decideNextStage(b) {
  if (!b.name) return "name";
  if (!b.city) return "city";
  if (!b.sphere) return "sphere";
  return null;
}

/* Локализация (краткие реплики) */
const L = {
  hi: {
    ru: "Здравствуйте! Я ИИ-ассистент компании START. Чем могу помочь?",
    kz: "Сәлеметсіз бе! Мен START компаниясының ЖИ-көмекшісімін. Қалай көмектесе аламын?",
    en: "Hello! I’m START company’s AI assistant. How can I help?",
  },
  askOnlyName: {
    ru: "Спасибо! Как к вам обращаться (имя)?",
    kz: "Рақмет! Есіміңіз қалай?",
    en: "Thanks! What’s your name?",
  },
  askCity: {
    ru: "И подскажите город обращения?",
    kz: "Қай қаладан жазып отырсыз?",
    en: "And which city are you in?",
  },
  askSphere: {
    ru: "И ещё: в какой сфере работаете (чем занимаетесь)?",
    kz: "Тағы: қай салада жұмыс істейсіз (немен айналысасыз)?",
    en: "One more: what’s your business field?",
  },
  booked: {
    ru: "Передаю информацию менеджеру. Мы свяжемся с вами. Спасибо!",
    kz: "Ақпаратты менеджерге беремін. Біз сізбен хабарласамыз. Рахмет!",
    en: "I’m passing this to a manager. We’ll contact you. Thank you!",
  },
  resetDone: {
    ru: "История и заявка очищены. Начнём заново.",
    kz: "Тарих пен өтінім тазартылды. Қайта бастайық.",
    en: "History and booking cleared. Let’s start over.",
  },
};

/* Реквизиты компании для системного промпта */
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
  site: "https://strateg.kz",
};

/* Системный промпт под WA (без запроса времени/дат !) */
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана).
Кратко и по делу консультируй ТОЛЬКО по услугам из блока SERVICES_TEXT ниже, затем уместно предложи консультацию.
Не используй в приветствии слова «сегодня/today».
Никогда не проси/не упоминай время, дату или согласование времени — этим займётся менеджер.
Если спрашивают про цены/сроки — отвечай, что расчёт индивидуальный после консультации.
Адрес: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Время работы: ${COMPANY_INFO.worktime}. Адрес сайта: ${COMPANY_INFO.site}.
Полный перечень услуг: см. блок SERVICES_TEXT (используй ТОЛЬКО эти услуги).
`;

/* Админ (уведомления — можно переиспользовать TG, как в твоём проекте) */
function getAdminId() {
  const raw = (process.env.ADMIN_CHAT_ID || "").replace(/^[\'"]|[\'"]$/g, "");
  return raw;
}
async function sendTG(chatId, text) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
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

/* Отправка WA-сообщений (с патчем на "8") */
async function sendWA(toWaId, text) {
  const url = `https://graph.facebook.com/v20.0/${META_WA_PHONE_NUMBER_ID}/messages`;
  async function _post(to) {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      text: { body: text?.slice(0, 3500) || "" },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${META_WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return resp;
  }
  // 1) Пытаемся отправить на нормальный waId (например 7702...)
  let resp = await _post(toWaId);
  if (!resp.ok) {
    const body = await resp.text();
    // Если Meta ругается на allow-list (#131030) — пробуем «казахский глюк» 78...
    if (body.includes('"code":131030')) {
      // вставляем '8' сразу после первой '7'
      const alt = /^7\d+$/.test(toWaId) && !toWaId.startsWith('78')
        ? ('78' + String(toWaId).slice(1))
        : toWaId;
      if (alt !== toWaId) {
        const resp2 = await _post(alt);
        if (!resp2.ok) {
          const body2 = await resp2.text();
          console.error("sendWA retry error", resp2.status, body2);
        }
        return resp2;
      }
    }
    console.error("sendWA error", resp.status, body);
  }
  return resp;
}

/* Подпись вебхука (X-Hub-Signature-256) — рекомендуемая проверка */
function verifyMetaSignature(appSecret, signature, rawBody) {
  try {
    if (!appSecret || !signature || !rawBody) return true; // мягкий режим
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/* =========================
   ОСНОВНОЙ ХЕНДЛЕР ДЛЯ VERCEL
   ========================= */
export default async function handler(req, res) {
  try {
    // 1) Верификация (GET)
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === META_WA_VERIFY_TOKEN) {
        res.statusCode = 200;
        return res.end(challenge);
      }
      res.statusCode = 403;
      return res.end("Forbidden");
    }

    // 2) Входящие события (POST)
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const raw = await readBody(req);

    // Проверка подписи
    const sig = req.headers["x-hub-signature-256"];
    if (!verifyMetaSignature(META_APP_SECRET, sig, raw)) {
      res.statusCode = 401;
      return res.end("Invalid signature");
    }

    const update = raw ? JSON.parse(raw) : {};
    if (!update?.entry?.length) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // WA события приходят пачками
    for (const entry of update.entry) {
      const changes = entry.changes || [];
      for (const ch of changes) {
        const value = ch.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        // статусы, шаблоны и т.п. игнорируем
        if (!messages.length) continue;

        // Берём первое сообщение
        const msg = messages[0];
        const waId = msg.from; // строка с номером в формате 79... или 770...
        const waProfileName = contacts?.[0]?.profile?.name || null;

        // поддерживаем только текст
        const userText = msg?.text?.body?.trim() || "";

        // Команды
        if (/^\/reset\b/i.test(userText)) {
          await redis.del(`hist:${waId}`);
          await redis.del(BOOK_KEY(waId));
          await clearContact(waId);
          await clearLastOffer(waId);
          const current = (await redis.get(LANG_KEY(waId))) || "ru";
          await redis.set(LANG_KEY(waId), current, { ex: 60 * 60 * 24 * 30 });
          await sendWA(waId, L.resetDone[current] || L.resetDone.ru);
          continue;
        }
        if (/^\/whoami\b/i.test(userText)) {
          await sendWA(waId, `wa_id: ${waId}`);
          continue;
        }
        if (/^\/lang\b/i.test(userText)) {
          const parts = userText.split(/\s+/);
          const code = (parts[1] || "").toLowerCase();
          if (code === "ru" || code === "kz" || code === "en") {
            await redis.set(LANG_KEY(waId), code, { ex: 60 * 60 * 24 * 30 });
            await sendWA(waId, `Язык интерфейса установлен: ${code}.`);
          } else {
            const current = (await redis.get(LANG_KEY(waId))) || detectLang(userText) || "ru";
            await sendWA(waId, (current === "kz")
              ? "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz"
              : (current === "en")
              ? "Supported languages: ru, kz, en. Example: /lang en"
              : "Поддерживаемые языки: ru, kz, en. Пример: /lang ru");
          }
          continue;
        }

        // Язык интерфейса
        const stored = await redis.get(LANG_KEY(waId));
        const guess = confidentLangSwitch(userText);
        let lang = stored || guess || detectLang(userText) || "ru";
        if (!stored || (guess && guess !== stored)) {
          lang = guess || lang;
          await redis.set(LANG_KEY(waId), lang, { ex: 60 * 60 * 24 * 30 });
        }

        // Приветствие на первое сообщение
        const historyBefore = await getHistory(waId);
        if (historyBefore.length === 0) {
          const hi = L.hi[lang] || L.hi.ru;
          await pushHistory(waId, "user", userText || "[non-text]");
          await pushHistory(waId, "assistant", hi);
          await sendWA(waId, hi);
          continue;
        }

        // Достаём слоты/контакт
        const booking = await getBooking(waId);
        const contact = (await getContact(waId)) || {};
        await tryAutofillFrom(waId, booking, userText, contact.name || waProfileName);
        await setBooking(waId, booking); // фиксируем найденные темы/имя в Redis

        // «Человек/оператор»
        if (/\b(человек|оператор|менеджер|специалист|переключи|позови|пригласи|call me|talk to human)\b/iu.test(userText)) {
          await notifyLead(waId, booking.topic || "Консультация", normalizeName(booking.name || waProfileName || "—"), booking.city || "—", booking.sphere || "—");
          await clearBooking(waId);
          await clearLastOffer(waId);
          await sendWA(waId, (lang === "kz") ? "Менеджерді шақырамын. Жақында хабарласамыз." :
                         (lang === "en") ? "I’ll bring a manager in. We’ll reach out shortly." :
                                           "Приглашаю менеджера. Скоро свяжемся.");
          continue;
        }

        // ===== «УМНОЕ СОГЛАСИЕ» =====
        const consentRe = /\b(давайте|давай|хочу|нужно|нужна|нужен|оформим|оформить|готов|интересует\s*консультац|поехали|запишите|записать|ну\s*да|ага|угу|ок|окей|ok|okey|хорошо|go|да|yes|иә|ия)\b/iu;
        if (consentRe.test(userText)) {
          // тема — из last_offer или из последних реплик
          let topicToBook = null;
          const offer = await getLastOffer(waId);
          const fresh = offer && (Date.now() - (offer.ts || 0) < 10 * 60 * 1000);
          if (fresh && offer.topic) topicToBook = offer.topic;
          if (!topicToBook) {
            const hist = await getHistory(waId);
            const prevUser = [...hist].filter(h => h.role === "user").slice(-1)[0]?.content || "";
            const prevA    = [...hist].filter(h => h.role === "assistant").slice(-1)[0]?.content || "";
            const fromUser = guessTopicsAll(prevUser);
            const fromA    = guessTopicsAll(prevA);
            let picked     = (fromUser.length ? fromUser : fromA);
            if (!picked.length && /(през(а|у|ку|ка)|презент(?![а-я]))/i.test(prevUser)) picked = ["Презентация проекта"];
            if (picked.length) {
              topicToBook = COMBINE_MULTI_TOPICS ? picked.join(", ") : picked[0];
              await setLastOffer(waId, COMBINE_MULTI_TOPICS ? picked.join(", ") : picked[0]);
            }
          }
          if (topicToBook) booking.topic = booking.topic || topicToBook;
          // запрашиваем недостающие поля
          const next = decideNextStage(booking);
          if (!next && hasAllBookingFields(booking)) {
            const name = normalizeName(booking.name || waProfileName || "—");
            await notifyLead(waId, booking.topic, name, booking.city, booking.sphere);
            await setContact(waId, { name });
            await clearBooking(waId);
            await clearLastOffer(waId);
            const txt = L.booked[lang] || L.booked.ru;
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", txt);
            await sendWA(waId, txt);
            continue;
          } else {
            // спросим следующий слот
            booking.stage = next || "name";
            await setBooking(waId, booking);
            const prompt = (booking.stage === "name")
              ? (L.askOnlyName[lang] || L.askOnlyName.ru)
              : (booking.stage === "city")
              ? (L.askCity[lang] || L.askCity.ru)
              : (L.askSphere[lang] || L.askSphere.ru);
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", prompt);
            await sendWA(waId, prompt);
            continue;
          }
        }

        // Обработка стадий
        if (booking.stage === "name") {
          const candidate = userText;
          if (isNameLike(candidate)) {
            booking.name = normalizeName(candidate);
            // следующий вопрос
            booking.stage = "city";
            await setBooking(waId, booking);
            const prompt = L.askCity[lang] || L.askCity.ru;
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", prompt);
            await sendWA(waId, prompt);
            continue;
          } else {
            const prompt = (lang === "kz") ? "Есіміңізді әріптермен ғана жазыңыз (мыс.: Алина)." :
                           (lang === "en") ? "Please send just your name (letters only)." :
                                             "Пожалуйста, укажите только имя (например: Алина).";
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", prompt);
            await sendWA(waId, prompt);
            continue;
          }
        }

        if (booking.stage === "city") {
          booking.city = userText.trim().slice(0, 100);
          booking.stage = "sphere";
          await setBooking(waId, booking);
          const prompt = L.askSphere[lang] || L.askSphere.ru;
          await pushHistory(waId, "user", userText);
          await pushHistory(waId, "assistant", prompt);
          await sendWA(waId, prompt);
          continue;
        }

        if (booking.stage === "sphere") {
          booking.sphere = userText.trim().slice(0, 200);
          booking.stage = null;
          if (!booking.topic) {
            const topics = guessTopicsAll(userText);
            if (topics.length) {
              booking.topic = COMBINE_MULTI_TOPICS ? topics.join(", ") : topics[0];
            } else {
              const offer = await getLastOffer(waId);
              booking.topic = (offer && offer.topic) || "Консультация";
            }
          }

          if (hasAllBookingFields(booking)) {
            const name = normalizeName(booking.name || waProfileName || "—");
            await notifyLead(waId, booking.topic, name, booking.city, booking.sphere);
            await setContact(waId, { name });
            await clearBooking(waId);
            await clearLastOffer(waId);
            const txt = L.booked[lang] || L.booked.ru;
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", txt);
            await sendWA(waId, txt);
            continue;
          } else {
            // что-то не хватило — спросим следующее поле
            const next = decideNextStage(booking) || "name";
            booking.stage = next;
            await setBooking(waId, booking);
            const prompt = (next === "name")
              ? (L.askOnlyName[lang] || L.askOnlyName.ru)
              : (next === "city")
              ? (L.askCity[lang] || L.askCity.ru)
              : (L.askSphere[lang] || L.askSphere.ru);
            await pushHistory(waId, "user", userText);
            await pushHistory(waId, "assistant", prompt);
            await sendWA(waId, prompt);
            continue;
          }
        }

         // ==== Однострочная заявка: "Имя, Город, Сфера" ====
         const inline = parseInlineLead(userText);
         if (inline) {
           booking.name = booking.name || inline.name;
           booking.city = booking.city || inline.city;
           booking.sphere = booking.sphere || inline.sphere;
           if (!booking.topic) {
              const tNow = guessTopicsAll(userText);
              if (tNow.length) {
                booking.topic = COMBINE_MULTI_TOPICS ? tNow.join(", ") : tNow[0];
              } else {
                const offer = await getLastOffer(waId);
                booking.topic = (offer && offer.topic) || "Консультация";
              }
            }

           if (hasAllBookingFields(booking)) {
             const name = normalizeName(booking.name || waProfileName || "—");
             await notifyLead(waId, booking.topic, name, booking.city, booking.sphere);
             await setContact(waId, { name });
             await clearBooking(waId);
             await clearLastOffer(waId);
             const txt = L.booked[lang] || L.booked.ru;
             await pushHistory(waId, "user", userText);
             await pushHistory(waId, "assistant", txt);
             await sendWA(waId, txt);
             continue;
           } else {
             // спросим недостающее
             const next = decideNextStage(booking) || "name";
             booking.stage = next;
             await setBooking(waId, booking);
             const prompt = (next === "name")
               ? (L.askOnlyName[lang] || L.askOnlyName.ru)
               : (next === "city")
               ? (L.askCity[lang] || L.askCity.ru)
               : (L.askSphere[lang] || L.askSphere.ru);
             await pushHistory(waId, "user", userText);
             await pushHistory(waId, "assistant", prompt);
             await sendWA(waId, prompt);
             continue;
           }
         }

        // ===== ИИ-ответ + мягкий оффер (без запуска слотов) =====
        const history = await getHistory(waId);
        const languageLine = lang === "ru"
          ? "Отвечай на русском языке."
          : lang === "kz"
          ? "Жауапты қазақ тілінде бер."
          : "Reply in English.";

        const systemPrompt = `${baseSystemPrompt}\n\n=== SERVICES_TEXT START ===\n${SERVICES_TEXT}\n=== SERVICES_TEXT END ===\n${languageLine}`;

        const messagesToLLM = [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: userText },
        ];
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messagesToLLM,
          temperature: 0.2,
        });
        let reply = completion.choices?.[0]?.message?.content?.slice(0, 3500) || "";

        // мягкий оффер с фиксацией last_offer
        const topicsNow = guessTopicsAll(userText);
        const replyTopics = guessTopicsAll(reply);
         
        if (!booking.stage && topicsNow.length > 0) {
          const topicLabel = COMBINE_MULTI_TOPICS ? topicsNow.join(", ") : topicsNow[0];
          const plural = (topicsNow.length > 1);
          const ruLine = plural
            ? `\n\nЕсли хотите, подготовлю консультацию по темам: ${topicLabel}. Для этого пришлите Имя, Город и Сферу деятельности.`
            : `\n\nЕсли хотите, подготовлю консультацию по теме: ${topicLabel}. Для этого пришлите Имя, Город и Сферу деятельности.`;
          const kzLine = plural
            ? `\n\nҚаласаңыз, келесі тақырыптар бойынша консультация дайындаймын: ${topicLabel}. Ол үшін Атыңызды, Қалаңызды және Сфераңызды жазыңыз.`
            : `\n\nҚаласаңыз, ${topicLabel} бойынша консультация дайындаймын. Ол үшін Атыңызды, Қалаңызды және Сфераңызды жазыңыз.`;
          const enLine = plural
            ? `\n\nIf you want, I’ll arrange a consultation on these topics: ${topicLabel}. Please send your Name, City and Business field.`
            : `\n\nIf you want, I’ll arrange a consultation on: ${topicLabel}. Please send your Name, City and Business field.`;
         
          reply = (reply || "").trim() + (lang === "kz" ? kzLine : lang === "en" ? enLine : ruLine);
         
          await setLastOffer(waId, topicLabel); // сохраняем всю строку тем
          booking.topic = topicLabel;
          await setBooking(waId, booking);
        }
          else if (!booking.stage && topicsNow.length === 0 && replyTopics.length === 1) {
          await setLastOffer(waId, replyTopics[0]);
        }

        if (!reply || reply.trim().length < 3) {
          reply = (lang === "ru") ? "Готово. Чем ещё помочь?"
                : (lang === "kz") ? "Дайын. Тағы не көмектесейін?"
                : "All set. How else can I help?";
        }

        await pushHistory(waId, "user", userText);
        await pushHistory(waId, "assistant", reply);
        await sendWA(waId, reply);
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}

/* =========================
   ВСПОМОГАТЕЛЬНОЕ: отправка лида админу
   ========================= */
async function notifyLead(waId, topic, name, city, sphere) {
  const adminId = getAdminId();
  const finalTopic = topic || "Консультация";
  const finalName = normalizeName(name || "");
  const msg =
    `🆕 Лид из WhatsApp:\n` +
    `Тема: ${finalTopic}\n` +
    `Имя: ${finalName || "-"}\n` +
    `Город: ${city || "-"}\n` +
    `Сфера: ${sphere || "-"}\n` +
    `Источник: wa_id ${waId}`;
  if (adminId && process.env.TELEGRAM_BOT_TOKEN) {
    await sendTG(adminId, msg);
  } else {
    console.log("[LEAD]", msg);
  }
}
