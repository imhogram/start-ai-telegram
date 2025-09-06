import OpenAI from "openai";
import { Redis } from "@upstash/redis";

// ==== Инициализация клиентов ====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ==== Константы / ключи ====
const HISTORY_LEN = 8; // последние 8 сообщений
const LANG_KEY = (chatId) => `lang:${chatId}`;
const LAST_LEAD_KEY = (chatId) => `lastlead:${chatId}`;
const PENDING_OFFER_KEY = (chatId) => `offer:${chatId}`;
const LEAD_COOLDOWN_SEC = 10 * 60; // 10 минут

// ==== Утилита чтения "сырого" тела запроса ====
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
  if (!val) return { stage: null, topic: null, when: null, name: null, phone: null };
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch {
    return { stage: null, topic: null, when: null, name: null, phone: null };
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

// ==== Детект языка (ru/kz/en) с учётом "kz без диакритик" ====
function detectLang(text) {
  if (!text) return "ru";
  const hasKazChars = /[әғқңөұүһі]/i.test(text);
  const hasKazHints = /(саламат|салем|сәлем|рахмет|жаксы|жақсы|бар\s*ма|барма|сендер|сиздер|сіздер|сиз|сіз|ия\b|иа\b|жок\b|жоқ\b|калай|қалай)/i.test(text);
  const hasCyr = /[А-Яа-яЁёІіЇїЪъЫыЭэЙй]/.test(text);
  if (hasKazChars || hasKazHints) return "kz";
  if (hasCyr) return "ru";
  return "en";
}

// ==== "Уверенное" переключение языка ====
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

// ==== Имя ====
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

// ==== Мощное извлечение времени/дат/диапазонов ====
function extractWhen(t) {
  if (!t) return null;
  const s = t
    .toLowerCase()
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1) диапазоны
  const range = s.match(/\b[сc]\s*\d{1,2}([:.]\d{2})?\s*(?:час(а|ов)?|ч)?\s*(?:до|-|—)\s*\d{1,2}([:.]\d{2})?\s*(?:час(а|ов)?|ч)?\b/);
  if (range) return _cleanTail(range[0]);

  // 2) "до 6 (вечера|утра|..)"
  const until = s.match(/\bдо\s*\d{1,2}([:.]\d{2})?\s*(?:час(а|ов)?|ч)?(?:\s*(утра|вечера|ночи|дня))?\b/);
  if (until) return _cleanTail(until[0]);

  // 3) относительное
  const rel = s.match(/\bчерез\s+(?:пол(?:-)?часа?|час(?:а)?|\d+\s*(?:час(?:а|ов)?|мин(?:ут)?))\b/);
  if (rel) return _cleanTail(rel[0]);

  // 4) ключевые слова дня + опц. «в HH:MM» + часть дня
  const dayKw = s.match(/\b(сейчас|сегодня|завтра|послезавтра|бүгін|ертең|қазір|вечер(?:ом)?|утр(?:ом)?|дн(?:ём|ем))\b(?:\s*в\s*\d{1,2}([:.]\d{2})?\s*(?:час(а|ов)?|ч)?)?(?:\s*(утра|вечера|ночи|дня|днём|днем))?/);
  if (dayKw) return _cleanTail(dayKw[0]);

  // 4.1) словесные части дня
  const dayparts = [
    /\bв\s*полдень\b/,
    /\bс\s*утра\b/,
    /\bдо\s*обеда\b/,
    /\bв\s*обед\b/,
    /\bпосле\s*обеда\b/,
    /\bдо\s*вечера\b/,
    /\bв\s*первой\s*половине\s*дня\b/,
    /\bво\s*второй\s*половине\s*дня\b/,
    /\bк\s*обеду\b/,
    /\bк\s*вечеру\b/,
  ];
  for (const re of dayparts) {
    const m = s.match(re);
    if (m) return _cleanTail(m[0]);
  }

  // 5) «сегодня/завтра ... (утром/вечером/днём)»
  const dayPart = s.match(/\b(сегодня|завтра|послезавтра|бүгін|ертең)(?:\s*(утром|вечером|днём|днем|ночью))?\b/);
  if (dayPart) return _cleanTail(dayPart[0]);

  // 6) явное время
  const atHhmm = s.match(/\b(?:в\s*)?\d{1,2}([:.]\d{2})\b/);
  if (atHhmm) return _cleanTail(atHhmm[0]);
  const atHourWord = s.match(/\bв\s*\d{1,2}\s*(?:час(а|ов)?|ч)\b/);
  if (atHourWord) return _cleanTail(atHourWord[0]);
  const todayAtHour = s.match(/\b(сегодня|завтра|бүгін|ертең)\s*в\s*\d{1,2}\s*(?:час(а|ов)?|ч)?\b/);
  if (todayAtHour) return _cleanTail(todayAtHour[0]);

  // 7) дата
  const dmy = s.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/);
  if (dmy) return _cleanTail(dmy[0]);

  // 8) английские
  const enAt = s.match(/\b(?:today|tomorrow)\s*(?:at\s*)?\d{1,2}([:.]\d{2})?\s*(?:am|pm)?\b/);
  if (enAt) return _cleanTail(enAt[0]);
  const enTime = s.match(/\b(?:till|until)\s*\d{1,2}([:.]\d{2})?\s*(?:am|pm)?\b/);
  if (enTime) return _cleanTail(enTime[0]);

  return null;
}

