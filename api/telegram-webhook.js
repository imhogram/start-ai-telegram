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
  if (typeof item === "object") return item; // уже объект
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
    return { stage: null, topic: null, when: null, name: null, phone: null };
  }
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

// ==== Детект языка (ru/kz/en) ====
function detectLang(text) {
  const hasKaz = /[әғқңөұүһі]/i.test(text);
  const hasCyr = /[ЁёА-Яа-яІіЇїЪъЫыЭэЙй]/.test(text) || /[А-Яа-я]/.test(text);
  if (hasKaz) return "kz";
  if (hasCyr) return "ru";
  return "en";
}

// ==== Локализация служебных фраз ====
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
    ru: `Подтверждаю запись:
— Тема: ${b.topic}
— Время: ${b.when}
— Имя: ${b.name}
— Контакт: ${b.phone}
Все верно? Если да — напишите «да», я передам менеджеру.`,
    kz: `Жазылуды растаймын:
— Тақырып: ${b.topic}
— Уақыты: ${b.when}
— Есім: ${b.name}
— Байланыс: ${b.phone}
Дұрыс па? Иә болса — «иә» деп жазыңыз, менеджерге беремін.`,
    en: `Confirming your booking:
— Topic: ${b.topic}
— Time: ${b.when}
— Name: ${b.name}
— Contact: ${b.phone}
Is this correct? If yes, please reply “yes” and I’ll notify a manager.`
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

// ==== Базовый системный промпт (общий, язык подмешиваем ниже) ====
const baseSystemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана): консалтинг по созданию/развитию бизнеса, маркетинг, IT-разработки, сайты, автоматизация, внедрения ИИ и прочее, указанное на https://strateg.kz/.
Стиль: деловой, дружелюбный, 1–5 предложений, без лишней воды.
Правила:
- Уважай контекст последних сообщений (история диалога).
- Если пользователю нужна консультация — собери: {тема, время, имя, телефон}. После сбора подтверди и передай менеджеру.
- Если вопрос о ценах или сроках — говори, что расчёт индивидуальный после консультации; не выдумывай суммы и сроки.
- Адрес компании фиксированный: ${COMPANY_INFO.address}. Телефон: ${COMPANY_INFO.phone}. Рабочее время: ${COMPANY_INFO.worktime}. Используй только это, ничего не выдумывай.
- Ссылку на сайт strateg.kz давай по запросу или если логично по ходу беседы. Для уточнения услуг черпай информацию только оттуда.
- Если вопрос вне тем бизнеса START — ответь нейтрально и предложи подключить менеджера или отправь ссылку на сайт.
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
    // 1) /lang <code>
    if (/^\/lang\b/i.test(userText)) {
      const parts = userText.split(/\s+/);
      const code = (parts[1] || "").toLowerCase();
      if (code === "ru" || code === "kz" || code === "en") {
        await redis.set(LANG_KEY(chatId), code, { ex: 60 * 60 * 24 * 30 });
        const msg = L.langSet(code);
        await sendTG(chatId, msg);
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true }));
      } else {
        const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText);
        await sendTG(chatId, L.unknownLang[current] || L.unknownLang.en);
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true }));
      }
    }

    // 2) /reset — очистка истории/слотов
    if (userText === "/reset") {
      await redis.del(`hist:${chatId}`);
      await redis.del(`book:${chatId}`);
      const current = (await redis.get(LANG_KEY(chatId))) || detectLang(userText);
      await sendTG(chatId, L.resetDone[current] || L.resetDone.en);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // 3) Вычисляем язык (приоритет: сохранённый → авто-детект текущего текста)
    let lang = (await redis.get(LANG_KEY(chatId))) || detectLang(userText);
    // Обновим TTL языка на месяц
    await redis.set(LANG_KEY(chatId), lang, { ex: 60 * 60 * 24 * 30 });

    // ===== Слоты записи =====
    const booking = await getBooking(chatId);
    let handled = false;
    let preReply = null;

    const yesRegex = lang === "ru" ? /^да\b/i : lang === "kz" ? /^(иә|иа|ия)\b/i : /^yes\b/i;
    const bookTrigger = /консультац|запис|қабылда|кеңес|consult|booking/i;

    if (!booking.stage && bookTrigger.test(userText)) {
      booking.stage = "topic";
      await setBooking(chatId, booking);
      preReply = L.startBooking[lang] || L.startBooking.en;
      handled = true;
    } else if (booking.stage === "topic" && userText.length > 1) {
      booking.topic = userText;
      booking.stage = "when";
      await setBooking(chatId, booking);
      preReply = L.askWhen[lang] || L.askWhen.en;
      handled = true;
    } else if (booking.stage === "when" && userText.length > 1) {
      booking.when = userText;
      booking.stage = "name";
      await setBooking(chatId, booking);
      preReply = L.askName[lang] || L.askName.en;
      handled = true;
    } else if (booking.stage === "name" && userText.length > 1) {
      booking.name = userText;
      booking.stage = "phone";
      await setBooking(chatId, booking);
      preReply = L.askPhone[lang] || L.askPhone.en;
      handled = true;
    } else if (booking.stage === "phone" && /[\d+\-\s()]{6,}/.test(userText)) {
      booking.phone = userText;
      booking.stage = "confirm";
      await setBooking(chatId, booking);
      preReply = (L.confirm(booking, lang)) || L.confirm(booking, "en");
      handled = true;
    } else if (booking.stage === "confirm" && yesRegex.test(userText)) {
      preReply = L.booked[lang] || L.booked.en;
      await clearBooking(chatId);
      handled = true;
    }

    if (handled && preReply) {
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);
      await sendTG(chatId, preReply);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Обычный ИИ-ответ с историей, на нужном языке =====
    const history = await getHistory(chatId);
    const languageLine = lang === "ru"
      ? "Отвечай на русском языке."
      : lang === "kz"
      ? "Жауапты қазақ тілінде бер."
      : "Reply in English.";

    const systemPrompt = baseSystemPrompt + "\n" + languageLine;

    // Приветствие по умолчанию, если юзер только начал
    const maybeHi = history.length === 0 ? (L.hi[lang] || L.hi.en) : null;

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

    // Если это первый ответ — вставим наше приветствие, если модель не сказала ничего
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
async function sendTG(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
