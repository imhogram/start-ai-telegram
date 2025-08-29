import OpenAI from "openai";
import { Redis } from "@upstash/redis";

// ==== Инициализация клиентов ====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ==== Константы ====
const HISTORY_LEN = 8; // храним последние 8 сообщений (user/assistant по очереди)

// ==== Утилита чтения "сырого" тела запроса (нужно для serverless на Vercel) ====
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ==== Работа с историей диалога ====
async function getHistory(chatId) {
  const items = await redis.lrange(`hist:${chatId}`, -HISTORY_LEN, -1);
  return (items || []).map(x => JSON.parse(x));
}
async function pushHistory(chatId, role, content) {
  await redis.rpush(`hist:${chatId}`, JSON.stringify({ role, content }));
  await redis.ltrim(`hist:${chatId}`, -HISTORY_LEN, -1);
}

// ==== Простая "машина состояний" записи на консультацию (слоты) ====
async function getBooking(chatId) {
  return (
    (await redis.get(`book:${chatId}`)) || {
      stage: null,
      topic: null,
      when: null,
      name: null,
      phone: null,
    }
  );
}
async function setBooking(chatId, data) {
  // TTL 1 день
  await redis.set(`book:${chatId}`, data, { ex: 60 * 60 * 24 });
}
async function clearBooking(chatId) {
  await redis.del(`book:${chatId}`);
}

// ==== Системный промпт ====
const systemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана), консалтинг по созданию/развитию бизнеса, маркетинг, финансы, автоматизация, сайты, внедрения ИИ и пр. 
Стиль: деловой, дружелюбный, до 5 предложений. 
Важное:
- Уважай контекст предыдущих сообщений.
- Если пользователь просит консультацию, последовательно собери данные: {тема/интерес, дата/время, имя, телефон/WhatsApp}. 
  Не спрашивай уже собранное повторно. После сбора — кратко подтверди и спроси «всё верно?».
- Если вопрос вне тем компании START — ответь нейтрально и предложи подключить менеджера.
- Ссылку на сайт компании strateg.kz давай по запросу. Но сам бери с этого сайта инфу для подробного ответа клиентам по услугам, адресу и контактам.
- Рабочее время для предварительной записи с 10:00 до 18:00, рабочие дни с Пн по Пт.
`;

// ==== Основной обработчик вебхука ====
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    // Проверка секрета Telegram (должен совпадать с ?secret_token= при setWebhook)
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (!headerSecret || headerSecret !== process.env.TELEGRAM_SECRET_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    // Парсим апдейт от Telegram
    const raw = await readBody(req);
    const update = raw ? JSON.parse(raw) : {};
    const message = update.message || update.edited_message || null;

    // Обрабатываем только текстовые сообщения
    if (!message || !message.text) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    const chatId = message.chat.id;
    const userText = (message.text || "").trim();

    // ===== Мини-роутер: слоты записи на консультацию =====
    const booking = await getBooking(chatId);
    let handled = false;
    let preReply = null;

    // Триггер начала записи
    if (!booking.stage && /консультац|запис/iu.test(userText)) {
      booking.stage = "topic";
      await setBooking(chatId, booking);
      preReply =
        "Прекрасно! Уточните, по какому вопросу нужна консультация (например: таргет, ИИ-бот, сайт/воронка, стратегия)?";
      handled = true;
    }
    // Слоты: topic -> when -> name -> phone -> confirm
    else if (booking.stage === "topic" && userText.length > 1) {
      booking.topic = userText;
      booking.stage = "when";
      await setBooking(chatId, booking);
      preReply = "Принято. Когда вам удобно? Напишите дату/время (например, завтра в 11:00).";
      handled = true;
    } else if (booking.stage === "when" && userText.length > 1) {
      booking.when = userText;
      booking.stage = "name";
      await setBooking(chatId, booking);
      preReply = "Отлично. Как к вам обращаться?";
      handled = true;
    } else if (booking.stage === "name" && userText.length > 1) {
      booking.name = userText;
      booking.stage = "phone";
      await setBooking(chatId, booking);
      preReply = "Спасибо. Оставьте, пожалуйста, номер телефона или WhatsApp.";
      handled = true;
    } else if (booking.stage === "phone" && /[\d+\-\s()]{6,}/.test(userText)) {
      booking.phone = userText;
      booking.stage = "confirm";
      await setBooking(chatId, booking);
      preReply = `Подтверждаю запись:
— Тема: ${booking.topic}
— Время: ${booking.when}
— Имя: ${booking.name}
— Контакт: ${booking.phone}
Все верно? Если да — напишите «да», я передам менеджеру.`;
      handled = true;
    } else if (booking.stage === "confirm" && /^да\b/iu.test(userText)) {
      // TODO: здесь позже добавим отправку в Bitrix24 (лид/задача/OL)
      preReply =
        "Передаю информацию менеджеру. Он свяжется с вами для подтверждения. Спасибо!";
      await clearBooking(chatId);
      handled = true;
    }

    // Если обработали внутри "слотов" — отвечаем без вызова модели
    if (handled && preReply) {
      await pushHistory(chatId, "user", userText);
      await pushHistory(chatId, "assistant", preReply);

      await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: preReply }),
        }
      );

      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    // ===== Иначе — обычный ИИ-ответ с учетом истории =====
    const history = await getHistory(chatId);

    const messages = [
      { role: "system", content: systemPrompt },
      ...history, // 6–8 последних реплик
      { role: "user", content: userText },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.slice(0, 3500) ||
      "Готово. Какой следующий вопрос?";

    // Сохраняем историю
    await pushHistory(chatId, "user", userText);
    await pushHistory(chatId, "assistant", reply);

    // Отправляем ответ пользователю
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply }),
      }
    );

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}