// ==== TOPICS ====
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
  { re: /(google.?ads|google|гугл(?:е)?|реклам[аы]\s*(?:в|на)\s*(?:google|гугл(?:е)?)|контекст(?:ная)?\s*реклам|контекст|кмс|контекстно-?медийн|gdn|cpc|ppc|2гис|2gis|olx|таргет)/i, topic: "Реклама в интернете"},
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
function guessTopicFrom(userText, lastAssistant = "") {
  const arr = guessTopics(userText, lastAssistant);
  return arr.length ? arr[0] : "Консультация";
}
function buildRecentUserBundle(history, currentUserText, n = 4) {
  const recentUsers = history.filter(h => h.role === "user").slice(-n).map(h => h.content || "");
  return [...recentUsers, currentUserText].join(" • ");
}

// === БЕРЕМ ВРЕМЯ из текущего текста ИЛИ из бандла ===
function collectLeadFromRecent(history, currentUserText, lastAssistantText) {
  const bundle = buildRecentUserBundle(history, currentUserText, 4);

  const phoneMatch = bundle.match(/[\+\d][\d\-\s().]{5,}/g);
  if (!phoneMatch) return null;
  const phone = phoneMatch
    .sort((a,b)=> (b.match(/\d/g)||[]).length - (a.match(/\d/g)||[]).length)[0]
    .trim();

  const topics = guessTopics(bundle, lastAssistantText || "");
  const topic  = topics.length ? topics.join(", ") : "Консультация";

  const whenHitDirect = extractWhen(currentUserText);
  const whenHitBundle = whenHitDirect ? null : extractWhen(bundle);
  const whenRaw = whenHitDirect || whenHitBundle;
  const when = whenRaw ? _cleanTail(whenRaw) : "-";

  let name = extractName(bundle) || "-";
  if (name === "-") {
    const parts = bundle.split(/[•,;\n]+/).map(s => s.trim());
    for (const c of parts) {
      if (isNameLike(c)) { name = c; break; }
    }
  }

  return { topic, when, name, phone };
}

