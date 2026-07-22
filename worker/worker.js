const ALLOWED_ORIGINS = new Set([
  "https://despositoz.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

const MODEL = "gemini-3.1-flash-lite";
const MIN_DRAFT_LENGTH = 20;
const MAX_DRAFT_LENGTH = 2000;
const MAX_FEED_STATS_LENGTH = 4000;
const MAX_FEED_CATALOG_LENGTH = 4000;

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

const SYSTEM_INSTRUCTION_FEED = `Ты пишешь одну короткую познавательную карточку для ленты личного кинодневника. Факты уже собраны из TMDB и переданы в блоке <catalog>; твоя задача — выбрать самый интересный и понятно его сформулировать.

Жёсткие правила:
1. Используй только значения из блока <catalog>. Не добавляй сведения по памяти и не достраивай их. Блок <stats> нужен только как контекст дневника и не является источником кинофактов.
2. Лучшие варианты: необычное соотношение бюджета и мировых сборов; другой известный фильм того же режиссёра; возраст фильма, хронометраж, страна производства или принадлежность к коллекции. Выбери только один факт.
3. Если используешь бюджет и сборы, называй обе исходные суммы и пиши «по данным TMDB». Не называй сборы прибылью и не утверждай, что фильм окупился: маркетинговые расходы в данных не указаны.
4. Другой фильм связывай с режиссёром только если он находится в массиве otherFilmsByDirector. Имя режиссёра и названия копируй точно.
5. Напиши 1–2 коротких предложения на русском языке, спокойно и конкретно. Не начинай с «А ты знал»: эта фраза уже стоит в заголовке карточки.
6. Не пересказывай сюжет, не давай советов и не оценивай фильм за пользователя.
7. Не используй критические красивости, эмодзи, восклицательные знаки и AI-канцелярит.
8. Если передан previousInsight, по возможности выбери другой факт и не повторяй прежнюю формулировку.
9. Верни только готовый текст без заголовка, кавычек, списков и пояснений.`;

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
  if (!Number.isFinite(total) || total < 1 || total > 100000) return null;

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

function normalizeFeedCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const title = compactText(source.title, 140);
  const year = Math.trunc(Number(source.year));
  if (!title || !Number.isFinite(year) || year < 1880 || year > 2200) return null;

  const normalizedSource = { title, year };
  const originalTitle = compactText(source.originalTitle, 140);
  const releaseDate = compactText(source.releaseDate, 20);
  const director = compactText(source.director, 100);
  const collection = compactText(source.collection, 140);
  const runtime = Math.trunc(Number(source.runtime));
  const budget = Math.trunc(Number(source.budget));
  const revenue = Math.trunc(Number(source.revenue));
  const tmdbRating = finiteNumber(source.tmdbRating, 0, 10);
  const tmdbVoteCount = Math.trunc(Number(source.tmdbVoteCount));

  if (originalTitle) normalizedSource.originalTitle = originalTitle;
  if (releaseDate) normalizedSource.releaseDate = releaseDate;
  if (director) normalizedSource.director = director;
  if (collection) normalizedSource.collection = collection;
  if (Number.isFinite(runtime) && runtime > 0 && runtime <= 1000) normalizedSource.runtime = runtime;
  if (Number.isFinite(budget) && budget > 0 && budget <= 10000000000) normalizedSource.budgetUsd = budget;
  if (Number.isFinite(revenue) && revenue > 0 && revenue <= 100000000000) normalizedSource.worldwideRevenueUsd = revenue;
  if (tmdbRating !== null) normalizedSource.tmdbRating = tmdbRating;
  if (Number.isFinite(tmdbVoteCount) && tmdbVoteCount > 0 && tmdbVoteCount <= 100000000)
    normalizedSource.tmdbVoteCount = tmdbVoteCount;

  const countries = Array.isArray(source.productionCountries)
    ? source.productionCountries.slice(0, 6).map((country) => compactText(country, 80)).filter(Boolean)
    : [];
  if (countries.length) normalizedSource.productionCountries = countries;

  const otherFilmsByDirector = Array.isArray(value.otherFilmsByDirector)
    ? value.otherFilmsByDirector.slice(0, 6).map((film) => {
      const otherTitle = compactText(film?.title, 140);
      const otherYear = Math.trunc(Number(film?.year));
      if (!otherTitle || !Number.isFinite(otherYear) || otherYear < 1880 || otherYear > 2200)
        return null;
      return { title: otherTitle, year: otherYear };
    }).filter(Boolean)
    : [];

  const catalog = {
    source: normalizedSource,
    ...(otherFilmsByDirector.length ? { otherFilmsByDirector } : {}),
  };
  return JSON.stringify(catalog).length <= MAX_FEED_CATALOG_LENGTH ? catalog : null;
}

function feedPrompt(stats, catalog, previousInsight) {
  const previous = compactText(previousInsight, 600);
  return [
    `<stats>\n${JSON.stringify(stats)}\n</stats>`,
    `<catalog>\n${JSON.stringify(catalog)}\n</catalog>`,
    previous ? `<previousInsight>\n${previous}\n</previousInsight>` : "",
  ].filter(Boolean).join("\n");
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
      const catalog = normalizeFeedCatalog(input.catalog);
      if (!stats || !catalog)
        return json(origin, 400, { error: "Недостаточно данных о фильме.", code: "invalid_feed_data" });
      systemInstruction = SYSTEM_INSTRUCTION_FEED;
      prompt = feedPrompt(stats, catalog, input.previousInsight);
      resultKey = "insight";
      maxOutputTokens = 180;
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
