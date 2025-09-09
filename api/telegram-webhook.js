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
const BOOK_KEY = (chatId) => `book:${chatId}`;
const CONTACT_KEY = (chatId) => `contact:${chatId}`;
const LAST_OFFER_KEY = (chatId) => `last_offer:${chatId}`; // { topic, ts }
const LAST_TS_KEY = (chatId) => `last_ts:${chatId}`;       // unix ms

// Настройки
const COMBINE_MULTI_TOPICS = true;        // объединять темы в одну заявку
const OFFER_COOLDOWN_MS = 75 * 1000;      // кулдаун оффера (мягкое приглашение)
const INACTIVITY_NUDGE_MS = 60 * 1000;    // авто-напоминание при молчании

// Локальный таймер на процесс (best-effort для non-serverless сред)
const NUDGE_TIMERS = new Map(); // chatId -> NodeJS.Timeout

/* =========================
   БЛОК УСЛУГ
   ========================= */
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
--- разработка и обучение ИИ чат-бота для быстрой обработки обращений клиентов 24/7;
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

/* Слоты заявки — добавили pendingTopics и offerCooldownTs */
async function getBooking(chatId) {
  const val = await redis.get(BOOK_KEY(chatId));
  if (!val) return { stage: null, topic: null, name: null, phone: null, pendingTopics: [], offerCooldownTs: 0 };
  if (typeof val === "object") return { pendingTopics: [], offerCooldownTs: 0, ...val };
  try {
    const parsed = JSON.parse(val);
    return { stage: null, topic: null, name: null, phone: null, pendingTopics: [], offerCooldownTs: 0, ...parsed };
  } catch {
    return { stage: null, topic: null, name: null, phone: null, pendingTopics: [], offerCooldownTs: 0 };
  }
}
async function setBooking(chatId, data) {
  await redis.set(BOOK_KEY(chatId), JSON.stringify(data), { ex: 60 * 60 * 24 });
}
async function clearBooking(chatId) {
  await redis.del(BOOK_KEY(chatId));
}

/* Контакт (кэш 30 дней) */
async function getContact(chatId) {
  const v = await redis.get(CONTACT_KEY(chatId));
  if (!v) return null;
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
}
async function setContact(chatId, { name, phone }) {
  await redis.set(CONTACT_KEY(chatId), JSON.stringify({ name, phone }), { ex: 60 * 60 * 24 * 30 });
}
async function clearContact(chatId) {
  await redis.del(CONTACT_KEY(chatId));
}

