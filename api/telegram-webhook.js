import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Читаем сырое тело запроса (нужно в serverless)
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    // Проверка секрета Telegram (мы зададим его при setWebhook)
    const hdr = req.headers["x-telegram-bot-api-secret-token"];
    if (!hdr || hdr !== process.env.TELEGRAM_SECRET_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    const raw = await readBody(req);
    const update = raw ? JSON.parse(raw) : {};
    const message = update.message || update.edited_message;

    if (!message || !message.text) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    }

    const chatId = message.chat.id;
    const userText = (message.text || "").trim();

const systemPrompt = `
Ты — ИИ-ассистент компании START (г. Астана), консалтинг по созданию/развитию бизнеса, маркетинг, финансы, автоматизация, сайты, внедрения ИИ и пр. 
Стиль: деловой, дружелюбный, до 5 предложений. 
Важное:
- Уважай контекст предыдущих сообщений.
- Если пользователь просит консультацию, последовательно собери данные: {тема/интерес, дата/время, имя, телефон/WhatsApp}. 
  Не спрашивай уже собранное повторно. После сбора — кратко подтверди и спроси «всё верно?».
- Если вопрос вне тем компании START — ответь нейтрально и предложи подключить менеджера.
- Ссылку на сайт компании START (strateg.kz) давай только по прямому запросу. Но сам бери с этого сайта инфу по услугам, адресу и контактам.
`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      temperature: 0.2
    });

    const reply =
      completion.choices?.[0]?.message?.content?.slice(0, 3500) ||
      "Готово. Какой следующий вопрос?";

    const tgResp = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply })
      }
    );

    if (!tgResp.ok) {
      console.error("Telegram sendMessage error", await tgResp.text());
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("Internal Error");
  }
}
