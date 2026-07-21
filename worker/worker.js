const ALLOWED_ORIGINS = new Set([
  "https://despositoz.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

const MODEL = "gemini-3.1-flash-lite";
const MIN_DRAFT_LENGTH = 20;
const MAX_DRAFT_LENGTH = 2000;

const SYSTEM_INSTRUCTION = `Ты — редактор личного кинодневника. Преврати черновые заметки пользователя в цельную короткую запись от первого лица. Это не профессиональная рецензия, а спокойный текст для себя.

Жёсткие правила:
1. Используй только факты, мнения, имена и оценки из черновика. Не добавляй детали сюжета, объяснения, собственные выводы или знания о фильме. Не достраивай, кто что сделал, узнал или почувствовал, и не придумывай причинные связи.
2. Черновик может состоять из разделов «Понравилось», «Не понравилось» и «Запомнилось». Смысл этих разделов — позиция самого пользователя, даже если внутри остались чужие формулировки вроде «зрители отмечают» или «критики считают».
3. Выбери 2–3 самые конкретные и важные мысли. Не пересказывай каждый пункт по очереди и не пытайся сохранить весь черновик.
4. Перепиши мысли как личное впечатление от первого лица: «мне понравилось», «для меня», «мне показалось». Убирай заголовки категорий, перечисления и ссылки на зрителей, критиков или «многих».
5. Свяжи выбранные мысли в один естественный текст. Можно заметно перестраивать предложения, сокращать повторы и менять порядок, но нельзя менять смысл. Имена, названия и описание конкретных сцен сохраняй максимально близко к исходной формулировке.
6. Пиши просто и разговорно, короткими предложениями. Не используй критические красивости и не добавляй сленг или разговорные усилители, которых не было у пользователя: «круто», «кайф», «вайб», «топ» и подобные.
7. Не используй штампы и AI-канцелярит: «погружает в атмосферу», «оставляет неизгладимое впечатление», «фильм, который заставляет задуматься», «с одной стороны... с другой стороны», «в заключение хочется сказать» и подобное.
8. Если материала достаточно, напиши 70–130 слов, но никогда не раздувай короткий черновик. Результат не должен быть длиннее исходника.
9. Пиши на языке черновика. Не используй эмодзи, если их не было у пользователя.
10. Не начинай с «Этот фильм» или «Недавно посмотрел». Сразу начни с главного личного впечатления. Не добавляй формальный вывод с оборотами «в итоге», «в целом» или «в заключение».
11. Верни только готовый текст без заголовка, пояснений, кавычек и подписи.

Не делай поверхностную замену слов и не склеивай все пункты. Сначала выбери главное, затем собери из него самостоятельную связную запись. Если черновик слишком короткий или бессвязный, только минимально исправь грамматику.`;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(origin, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function meaningfulLength(value) {
  return value.replace(/\s/g, "").length;
}

function userPrompt(draft) {
  return `<draft>\n${draft}\n</draft>`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.has(origin))
      return new Response("Forbidden", { status: 403 });

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/review")
      return json(origin, 404, { error: "Маршрут не найден.", code: "not_found" });

    if (!env.GEMINI_API_KEY)
      return json(origin, 503, { error: "Gemini не настроен.", code: "unavailable" });

    let input;
    try {
      input = await request.json();
    } catch (_) {
      return json(origin, 400, { error: "Некорректный запрос.", code: "invalid_request" });
    }

    const draft = typeof input.draft === "string" ? input.draft.trim() : "";
    const length = meaningfulLength(draft);
    if (length < MIN_DRAFT_LENGTH)
      return json(origin, 400, { error: "Черновик слишком короткий.", code: "draft_too_short" });
    if (draft.length > MAX_DRAFT_LENGTH)
      return json(origin, 413, { error: "Черновик слишком длинный.", code: "draft_too_long" });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: userPrompt(draft) }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      return json(origin, timedOut ? 408 : 503, {
        error: timedOut ? "Gemini не успел ответить." : "Gemini временно недоступен.",
        code: timedOut ? "timeout" : "unavailable",
      });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const limited = response.status === 429;
      return json(origin, limited ? 429 : 503, {
        error: limited ? "Исчерпан лимит Gemini." : "Gemini временно недоступен.",
        code: limited ? "limit" : "unavailable",
      });
    }

    const review = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!review)
      return json(origin, 503, { error: "Gemini не вернул текст.", code: "unavailable" });

    return json(origin, 200, { review });
  },
};
