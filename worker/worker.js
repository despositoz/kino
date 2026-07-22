const ALLOWED_ORIGINS = new Set([
  "https://despositoz.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

const MODEL = "gemini-3.1-flash-lite";
const MIN_DRAFT_LENGTH = 20;
const MAX_DRAFT_LENGTH = 2000;
const MAX_FEED_STATS_LENGTH = 4000;

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

const SYSTEM_INSTRUCTION_FEED = `Ты находишь одно конкретное наблюдение в сводной статистике личного кинодневника и обращаешься к его владельцу на «ты».

Жёсткие правила:
1. Используй только значения из блока <stats>. Не добавляй фильмы, жанры, оценки, привычки, причины или предпочтения, которых нет в данных.
2. Это агрегированная статистика, а не просьба о совете. Не рекомендуй конкретные фильмы и не пересказывай все поля по очереди.
3. Выбери одну небанальную, но прямо подтверждаемую цифрами связь: например, разницу между критериями, повторяющийся жанр или сочетание частоты и высокой оценки.
4. Напиши 1–2 коротких предложения на русском языке. Обращайся на «ты», говори спокойно и конкретно.
5. Не используй критические красивости, эмодзи, восклицательные знаки и AI-канцелярит: «погружает в атмосферу», «оставляет неизгладимое впечатление», «заставляет задуматься», «с одной стороны... с другой стороны», «в заключение хочется сказать», «уникальный вкус», «кинематографическое путешествие» и подобное.
6. Не утверждай, почему пользователь ставит оценки. Можно говорить только о самой закономерности: «выше всего ты оцениваешь...», «в дневнике чаще встречается...», «между оценками почти нет разницы».
7. Названия фильмов и жанров копируй точно. Не исправляй и не дополняй их по памяти.
8. Верни только готовый текст без заголовка, кавычек, списков и пояснений.`;

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

function compactText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function finiteNumber(value, min, max, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Number(number.toFixed(digits));
}

function normalizeFeedStats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const total = Math.trunc(Number(value.total));
  if (!Number.isFinite(total) || total < 3 || total > 100000) return null;

  const averages = Array.isArray(value.averages)
    ? value.averages.slice(0, 5).map((item) => {
      const criterion = compactText(item?.criterion, 80);
      const average = finiteNumber(item?.average, 0, 10);
      return criterion && average !== null ? { criterion, average } : null;
    }).filter(Boolean)
    : [];
  if (!averages.length) return null;

  const stats = { total, averages };
  const frequentGenre = compactText(value.mostFrequentGenre?.genre, 60);
  const frequentCount = Math.trunc(Number(value.mostFrequentGenre?.count));
  if (frequentGenre && Number.isFinite(frequentCount) && frequentCount > 0) {
    stats.mostFrequentGenre = { genre: frequentGenre, count: Math.min(frequentCount, total) };
  }

  const absentGenre = compactText(value.longestAbsentGenre?.genre, 60);
  const absentDays = Math.trunc(Number(value.longestAbsentGenre?.days));
  if (absentGenre && Number.isFinite(absentDays) && absentDays >= 0 && absentDays <= 36500) {
    stats.longestAbsentGenre = { genre: absentGenre, days: absentDays };
  }

  const bestByGenre = Array.isArray(value.bestByGenre)
    ? value.bestByGenre.slice(0, 2).map((item) => {
      const genre = compactText(item?.genre, 60);
      const title = compactText(item?.title, 120);
      const rating = finiteNumber(item?.rating, 0, 5);
      const filmsInGenre = Math.trunc(Number(item?.filmsInGenre));
      if (!genre || !title || rating === null) return null;
      return {
        genre,
        title,
        rating,
        filmsInGenre: Number.isFinite(filmsInGenre) && filmsInGenre > 0
          ? Math.min(filmsInGenre, total)
          : 1,
      };
    }).filter(Boolean)
    : [];
  if (bestByGenre.length) stats.bestByGenre = bestByGenre;

  const latestTitle = compactText(value.latestFilm?.title, 120);
  const latestGenre = compactText(value.latestFilm?.genre, 60);
  const latestRating = finiteNumber(value.latestFilm?.rating, 0, 5);
  if (latestTitle && latestGenre && latestRating !== null) {
    stats.latestFilm = { title: latestTitle, genre: latestGenre, rating: latestRating };
  }

  return JSON.stringify(stats).length <= MAX_FEED_STATS_LENGTH ? stats : null;
}

function feedPrompt(stats) {
  return `<stats>\n${JSON.stringify(stats)}\n</stats>`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.has(origin))
      return new Response("Forbidden", { status: 403 });

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    const route = url.pathname === "/review" ? "review" :
      url.pathname === "/feed" ? "feed" : "";
    if (request.method !== "POST" || !route)
      return json(origin, 404, { error: "Маршрут не найден.", code: "not_found" });

    if (!env.GEMINI_API_KEY)
      return json(origin, 503, { error: "Gemini не настроен.", code: "unavailable" });

    let input;
    try {
      input = await request.json();
    } catch (_) {
      return json(origin, 400, { error: "Некорректный запрос.", code: "invalid_request" });
    }

    let systemInstruction = SYSTEM_INSTRUCTION;
    let prompt = "";
    let resultKey = "review";
    let maxOutputTokens = 300;

    if (route === "review") {
      const draft = typeof input.draft === "string" ? input.draft.trim() : "";
      const length = meaningfulLength(draft);
      if (length < MIN_DRAFT_LENGTH)
        return json(origin, 400, { error: "Черновик слишком короткий.", code: "draft_too_short" });
      if (draft.length > MAX_DRAFT_LENGTH)
        return json(origin, 413, { error: "Черновик слишком длинный.", code: "draft_too_long" });
      prompt = userPrompt(draft);
    } else {
      const stats = normalizeFeedStats(input.stats);
      if (!stats)
        return json(origin, 400, { error: "Недостаточно статистики.", code: "invalid_stats" });
      systemInstruction = SYSTEM_INSTRUCTION_FEED;
      prompt = feedPrompt(stats);
      resultKey = "insight";
      maxOutputTokens = 140;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            ...(route === "feed" ? { temperature: 0.35 } : {}),
          },
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

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!text)
      return json(origin, 503, { error: "Gemini не вернул текст.", code: "unavailable" });

    return json(origin, 200, { [resultKey]: text });
  },
};