/* Последняя предложенная тема */
async function setLastOffer(chatId, topic) {
  const payload = { topic, ts: Date.now() };
  await redis.set(LAST_OFFER_KEY(chatId), JSON.stringify(payload), { ex: 60 * 30 });
}
async function getLastOffer(chatId) {
  const v = await redis.get(LAST_OFFER_KEY(chatId));
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
async function clearLastOffer(chatId) {
  await redis.del(LAST_OFFER_KEY(chatId));
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

/* Валидации и парсеры */
function phoneOk(t) { return ((t.match(/\d/g) || []).length) >= 6; }
function hasPhone(t) { return ((t.match(/\d/g) || []).length) >= 6; }
function pickPhone(t) {
  const m = t.match(/[\+\d][\d\-\s().]{5,}/g);
  if (!m) return null;
  return m.sort((a, b) => (b.match(/\d/g) || []).length - (a.match(/\d/g) || []).length)[0].trim();
}

/* Имя */
function isStrictNameToken(w) {
  return /^[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі\-]+$/iu.test(w);
}
function isNameLike(t) {
  if (!t) return false;
  if (/[!?]/.test(t)) return false;
  if ((t.match(/\d/g) || []).length > 0) return false;
  const words = t.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 2) return false;
  return words.every(isStrictNameToken);
}
function _cleanTail(str) {
  return (str || "").replace(/[.,;!?…]+$/u, "").trim();
}

/* Стоп-слова для имени */
const NAME_STOP = new Set([
  "телефон","тел","номер","phone","whatsapp","ватсап",
  "сайт","логотип","лого","таргет","реклама","смм","smm",
  "преза","презентация","консультация","заявка",
  "мне","нужно","нужна","нужен","нужны","сколько","цена","стоимость","делаете","можете","еще","ещё","стоит","только",
  "ок","окей","ага","угу","да"
]);

/* Нормализатор имени */
function normalizeName(name) {
  if (!name) return name;
  let s = String(name).trim();
  s = s.replace(/^\s*(меня\s+зовут|зовут|имя|name|my\s+name\s+is|атым|менің\s+атым)\s+/iu, "");
  s = s.replace(/\b([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ])([a-zа-яёәғқңөұүһі-]*)/giu,
    (_, a, b) => a.toUpperCase() + (b || "").toLowerCase()
  );
  return s.trim();
}

/* Извлечение имени (консервативное) */
function extractName(text) {
  if (!text) return null;
  const src = text.replace(/[\u00A0\u202F\u2009]/g, " ").replace(/\s+/g, " ").trim();

  const m1 = src.match(/\b(меня\s+зовут|зовут|имя|my\s+name\s+is|name|менің\s+атым|атым)\s+([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][\p{L}-]{2,}(?:\s+[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][\p{L}-]{2,})?)\b/iu);
  if (m1) {
    const cand = _cleanTail(m1[2]);
    const tokens = cand.split(/\s+/);
    if (tokens.every(t => !NAME_STOP.has(t.toLowerCase()))) return normalizeName(cand);
  }

  const m2 = src.match(/^(?:я|мен)\s*[—\-]?\s*([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][\p{L}-]{2,}(?:\s+[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][\p{L}-]{2,})?)(?:\b|$)/iu);
  if (m2) {
    const cand = _cleanTail(m2[1]);
    const tokens = cand.split(/\s+/);
    if (tokens.every(t => !NAME_STOP.has(t.toLowerCase()))) return normalizeName(cand);
  }

  // Разрешаем 1–2 токена имени только если в сообщении есть телефон
  if (hasPhone(src)) {
    const beforePhone = src.split(/[\+\d][\d\-\s().]{5,}/)[0] || src;
    const tokens = beforePhone.split(/[•,;\n]+/).join(" ").split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const last = tokens[i];
      if (!NAME_STOP.has(last.toLowerCase()) && isStrictNameToken(last)) {
        if (i - 1 >= 0 && !NAME_STOP.has(tokens[i - 1].toLowerCase()) && isStrictNameToken(tokens[i - 1])) {
          return normalizeName(`${tokens[i - 1]} ${last}`);
        }
        return normalizeName(last);
      }
    }
  }

  return null;
}

/* Темы */
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

// Маркеры замены/отмены прежних тем
const NEGATE_RE = /\b(нет|не\s*нужн[оа]|не\s*надо|не\s*то|не\s*это|не\s*интересует|только|лишь|скорее|лучше)\b/iu;

function guessTopicsAll(userText) {
  const u = (userText || "").toLowerCase();
  const set = new Set();
  for (const p of TOPIC_PATTERNS) if (p.re.test(u)) set.add(p.topic);
  return Array.from(set);
}

/* Автозаполнение из текущего сообщения + накопление тем */
async function tryAutofillFrom(chatId, booking, userText) {
  const nameHit = extractName(userText);
  if (!booking.name && nameHit && isNameLike(nameHit)) booking.name = nameHit;

  const phoneHit = pickPhone(userText);
  if (!booking.phone && phoneHit && phoneOk(phoneHit)) booking.phone = phoneHit;

  if (!Array.isArray(booking.pendingTopics)) booking.pendingTopics = [];
  const topicsHit = guessTopicsAll(userText);

  if (topicsHit.length) {
    if (NEGATE_RE.test(userText)) {
      booking.pendingTopics = Array.from(new Set(topicsHit));
      booking.topic = null;
    } else {
      const set = new Set(booking.pendingTopics);
      topicsHit.forEach(t => set.add(t));
      booking.pendingTopics = Array.from(set);
    }
    if (COMBINE_MULTI_TOPICS) {
      booking.topic = booking.pendingTopics.join(", ");
    } else if (!booking.topic && booking.pendingTopics.length) {
      booking.topic = booking.pendingTopics[0];
    }
  }

  return booking;
}