// ==== Антидубликатор тем ====
function normalizeTopicString(t) {
  return (t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;!?\-–—]+/g, " ")
    .trim();
}
function topicsSimilar(a, b) {
  const A = new Set(normalizeTopicString(a).split(" ").filter(Boolean));
  const B = new Set(normalizeTopicString(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const score = inter / Math.min(A.size, B.size);
  return score >= 0.5;
}
async function getLastLead(chatId) {
  const raw = await redis.get(LAST_LEAD_KEY(chatId));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}
async function setLastLead(chatId, lead) {
  const payload = { ...lead, ts: Math.floor(Date.now()/1000) };
  await redis.set(LAST_LEAD_KEY(chatId), JSON.stringify(payload), { ex: 60 * 60 * 12 });
}
function withinCooldown(ts, sec = LEAD_COOLDOWN_SEC) {
  if (!ts) return false;
  const now = Math.floor(Date.now()/1000);
  return (now - ts) < sec;
}

// ==== ВСПОМОГАЛКИ для слотов ====
function hasAllBookingFields(b) {
  return !!(
    b &&
    b.topic && b.topic !== "Консультация" &&
    b.when  && b.when  !== "-" &&
    b.name  && b.name  !== "-" &&
    b.phone && b.phone !== "-"
  );
}
function decideNextStage(b) {
  if (!b.when  || b.when  === "-") return "when";
  if (!b.name  || b.name  === "-") return "name";
  if (!b.phone || b.phone === "-") return "phone";
  return null;
}
async function tryAutofillFrom(chatId, booking, userText) {
  const hist   = await getHistory(chatId);
  const lastA  = hist.filter(h => h.role === "assistant").slice(-1)[0];
  const bundle = buildRecentUserBundle(hist, userText, 4);

  if (!booking.when || booking.when === "-") {
    const w = extractWhen(userText) || extractWhen(bundle) || (lastA?.content ? extractWhen(lastA.content) : null);
    if (w) booking.when = _cleanTail(w);
  }
  if (!booking.name || booking.name === "-") {
    const n = extractName(userText) || extractName(bundle);
    if (n && isNameLike(n)) booking.name = n;
  }
  if (!booking.phone || booking.phone === "-") {
    const p = pickPhone(userText) || pickPhone(bundle);
    if (p && phoneOk(p)) booking.phone = p;
  }
  if (!booking.topic || booking.topic === "Консультация") {
    const fromMsg    = guessTopics(userText, lastA?.content || "");
    const fromBundle = guessTopics(bundle,    lastA?.content || "");
    const topicsArr  = Array.from(new Set([...fromMsg, ...fromBundle]));
    if (topicsArr.length) booking.topic = topicsArr.join(", ");
  }
  return booking;
}

// Явный триггер на запуск слотов (чтобы не начинать на «Здравствуйте»)
const bookTrigger = /консультац|запис|менеджер|оператор|поговор|қабылда|кеңес|consult|booking/i;
async function shouldStartBooking(userText, chatId) {
  if (!userText || userText.length < 2) return false;
  if (bookTrigger.test(userText)) return true;
  if (hasPhone(userText)) return true;
  if (extractWhen(userText)) return true;
  // если в тексте упомянута какая-то из услуг — считаем намерением
  const hist  = await getHistory(chatId);
  const lastA = hist.filter(h => h.role === "assistant").slice(-1)[0];
  const topics = guessTopics(userText, lastA?.content || "");
  return topics.length > 0;
}

// ==== Локализация ====
const L = {
  hi: {
    ru: "Здравствуйте! Я ИИ-ассистент компании START. Чем могу помочь?",
    kz: "Сәлеметсіз бе! Мен START компаниясының ЖИ-көмекшісімін. Қалай көмектесе аламын?",
    en: "Hello! I’m START’s AI assistant. How can I help?"
  },
  startBooking: {
    ru: "Прекрасно! Уточните, по какому вопросу нужна консультация (например: таргет, ИИ-бот, сайт/воронка, стратегия)?",
    kz: "Тамаша! Қандай сұрақ бойынша консультация қажет екенін нақтылаңыз (мысалы: таргет, ЖИ-бот, сайт/воронка, стратегия)?",
    en: "Great! What topic is the consultation about? (e.g., ads targeting, AI bot, website/funnel, strategy)."
  },
  askWhen: {
    ru: "Принято. Когда вам удобно? Напишите дату/время (например, завтра в 11:00).",
    kz: "Түсіндім. Қашан ыңғайлы? Күн/уақытты жазыңыз (мысалы, ертең 11:00).",
    en: "Got it. When works for you? Please write date/time (e.g., tomorrow at 11:00)."
  },
  askName: {
    ru: "Отлично. Как к вам обращаться?",
    kz: "Жақсы. Сізге қалай жүгінейін?",
    en: "Great. How should we address you?"
  },
  askPhone: {
    ru: "Спасибо. Оставьте, пожалуйста, номер телефона или WhatsApp.",
    kz: "Рақмет. Телефон немесе WhatsApp нөміріңізді қалдырыңыз.",
    en: "Thanks. Please share your phone or WhatsApp number."
  },
  confirm: (b, lang) => ({
    ru: `Подтверждаю запись:\n— Тема: ${b.topic}\n— Время: ${b.when}\n— Имя: ${b.name}\n— Контакт: ${b.phone}\nВсе верно? Если да — напишите «да», я передам менеджеру.`,
    kz: `Жазылуды растаймын:\n— Тақырып: ${b.topic}\n— Уақыты: ${b.when}\n— Есім: ${b.name}\n— Байланыс: ${b.phone}\nДұрыс па? Иә болса — «иә» деп жазыңыз, менеджерге беремін.`,
    en: `Confirming your booking:\n— Topic: ${b.topic}\n— Time: ${b.when}\n— Name: ${b.name}\n— Contact: ${b.phone}\nIs this correct? If yes, please reply “yes” and I’ll notify a manager.`
  }[lang]),
  booked: {
    ru: "Передаю информацию менеджеру. Он свяжется с вами для подтверждения. Спасибо!",
    kz: "Ақпаратты менеджерге беремін. Ол растау үшін сізбен хабарласады. Рақмет!",
    en: "I’m passing this to a manager. They’ll contact you to confirm. Thank you!"
  },
  resetDone: {
    ru: "История и запись очищены. Начнём заново.",
    kz: "Тарих пен жазылу тазартылды. Қайтадан бастайық.",
    en: "History and booking cleared. Let’s start over."
  },
  langSet: (lang) => ({
    ru: `Язык интерфейса установлен: ${lang}.`,
    kz: `Интерфейс тілі орнатылды: ${lang}.`,
    en: `Interface language set to: ${lang}.`
  }[lang]),
  unknownLang: {
    ru: "Поддерживаемые языки: ru, kz, en. Пример: /lang ru",
    kz: "Қолдау көрсетілетін тілдер: ru, kz, en. Мысал: /lang kz",
    en: "Supported languages: ru, kz, en. Example: /lang en"
  }
};

// ==== Адрес/телефон/график — фикс ====
const COMPANY_INFO = {
  address: "г. Астана, шоссе Коргалжын, 3, БЦ SMART, 4 этаж, офис 405",
  phone: "+77776662115",
  worktime: "Пн–Пт, 10:00–18:00",
};

// ==== Служебки для лидов ====
function buildAdminMsg({ topic, when, name, phone, chatId }) {
  return (
    `🆕 Новая заявка чатбота:\n` +
    `Тема: ${topic || "-"}\n` +
    `Время: ${when || "-"}\n` +
    `Имя: ${name || "-"}\n` +
    `Телефон: ${phone || "-"}\n` +
    `Источник: tg chat_id ${chatId}`
  );
}
async function sendLead(chatId, b, lang) {
  const adminId = getAdminId();
  const preReply = L.booked[lang] || L.booked.ru;

  if (adminId) {
    const msg = buildAdminMsg({ topic: b.topic, when: b.when, name: b.name, phone: b.phone, chatId });
    const r = await sendTG(adminId, msg);
    if (!r.ok) console.error("Failed to send lead to admin:", adminId);
  } else {
    console.error("ADMIN_CHAT_ID is not set or empty");
  }

  await setContact(chatId, { name: b.name, phone: b.phone });
  await clearBooking(chatId);
  await setLastLead(chatId, b);
  await redis.del(PENDING_OFFER_KEY(chatId));
  return preReply;
}

// ==== Базовый системный промпт (общий, язык подмешиваем ниже) ====
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана): консалтинг по созданию/развитию бизнеса, маркетинг, IT-разработки, сайты, автоматизация, внедрения ИИ и прочее, указанное на https://strateg.kz/.
Стиль: деловой, дружелюбный, 1–10 предложений, без лишней воды. Кратко консультируешь только в рамках наших услуг из списка ниже.
= Начало списка всех наших услуг для бизнеса: =
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
= Конец списка услуг. =
Правила:
- НИКОГДА не используй в первом приветствии слова вроде "сегодня / today".
- Уважай контекст последних сообщений (история диалога).
- Если пользователю нужна консультация специалиста — собери: {тема, время, имя, телефон}. После сбора подтверди и передай специалисту.
- Если пользователь уже согласился на консультацию после того, как ты упомянул конкретную услугу — не уточняй тему повторно. Используй эту услугу как topic.
- Если пользователь уже отправил свои данные в чате, а после спрашивал про другие услуги и тоже нужна консультация — не проси данные повторно без необходимости.
- Если вопрос о ценах или сроках — говори, что расчёт индивидуальный после консультации; не выдумывай суммы и сроки.
- Адрес компании фиксированный: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Рабочее время: ${COMPANY_INFO.worktime}. Используй только это.
- Ссылку на сайт strateg.kz давай по запросу или если логично по ходу беседы. Для уточнения услуг черпай информацию только оттуда.
- Если вопрос вне тем компании START — ответь нейтрально и предложи подключить менеджера или отправь ссылку на сайт.
`;

// ==== Основной обработчик вебхука ====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    // Проверка секрета Telegram
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (!headerSecret || headerSecret !== process.env.TELEGRAM_SECRET_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    // Парсим апдейт
    const raw = await readBody(req);
    const update = raw ? JSON.parse(raw) : {};
    const message = update.message || update.edited_message || null;

    // Только текст
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
        await sendTG(chatId, L.langSet(code));
        res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText) || "ru";
        await sendTG(chatId, L.unknownLang[current] || L.unknownLang.ru);
        res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
      }
    }

    if (userText === "/reset") {
      await redis.del(`hist:${chatId}`);
      await redis.del(`book:${chatId}`);
      await clearContact(chatId);
      const langAfterReset = (await redis.get(LANG_KEY(chatId))) || "ru";
      await redis.set(LANG_KEY(chatId), langAfterReset, { ex: 60 * 60 * 24 * 30 });
      await sendTG(chatId, L.resetDone[langAfterReset] || L.resetDone.ru);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // Вычисляем язык
    const stored = await redis.get(LANG_KEY(chatId));
    const guess  = confidentLangSwitch(userText);
    let lang = (stored || guess || "ru");
    if (!stored || (guess && guess !== stored)) {
      lang = guess || "ru";
      await redis.set(LANG_KEY(chatId), lang, { ex: 60 * 60 * 24 * 30 });
    }

    if (userText === "/whoami") {
      await sendTG(chatId, `chat.id: ${chatId}`);
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }
    if (userText === "/pingadmin") {
      const adminId = getAdminId();
      if (!adminId) await sendTG(chatId, "ADMIN_CHAT_ID не задан");
      else {
        await sendTG(adminId, "✅ Тест: сообщение администратору из бота");
        await sendTG(chatId, `Отправил тест админу: ${adminId}`);
      }
      res.statusCode = 200; return res.end(JSON.stringify({ ok: true }));
    }

    // ===== START RECORD SLOTS =====
    const booking = await getBooking(chatId);
    let handled = false;
    let preReply = null;

    // 0) Оппортунистически подберём любые поля из этого сообщения
    await tryAutofillFrom(chatId, booking, userText);

    // 0.1) Обработка ожидаемого «оффера на доп.заявку»
    const pendingOffer = safeParseItem(await redis.get(PENDING_OFFER_KEY(chatId)));
    if (pendingOffer && typeof userText === "string") {
      const yes = /\b(да|иә|yes|ага|ок|давай|хотим|нужно|оформи|оформить)\b/i.test(userText);
      const no  = /\b(нет|жоқ|no|не надо|потом|не сейчас)\b/i.test(userText);
      if (yes) {
        const lead = {
          topic: pendingOffer.topic,
          when:  pendingOffer.when || booking.when || "-",
          name:  booking.name || (await getContact(chatId))?.name || "-",
          phone: booking.phone || (await getContact(chatId))?.phone || "-"
        };
        preReply = await sendLead(chatId, lead, lang);
        handled  = true;
      } else if (no) {
        await redis.del(PENDING_OFFER_KEY(chatId));
        preReply = (lang === "kz") ? "Түсіндім. Басқа сұрақтарыңыз болса — жауап беремін."
              : (lang === "en") ? "Got it. Happy to answer any other questions."
              : "Понял. Если будут ещё вопросы — с радостью отвечу.";
        handled = true;
      }
    }

    // 0.2) Антидубликат/тема сейчас
    const lastLead = await getLastLead(chatId);
    const histForTopic  = await getHistory(chatId);
    const lastAForTopic = histForTopic.filter(h => h.role === "assistant").slice(-1)[0];
    const bundleForTopic = buildRecentUserBundle(histForTopic, userText, 4);
    const topicsNow = Array.from(new Set([
      ...guessTopics(userText, lastAForTopic?.content || ""),
      ...guessTopics(bundleForTopic, lastAForTopic?.content || "")
    ]));
    const primaryTopicNow = topicsNow.length ? topicsNow.join(", ") : null;
    const duplicateTopic = !!(lastLead && primaryTopicNow && topicsSimilar(primaryTopicNow, lastLead.topic) && withinCooldown(lastLead.ts));

    // 1) REUSE CONTACT: прежний контакт есть, телефона в тексте нет, тема есть
    if (!handled) {
      const contact = await getContact(chatId);
      if (!booking.stage && contact?.phone && !hasPhone(userText)) {
        const hist  = await getHistory(chatId);
        const lastA = hist.filter(h => h.role === "assistant").slice(-1)[0];
        const bundle = buildRecentUserBundle(hist, userText, 4);

        const whenHit = extractWhen(userText) || extractWhen(bundle) || (lastA?.content ? extractWhen(lastA.content) : null);
        const when = whenHit ? _cleanTail(whenHit) : "-";

        const fromMsg    = guessTopics(userText, lastA?.content || "");
        const fromBundle = guessTopics(bundle,    lastA?.content || "");
        const topicsArr  = Array.from(new Set([...fromMsg, ...fromBundle]));
        const topicFromMsg = topicsArr.length ? topicsArr.join(", ") : "Консультация";

        if (topicFromMsg && topicFromMsg !== "Консультация") {
          if (duplicateTopic && topicsSimilar(topicFromMsg, lastLead.topic)) {
            // по той же теме недавно — не шлём лид, перейдём к обычному ИИ-ответу
          } else {
            const b = { topic: topicFromMsg, when, name: contact.name || "-", phone: contact.phone || "-" };
            preReply = await sendLead(chatId, b, lang);
            handled = true;
          }
        }
      }
    }

    // 2) ONE-SHOT: в одном сообщении есть телефон
    if (!handled && !booking.stage && hasPhone(userText)) {
      const phone  = pickPhone(userText);
      const hist   = await getHistory(chatId);
      const lastA  = hist.filter(h => h.role === "assistant").slice(-1)[0];

      const bundle   = buildRecentUserBundle(hist, userText, 4);
      const fromMsg  = guessTopics(userText, lastA?.content || "");
      const fromBund = guessTopics(bundle,   lastA?.content || "");
      const topicsArr = Array.from(new Set([...fromMsg, ...fromBund]));
      const topic = topicsArr.length ? topicsArr.join(", ") : "Консультация";

      const whenHit = extractWhen(userText) || extractWhen(bundle) || (lastA?.content ? extractWhen(lastA.content) : null);
      const when = whenHit ? _cleanTail(whenHit) : "-";

      const name = extractName(userText) || "-";

      const b = { topic, when, name, phone };
      if (duplicateTopic && lastLead && topicsSimilar(topic, lastLead.topic)) {
        // та же тема недавно — не дублируем
      } else {
        preReply = await sendLead(chatId, b, lang);
        await setContact(chatId, { name, phone });
        handled = true;
      }
    }

    // 3) Слоты — запускаем ТОЛЬКО при намерении или если уже находимся в процессе
    const canStart = (!booking.stage) ? await shouldStartBooking(userText, chatId) : true;

    if (!handled && canStart) {
      // если слота ещё нет — выставим стартовый на основании того, чего не хватает
      if (!booking.stage) {
        booking.stage = decideNextStage(booking) || "when";
        await setBooking(chatId, booking);
      }

      // === stage: topic (редкий случай, если решишь использовать)
      if (!handled && booking.stage === "topic" && userText.length > 1) {
        booking.topic = userText;
        booking.stage = "when";
        await setBooking(chatId, booking);
        preReply = L.askWhen[lang] || L.askWhen.en;
        handled = true;
      }

      // === stage: when
      else if (!handled && booking.stage === "when") {
        await tryAutofillFrom(chatId, booking, userText);

        if (booking.when) {
          const same = (lastLead && topicsSimilar(booking.topic || "", lastLead.topic || "") && withinCooldown(lastLead.ts));
          booking.stage = decideNextStage(booking) || null;
          await setBooking(chatId, booking);

          if (!booking.stage) {
            if (same) {
              preReply = (lang === "kz") ? "Алдыңғы өтінім жіберілді. Қосымша сұрақтарыңыз болса — жауап беремін."
                    : (lang === "en") ? "Your previous request has been sent. Happy to answer more questions."
                    : "Предыдущая заявка уже передана менеджеру. Готов ответить на дополнительные вопросы.";
            } else {
              preReply = await sendLead(chatId, booking, lang);
            }
          } else if (booking.stage === "name") {
            preReply = L.askName[lang] || L.askName.en;
          } else if (booking.stage === "phone") {
            preReply = L.askPhone[lang] || L.askPhone.en;
          } else {
            preReply = L.askWhen[lang] || L.askWhen.en;
          }
        } else {
          preReply = L.askWhen[lang] || L.askWhen.en;
        }
        handled = true;
      }

      // === stage: name
      else if (!handled && booking.stage === "name") {
        await tryAutofillFrom(chatId, booking, userText);

        if (hasAllBookingFields(booking)) {
          const same = (lastLead && topicsSimilar(booking.topic || "", lastLead.topic || "") && withinCooldown(lastLead.ts));
          preReply = same
            ? ((lang === "kz") ? "Алдыңғы өтінім жіберілді. Қосымша сұрақтарыңыз болса — жауап беремін."
              : (lang === "en") ? "Your previous request has been sent. Happy to answer more questions."
              : "Предыдущая заявка уже передана менеджеру. Готов ответить на дополнительные вопросы.")
            : await sendLead(chatId, booking, lang);
          handled = true;
        } else if (booking.name) {
          booking.stage = decideNextStage(booking) || "phone";
          await setBooking(chatId, booking);
          preReply = L.askPhone[lang] || L.askPhone.en;
          handled = true;
        } else {
          preReply = (lang === "kz")
            ? "Есім тек мәтін түрінде керек (цифрларсыз). Қалай жазылады?"
            : (lang === "en")
              ? "Please send just your name (letters only)."
              : "Пожалуйста, укажите только имя (без цифр). Как к вам обращаться?";
          handled = true;
        }
      }

      // === stage: phone
      else if (!handled && booking.stage === "phone") {
        await tryAutofillFrom(chatId, booking, userText);

        if (hasAllBookingFields(booking)) {
          const same = (lastLead && topicsSimilar(booking.topic || "", lastLead.topic || "") && withinCooldown(lastLead.ts));
          preReply = same
            ? ((lang === "kz") ? "Алдыңғы өтінім жіберілді. Қосымша сұрақтарыңыз болса — жауап беремін."
              : (lang === "en") ? "Your previous request has been sent. Happy to answer more questions."
              : "Предыдущая заявка уже передана менеджеру. Готов ответить на дополнительные вопросы.")
            : await sendLead(chatId, booking, lang);
          handled = true;
        } else if (phoneOk(userText)) {
          booking.phone = pickPhone(userText) || userText;
          await tryAutofillFrom(chatId, booking, userText);
          await setBooking(chatId, booking);

          const next = decideNextStage(booking);
          if (!next) {
            const same = (lastLead && topicsSimilar(booking.topic || "", lastLead.topic || "") && withinCooldown(lastLead.ts));
            preReply = same
              ? ((lang === "kz") ? "Алдыңғы өтінім жіберілді. Қосымша сұрақтарыңыз болса — жауап беремін."
                : (lang === "en") ? "Your previous request has been sent. Happy to answer more questions."
                : "Предыдущая заявка уже передана менеджеру. Готов ответить на дополнительные вопросы.")
              : await sendLead(chatId, booking, lang);
          } else {
            if (next === "when")      preReply = L.askWhen[lang] || L.askWhen.en;
            else if (next === "name") preReply = L.askName[lang] || L.askName.en;
            else                      preReply = L.askPhone[lang] || L.askPhone.en;
          }
          handled = true;
        } else {
          preReply = (lang === "kz")
            ? "Телефон нөмірін жіберіңіз (мүмкін +7 / бос орындармен)."
            : (lang === "en")
              ? "Please send a phone number (you can include +7 / spaces)."
              : "Пожалуйста, отправьте номер телефона (можно с +7 / пробелами).";
          handled = true;
        }
      }
    }

    // Если уже всё сделали в слотах — отправим и выйдем
    if (handled && preReply) {
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // --- Если есть недавний лид, и сейчас всплыла новая тема — сохраним «оффер» ---
    if (!handled && lastLead && primaryTopicNow && !topicsSimilar(primaryTopicNow, lastLead.topic)) {
      const offerPayload = {
        topic: primaryTopicNow,
        when:  extractWhen(userText) || (await getBooking(chatId))?.when || "-"
      };
      await redis.set(PENDING_OFFER_KEY(chatId), JSON.stringify(offerPayload), { ex: 60 * 30 }); // 30 минут
    }

    // ===== Обычный ИИ-ответ с историей, на нужном языке =====
    const history = await getHistory(chatId);
    const languageLine = lang === "ru" ? "Отвечай на русском языке."
                      : lang === "kz" ? "Жауапты қазақ тілінде бер."
                      : "Reply in English.";

    let extraPolicy = "";
    if (lastLead) {
      extraPolicy += `
- Если недавно уже была передана заявка и текущий вопрос по той же теме — не предлагай новую заявку, просто консультируй.
- Если видишь НОВУЮ тему (другую, чем в последней заявке), сначала ответь по сути, затем одной короткой строкой уточни: «Оформить отдельную заявку по теме: "<тема>"?» и жди явного согласия.`;
    }

    const systemPrompt = baseSystemPrompt + "\n" + languageLine + "\n" + extraPolicy;
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