/* Проверки слотов */
function hasAllBookingFields(b) {
  const hasTopic = (b.topic && b.topic.trim().length) || (Array.isArray(b.pendingTopics) && b.pendingTopics.length);
  return !!(b && hasTopic && b.name && b.phone);
}
function decideNextStage(b) {
  if (!b.name) return "name";
  if (!b.phone) return "phone";
  return null;
}

/* Локализация */
const L = {
  hi: {
    ru: "Здравствуйте! Я ИИ-ассистент компании START. Чем могу помочь?",
    kz: "Сәлеметсіз бе! Мен START компаниясының ЖИ-көмекшісімін. Қалай көмектесе аламын?",
    en: "Hello! I’m START’s AI assistant. How can I help?",
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
    ru: "Передаю информацию менеджеру. Он свяжется с вами. Спасибо!",
    kz: "Ақпаратты менеджерге беремін. Ол сізбен хабарласады. Рахмет!",
    en: "I’m passing this to a manager. They’ll contact you. Thank you!",
  },
  resetDone: {
    ru: "История и запись очищены. Начнём заново.",
    kz: "Тарих пен жазылу тазартылды. Қайтадан бастайық.",
    en: "History and booking cleared. Let’s start over.",
  },
  nudgeNoContacts: {
    ru: "Вы можете написать своё Имя и Телефон, чтобы я отправил заявку специалисту. Или обратитесь к нам по телефону 87776662115. Не забудьте посетить наши сайты https://strateg.kz и http://aidarova.kz",
    kz: "Өтінішті жіберу үшін есіміңіз бен телефон нөміріңізді жаза аласыз. Немесе 87776662115 нөміріне қоңырау шалыңыз. Біздің сайттар: https://strateg.kz және http://aidarova.kz",
    en: "You can send your Name and Phone so I can submit a request to a specialist. Or call us at 87776662115. Also visit our websites: https://strateg.kz and http://aidarova.kz",
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
Кратко и по делу консультируй ТОЛЬКО по услугам из блока SERVICES_TEXT ниже, затем уместно предложи консультацию при интересе пользователя.
Не используй в приветствии слова «сегодня/today».
Никогда не проси/не упоминай время, дату или согласование времени. Этим займётся менеджер позже.
Если спрашивают про цены/сроки — отвечай, что расчёт индивидуальный после консультации (не выдумывай суммы/сроки).
Адрес: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Время работы: ${COMPANY_INFO.worktime}.
Полный перечень услуг: см. блок SERVICES_TEXT (используй ТОЛЬКО эти услуги).
`;

/* Админ / Telegram */
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
   NUDGE (60s) — планировщик/овердью
   ========================= */
async function scheduleNudge(chatId, lang) {
  // Сохраняем "последнюю активность" в Redis
  const now = Date.now();
  await redis.set(LAST_TS_KEY(chatId), String(now), { ex: 60 * 60 });

  // Сброс локального таймера
  if (NUDGE_TIMERS.has(chatId)) {
    clearTimeout(NUDGE_TIMERS.get(chatId));
  }

  // Новый таймер (best-effort)
  const t = setTimeout(async () => {
    try {
      const storedTs = await redis.get(LAST_TS_KEY(chatId));
      const contact = await getContact(chatId);
      if (!storedTs) return;
      const lastTs = Number(storedTs);
      if (Date.now() - lastTs < INACTIVITY_NUDGE_MS - 2000) return; // была активность
      if (contact && contact.phone) return; // контакты уже есть

      const booking = await getBooking(chatId);
      const msg = L.nudgeNoContacts[lang] || L.nudgeNoContacts.ru;
      await sendTG(chatId, msg);

      const topics = (booking && booking.pendingTopics && booking.pendingTopics.length)
        ? booking.pendingTopics.join(", ")
        : (booking && booking.topic) || null;

      if (topics) {
        const tail = (lang === "kz")
          ? `\n\nҚаласаңыз, ${topics} бойынша консультацияға жазамын. Есіміңіз бен телефонды жазыңыз.`
          : (lang === "en")
          ? `\n\nIf you want, I can arrange a consultation on: ${topics}. Send your Name and Phone.`
          : `\n\nЕсли хотите, оформлю консультацию по теме: ${topics}. Напишите Имя и Телефон.`;
        await sendTG(chatId, tail);
      }
    } catch (e) {
      console.error("nudge timer error", e);
    } finally {
      NUDGE_TIMERS.delete(chatId);
    }
  }, INACTIVITY_NUDGE_MS);

  NUDGE_TIMERS.set(chatId, t);
}

async function maybeFireOverdueNudge(chatId, lang) {
  // Для serverless: если таймер не сработал — отправим «лениво» при следующем апдейте
  const storedTs = await redis.get(LAST_TS_KEY(chatId));
  if (!storedTs) return;
  const lastTs = Number(storedTs);
  if (Date.now() - lastTs < INACTIVITY_NUDGE_MS) return;

  const contact = await getContact(chatId);
  if (contact && contact.phone) return;

  const booking = await getBooking(chatId);
  const msg = L.nudgeNoContacts[lang] || L.nudgeNoContacts.ru;
  await sendTG(chatId, msg);

  const topics = (booking && booking.pendingTopics && booking.pendingTopics.length)
    ? booking.pendingTopics.join(", ")
    : (booking && booking.topic) || null;

  if (topics) {
    const tail = (lang === "kz")
      ? `\n\nҚаласаңыз, ${topics} бойынша консультацияға жазамын. Есіміңіз бен телефонды жазыңыз.`
      : (lang === "en")
      ? `\n\nIf you want, I can arrange a consultation on: ${topics}. Send your Name and Phone.`
      : `\n\nЕсли хотите, оформлю консультацию по теме: ${topics}. Напишите Имя и Телефон.`;
    await sendTG(chatId, tail);
  }

  // Обновляем last_ts, чтобы не спамить
  await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
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

    // Язык на ранней стадии (нужен для «ленивого» нуджа)
    const currentLangStored = (await redis.get(LANG_KEY(chatId))) || detectLang(userText) || "ru";

    // «Ленивый» нудж, если прошлый таймер не отработал и есть просрочка
    await maybeFireOverdueNudge(chatId, currentLangStored);

    // Обновим маркер активности и поставим нудж-таймер (если контактов нет)
    const contactAtStart = await getContact(chatId);
    if (!contactAtStart || !contactAtStart.phone) {
      await scheduleNudge(chatId, currentLangStored);
    } else {
      if (NUDGE_TIMERS.has(chatId)) {
        clearTimeout(NUDGE_TIMERS.get(chatId));
        NUDGE_TIMERS.delete(chatId);
      }
      await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
    }

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
      await redis.del(BOOK_KEY(chatId));
      await clearContact(chatId);
      await clearLastOffer(chatId);
      await redis.del(LAST_TS_KEY(chatId));
      if (NUDGE_TIMERS.has(chatId)) {
        clearTimeout(NUDGE_TIMERS.get(chatId));
        NUDGE_TIMERS.delete(chatId);
      }
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

    /* Слоты/контакты */
    const booking = await getBooking(chatId);
    const contact = (await getContact(chatId)) || {};
    let handled = false;
    let preReply = null;

    // Подхват из текущего сообщения (имя/тел/темы)
    await tryAutofillFrom(chatId, booking, userText);

    // Если пользователь отрицанием заменил темы — мягко подтвердим переключение
    if (NEGATE_RE.test(userText) && guessTopicsAll(userText).length) {
      const newLabel = COMBINE_MULTI_TOPICS
        ? Array.from(new Set(guessTopicsAll(userText))).join(", ")
        : guessTopicsAll(userText)[0];

      const confirmSwitch =
        lang === "kz"
          ? `Түсіндім: ${newLabel} керек.`
          : (lang === "en"
              ? `Got it: focusing on ${newLabel}.`
              : `Понял: переключаюсь на «${newLabel}».`);

      await sendTG(chatId, confirmSwitch);
      await pushHistory(chatId, "assistant", confirmSwitch);
      await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
    }

    // 0) Первое сообщение — фиксированное приветствие
    const historyBefore = await getHistory(chatId);
    if (historyBefore.length === 0) {
      const hi = L.hi[lang] || L.hi.ru;
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", hi);
      await sendTG(chatId, hi);
      await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // ===== «УМНОЕ СОГЛАСИЕ» =====
    const consentRe = /\b(давайте|давай|хочу|нужно|нужна|нужен|оформим|оформить|готов|интересует\s*консультац|поехали|запишите|записать|ну\s*да|ага|угу|ок|окей|ok|okey|хорошо|go|да|yes|иә|ия)\b/iu;
    if (consentRe.test(userText)) {
      let topicToBook = null;

      // 1) свежий last_offer
      const offer = await getLastOffer(chatId);
      const fresh = offer && (Date.now() - (offer.ts || 0) < 10 * 60 * 1000);
      if (fresh && offer.topic) topicToBook = offer.topic;

      // 2) если нет last_offer — из букинга/истории
      if (!topicToBook) {
        const pending = Array.isArray(booking.pendingTopics) ? booking.pendingTopics : [];
        if (pending.length) {
          topicToBook = COMBINE_MULTI_TOPICS ? pending.join(", ") : pending[0];
        } else {
          const hist = await getHistory(chatId);
          const prevUser = [...hist].filter(h => h.role === "user").slice(-1)[0]?.content || "";
          const prevA    = [...hist].filter(h => h.role === "assistant").slice(-1)[0]?.content || "";
          const fromUser = guessTopicsAll(prevUser);
          const fromA    = guessTopicsAll(prevA);
          let picked     = (fromUser.length ? fromUser : fromA);
          if (!picked.length && /(през(а|у|ку|ка)|презент(?![а-я]))/i.test(prevUser)) picked = ["Презентация проекта"];
          if (picked.length) {
            topicToBook = COMBINE_MULTI_TOPICS ? picked.join(", ") : picked[0];
            await setLastOffer(chatId, picked[0]);
          }
        }
      }

      if (topicToBook) {
        let finalName  = (contact && contact.name)  || booking.name  || extractName(userText);
        let finalPhone = (contact && contact.phone) || booking.phone || pickPhone(userText);
        if (finalName) finalName = normalizeName(finalName);
        if (finalName && NAME_STOP.has(finalName.toLowerCase())) finalName = null;

        if (finalName && isNameLike(finalName) && finalPhone && phoneOk(finalPhone)) {
          await sendLead(chatId, topicToBook, finalName, finalPhone);
          await setContact(chatId, { name: finalName, phone: finalPhone });
          // очистка слотов/офферов
          booking.pendingTopics = [];
          booking.topic = null;
          booking.stage = null;
          await setBooking(chatId, booking);
          await clearLastOffer(chatId);
          preReply = L.booked[lang] || L.booked.ru;

          await pushHistory(chatId, "user", userText);
          await pushHistory(chatId, "assistant", preReply);
          await sendTG(chatId, preReply);
          await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true }));
        } else {
          // не хватает данных — дособираем
          booking.topic = topicToBook;
          booking.stage = decideNextStage({
            ...booking,
            name:  finalName  || booking.name,
            phone: finalPhone || booking.phone,
          }) || "name";
          await setBooking(chatId, booking);
          preReply = (!booking.name && !finalName)
            ? (L.askOnlyName[lang]  || L.askOnlyName.ru)
            : (L.askOnlyPhone[lang] || L.askOnlyPhone.ru);
          handled = true;
        }
      }
    }

    // 1) Телефон в сообщении — пытаемся закрыть лид (темы уже накоплены)
    if (!handled && hasPhone(userText)) {
      booking.phone = pickPhone(userText) || booking.phone;

      if (!(contact && contact.name)) {
        const n = extractName(userText);
        if (n && isNameLike(n)) booking.name = n;
      }

      if (!booking.topic && booking.pendingTopics.length === 0) booking.topic = "Консультация";

      if (hasAllBookingFields(booking)) {
        const namestr  = normalizeName(booking.name);
        const phonestr = booking.phone;
        const topicsStr =
          (Array.isArray(booking.pendingTopics) && booking.pendingTopics.length)
            ? (COMBINE_MULTI_TOPICS ? booking.pendingTopics.join(", ") : booking.pendingTopics[0])
            : (booking.topic || "Консультация");

        await sendLead(chatId, topicsStr, namestr, phonestr);
        await setContact(chatId, { name: namestr, phone: phonestr });
        booking.pendingTopics = [];
        booking.topic = null;
        booking.stage = null;
        await setBooking(chatId, booking);

        preReply = L.booked[lang] || L.booked.ru;
        handled = true;
      } else {
        const next = decideNextStage(booking);
        booking.stage = next || "name";
        await setBooking(chatId, booking);
        preReply = (booking.stage === "name")
          ? (L.askOnlyName[lang] || L.askOnlyName.ru)
          : (L.askOnlyPhone[lang] || L.askOnlyPhone.ru);
        handled = true;
      }
    }

    // 2) Стадия name
    if (!handled && booking.stage === "name") {
      if (contact && contact.name && contact.phone) {
        const namestr  = normalizeName(contact.name);
        const phonestr = contact.phone;
        const topicsStr =
          (Array.isArray(booking.pendingTopics) && booking.pendingTopics.length)
            ? (COMBINE_MULTI_TOPICS ? booking.pendingTopics.join(", ") : booking.pendingTopics[0])
            : (booking.topic || "Консультация");

        await sendLead(chatId, topicsStr, namestr, phonestr);
        booking.pendingTopics = [];
        booking.topic = null;
        booking.stage = null;
        await setBooking(chatId, booking);

        preReply = L.booked[lang] || L.booked.ru;
        handled = true;
      } else if (isNameLike(userText)) {
        booking.name = normalizeName(userText.trim());
        const namestr  = booking.name || (contact && normalizeName(contact.name));
        const phonestr = booking.phone || (contact && contact.phone);

        if (namestr && phonestr) {
          const topicsStr =
            (Array.isArray(booking.pendingTopics) && booking.pendingTopics.length)
              ? (COMBINE_MULTI_TOPICS ? booking.pendingTopics.join(", ") : booking.pendingTopics[0])
              : (booking.topic || "Консультация");

          await sendLead(chatId, topicsStr, namestr, phonestr);
          await setContact(chatId, { name: namestr, phone: phonestr });
          booking.pendingTopics = [];
          booking.topic = null;
          booking.stage = null;
          await setBooking(chatId, booking);

          preReply = L.booked[lang] || L.booked.ru;
        } else {
          booking.stage = "phone";
          await setBooking(chatId, booking);
          preReply = L.askOnlyPhone[lang] || L.askOnlyPhone.ru;
        }
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

    // 3) Стадия phone
    if (!handled && booking.stage === "phone") {
      if (contact && contact.phone && (booking.name || contact.name)) {
        const namestr  = normalizeName(booking.name || contact.name);
        const phonestr = contact.phone;
        const topicsStr =
          (Array.isArray(booking.pendingTopics) && booking.pendingTopics.length)
            ? (COMBINE_MULTI_TOPICS ? booking.pendingTopics.join(", ") : booking.pendingTopics[0])
            : (booking.topic || "Консультация");

        await sendLead(chatId, topicsStr, namestr, phonestr);
        await setContact(chatId, { name: namestr, phone: phonestr });
        booking.pendingTopics = [];
        booking.topic = null;
        booking.stage = null;
        await setBooking(chatId, booking);

        preReply = L.booked[lang] || L.booked.ru;
        handled = true;
      } else if (phoneOk(userText)) {
        booking.phone = pickPhone(userText) || userText;
        const namestr  = normalizeName(booking.name || (contact && contact.name));
        const phonestr = booking.phone;

        if (namestr && phonestr) {
          const topicsStr =
            (Array.isArray(booking.pendingTopics) && booking.pendingTopics.length)
              ? (COMBINE_MULTI_TOPICS ? booking.pendingTopics.join(", ") : booking.pendingTopics[0])
              : (booking.topic || "Консультация");

          await sendLead(chatId, topicsStr, namestr, phonestr);
          await setContact(chatId, { name: namestr, phone: phonestr });
          booking.pendingTopics = [];
          booking.topic = null;
          booking.stage = null;
          await setBooking(chatId, booking);

          preReply = L.booked[lang] || L.booked.ru;
        } else {
          booking.stage = "name";
          await setBooking(chatId, booking);
          preReply = L.askOnlyName[lang] || L.askOnlyName.ru;
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

    /* Если слоты что-то ответили — отправим preReply */
    if (handled && preReply) {
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    /* ===== ИИ-ответ + мягкий оффер (с кулдауном) ===== */
    const history = await getHistory(chatId);
    const languageLine = lang === "ru"
      ? "Отвечай на русском языке."
      : lang === "kz"
      ? "Жауапты қазақ тілінде бер."
      : "Reply in English.";

    const systemPrompt = `${baseSystemPrompt}\n\n=== SERVICES_TEXT START ===\n${SERVICES_TEXT}\n=== SERVICES_TEXT END ===\n${languageLine}`;

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

    const replyTopics = guessTopicsAll(reply);
    const topicsNow = guessTopicsAll(userText);

    const now = Date.now();
    if (!booking.offerCooldownTs) booking.offerCooldownTs = 0;

    // Показываем оффер только если кулдаун прошёл
    const canOffer = (now - (booking.offerCooldownTs || 0)) >= OFFER_COOLDOWN_MS;

    if (canOffer && !booking.stage && topicsNow.length > 0) {
      const topicLabel = COMBINE_MULTI_TOPICS ? topicsNow.join(", ") : topicsNow[0];

      const offerLine = (contact && contact.phone)
        ? (
            lang === "ru"
              ? `\n\nЕсли хотите, оформлю консультацию по теме: ${topicLabel}. Просто напишите «Да».`
              : lang === "kz"
              ? `\n\nҚаласаңыз, ${topicLabel} бойынша консультацияға жазамын. Жай ғана «Иә» деп жазыңыз.`
              : `\n\nIf you want, I’ll arrange a consultation on: ${topicLabel}. Just reply “Yes”.`
          )
        : (
            lang === "ru"
              ? `\n\nЕсли хотите, оформлю консультацию по теме: ${topicLabel}. Для этого отправьте Имя и Телефон.`
              : lang === "kz"
              ? `\n\nҚаласаңыз, ${topicLabel} бойынша консультацияға жазамын. Аты-жөніңіз бен Телефон нөміріңізді жазыңыз.`
              : `\n\nIf you want, I can arrange a consultation on: ${topicLabel}. You can send your Name and Phone.`
          );

      reply = (reply || "").trim() + offerLine;

      // фикс: НЕ пишем booking.topic тут; темы копятся в pendingTopics в tryAutofillFrom
      await setLastOffer(chatId, topicsNow[0]);

      // обновляем кулдаун
      booking.offerCooldownTs = now;
      await setBooking(chatId, booking);
    } else if (canOffer && !booking.stage && topicsNow.length === 0 && replyTopics.length === 1) {
      // Пользователь явно тему не назвал, но ассистент — да. Только обновим last_offer.
      await setLastOffer(chatId, replyTopics[0]);
      booking.offerCooldownTs = now;
      await setBooking(chatId, booking);
    }

    if (!reply || reply.trim().length < 3) {
      reply = (lang === "ru")
        ? "Готово. Чем ещё помочь?"
        : lang === "kz"
        ? "Дайын. Тағы не көмектесейін?"
        : "All set. How else can I help?";
    }

    await pushHistory(chatId, "user", userText);
    await pushHistory(chatId, "assistant", reply);
    await sendTG(chatId, reply);

    // продлим маркер активности
    await redis.set(LAST_TS_KEY(chatId), String(Date.now()), { ex: 60 * 60 });

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}

/* =========================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
   ========================= */

// единая отправка заявки админу
async function sendLead(chatId, topic, name, phone) {
  const adminId = getAdminId();
  const finalTopic = topic || "Консультация";
  const finalNameSafe = normalizeName(name || "");
  if (adminId) {
    const adminMsg =
      `🆕 Новая заявка чатбота:\n` +
      `Тема: ${finalTopic}\n` +
      `Имя: ${finalNameSafe || "-"}\n` +
      `Телефон: ${phone || "-"}\n` +
      `Источник: tg chat_id ${chatId}`;
    await sendTG(adminId, adminMsg);
  } else {
    console.error("ADMIN_CHAT_ID is not set or empty");
  }
}
