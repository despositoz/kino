// Кинодневник — логика мини-аппа.
// Хранение: облако Telegram (CloudStorage) — привязано к твоему аккаунту
// и синхронизируется между устройствами. Вне Telegram (обычный браузер)
// используется localStorage, чтобы можно было тестировать.

"use strict";

// ─── Telegram WebApp ─────────────────────────────────────────────

const tg = window.Telegram ? window.Telegram.WebApp : null;
// initData не пустой только внутри настоящего Telegram
const inTelegram = !!(tg && tg.initData);

if (tg) {
  tg.ready();
  tg.expand(); // развернуть мини-апп на весь экран
}

// ─── Критерии и формулы (один в один из kinodnevnik.jsx) ─────────

const CRITERIA = [
  { id: "plot", label: "Сюжет и сценарий" },
  { id: "chars", label: "Персонажи и игра" },
  { id: "visual", label: "Визуал и режиссура" },
  { id: "sound", label: "Звук и музыка" },
  { id: "emotion", label: "Эмоциональное воздействие" },
];

const GENRES = ["Хоррор", "Триллер", "Драма", "Фантастика", "Боевик",
  "Комедия", "Детектив", "Фэнтези", "Анимация", "Документальный", "Другое"];

const verdict = (s) => {
  if (s >= 9) return "Почти шедевр";
  if (s >= 8) return "Отлично";
  if (s >= 7) return "Хорошо";
  if (s >= 6) return "Нормально";
  if (s >= 4) return "Слабо";
  return "Плохо";
};

// 10-балльная → 5-балльная с половинками (как звёзды на Letterboxd)
const toFive = (s10) => Math.round(s10) / 2;
const stars = (s10) => {
  const v = toFive(s10);
  const full = Math.floor(v);
  return "★".repeat(full) + (v % 1 ? "½" : "") + "☆".repeat(5 - Math.ceil(v));
};

// среднее по 5 критериям, округление до 0.1
const calcQuality = (scores) => {
  const sum = CRITERIA.reduce((s, c) => s + scores[c.id], 0);
  return Math.round((sum / CRITERIA.length) * 10) / 10;
};

// ─── Хранилище: облако Telegram или localStorage ─────────────────
// Каждый фильм — отдельный ключ "film_<id>", значение — JSON.
// (у облака Telegram лимит 4096 символов на значение — записи влезают с запасом)

const cloud = {
  getKeys: () => new Promise((res, rej) =>
    tg.CloudStorage.getKeys((e, keys) => e ? rej(e) : res(keys || []))),
  getItems: (keys) => new Promise((res, rej) =>
    tg.CloudStorage.getItems(keys, (e, vals) => e ? rej(e) : res(vals || {}))),
  set: (k, v) => new Promise((res, rej) =>
    tg.CloudStorage.setItem(k, v, (e) => e ? rej(e) : res())),
  remove: (k) => new Promise((res, rej) =>
    tg.CloudStorage.removeItem(k, (e) => e ? rej(e) : res())),
};

const useCloud = inTelegram && tg.CloudStorage && tg.isVersionAtLeast("6.9");

const store = {
  async getAll() {
    let raw = []; // массив JSON-строк
    if (useCloud) {
      const keys = (await cloud.getKeys()).filter((k) => k.startsWith("film_"));
      if (keys.length) raw = Object.values(await cloud.getItems(keys));
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith("film_")) raw.push(localStorage.getItem(k));
      }
    }
    const films = [];
    for (const r of raw) {
      try { films.push(JSON.parse(r)); } catch (e) { /* битую запись пропускаем */ }
    }
    return films.sort((a, b) => b.id - a.id); // новые сверху
  },
  async save(film) {
    const k = "film_" + film.id, v = JSON.stringify(film);
    if (useCloud) await cloud.set(k, v);
    else localStorage.setItem(k, v);
  },
  async remove(id) {
    const k = "film_" + id;
    if (useCloud) await cloud.remove(k);
    else localStorage.removeItem(k);
  },
};

// ─── Состояние формы ─────────────────────────────────────────────

const emptyForm = () => ({
  title: "", year: "", genre: GENRES[0],
  scores: { plot: 5, chars: 5, visual: 5, sound: 5, emotion: 5 },
  personal: 5,
  liked: "", disliked: "", moment: "",
});

let form = emptyForm();

// ─── Промпт для ручного режима (как manualPrompt в jsx) ──────────

function filmContext() {
  const details = CRITERIA.map((c) => `${c.label}: ${form.scores[c.id]}/10`).join("\n");
  const q = calcQuality(form.scores);
  return `Фильм: «${form.title}»${form.year ? ` (${form.year})` : ""}, жанр: ${form.genre}.
Оценки по критериям:
${details}
Итог по качеству: ${q}/10 (${verdict(q)})
Личное удовольствие: ${form.personal}/10
Заметки зрителя:
Понравилось: ${form.liked || "—"}
Не понравилось: ${form.disliked || "—"}
Запомнившийся момент: ${form.moment || "—"}`;
}

function manualPrompt() {
  return `Напиши короткую запись о фильме для моего личного кинодневника, от первого лица.

${filmContext()}

Важно: 70–130 слов максимум. Пиши как заметку для себя, спокойным разговорным тоном, простыми предложениями. Максимально сохраняй мои формулировки из заметок — не заменяй мои слова на сленг и не добавляй «молодёжных» выражений от себя. Без красивых оборотов, без формального итога, без списков. Возьми 2–3 вещи, которые меня реально зацепили, и напиши про них конкретно. Ответь только текстом записи.`;
}

// ─── Помощники ───────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// создать элемент: el("div", "card", "текст")
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    // запасной способ для старых webview
    const ta = el("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

function confirmAsk(msg) {
  return new Promise((res) => {
    if (inTelegram && tg.isVersionAtLeast("6.2")) tg.showConfirm(msg, res);
    else res(window.confirm(msg));
  });
}

function haptic(kind) {
  if (inTelegram && tg.HapticFeedback) {
    try { tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* не критично */ }
  }
}

// ─── Вкладки и стадии ────────────────────────────────────────────

function showTab(name) {
  $("screen-rate").classList.toggle("hidden", name !== "rate");
  $("screen-diary").classList.toggle("hidden", name !== "diary");
  $("tab-rate").classList.toggle("on", name === "rate");
  $("tab-diary").classList.toggle("on", name === "diary");
  if (name === "diary") renderDiary();
}

function showStage(name) { // "form" | "entry"
  $("stage-form").classList.toggle("hidden", name !== "form");
  $("stage-entry").classList.toggle("hidden", name !== "entry");
  window.scrollTo(0, 0);
}

// ─── Экран «Оценка»: форма ───────────────────────────────────────

function buildForm() {
  const sel = $("f-genre");
  GENRES.forEach((g) => sel.append(new Option(g, g)));

  const box = $("sliders");
  const makeSlider = (name, value, cls, oninput) => {
    const wrap = el("div", "crit" + (cls ? " " + cls : ""));
    const top = el("div", "crit-top");
    const label = el("span", "crit-name", name);
    const val = el("span", "crit-val", String(value));
    top.append(label, val);
    const range = document.createElement("input");
    range.type = "range";
    range.min = "1"; range.max = "10"; range.step = "1";
    range.value = String(value);
    range.setAttribute("aria-label", name);
    range.addEventListener("input", () => {
      val.textContent = range.value;
      oninput(+range.value);
      renderResult();
    });
    wrap.append(top, range);
    box.append(wrap);
  };

  CRITERIA.forEach((c) =>
    makeSlider(c.label, form.scores[c.id], "", (v) => { form.scores[c.id] = v; }));
  makeSlider("Личное удовольствие («зашло»)", form.personal, "personal",
    (v) => { form.personal = v; });

  renderResult();
}

function renderResult() {
  const q = calcQuality(form.scores);
  $("r-score").textContent = q.toFixed(1);
  $("r-stars").textContent = stars(q) + "  " + toFive(q) + "/5";
  $("r-verdict").textContent = verdict(q);
  const gap = Math.abs(q - form.personal) >= 2
    ? " — качество и удовольствие расходятся, это нормально" : "";
  $("r-personal").textContent =
    `Зашло на ${form.personal} (${toFive(form.personal)}/5)` + gap;
}

function readTextFields() {
  form.title = $("f-title").value.trim();
  form.year = $("f-year").value.trim();
  form.genre = $("f-genre").value;
  form.liked = $("f-liked").value.trim();
  form.disliked = $("f-disliked").value.trim();
  form.moment = $("f-moment").value.trim();
}

// ─── Экран «Оценка»: шаг записи ──────────────────────────────────

function openEntryStage() {
  readTextFields();
  if (!form.title) {
    $("form-err").textContent = "Укажи название фильма.";
    $("form-err").classList.remove("hidden");
    return;
  }
  $("form-err").classList.add("hidden");
  const q = calcQuality(form.scores);
  $("e-score").textContent = q.toFixed(1);
  $("e-stars").textContent = stars(q) + "  " + toFive(q) + "/5";
  $("e-verdict").textContent = verdict(q);
  $("e-title").textContent =
    `${form.title}${form.year ? ` (${form.year})` : ""} · зашло на ${form.personal}`;
  $("e-prompt").value = manualPrompt();
  showStage("entry");
}

async function saveEntry(review) {
  const film = {
    id: Date.now(),
    title: form.title, year: form.year, genre: form.genre,
    scores: { ...form.scores },
    quality: calcQuality(form.scores),
    personal: form.personal,
    liked: form.liked, disliked: form.disliked, moment: form.moment,
    review,
    date: new Date().toLocaleDateString("ru-RU"),
  };
  try {
    await store.save(film);
  } catch (e) {
    $("entry-err").textContent = "Не сохранилось: " + (e.message || e) + ". Попробуй ещё раз.";
    $("entry-err").classList.remove("hidden");
    return;
  }
  $("entry-err").classList.add("hidden");
  haptic("success");
  // сброс формы и переход в дневник
  form = emptyForm();
  $("f-title").value = ""; $("f-year").value = ""; $("f-genre").value = GENRES[0];
  $("f-liked").value = ""; $("f-disliked").value = ""; $("f-moment").value = "";
  $("e-review").value = "";
  $("sliders").innerHTML = "";
  buildForm();
  showStage("form");
  showTab("diary");
}

// ─── Экран «Дневник» ─────────────────────────────────────────────

let expandedId = null;

async function renderDiary() {
  const list = $("diary-list");
  list.innerHTML = "";
  let films;
  try {
    films = await store.getAll();
  } catch (e) {
    list.append(el("div", "empty", "Не удалось загрузить дневник: " + (e.message || e)));
    return;
  }
  if (!films.length) {
    list.append(el("div", "empty", "Дневник пока пуст. Оцени первый фильм на вкладке «Оценка»."));
    return;
  }
  films.forEach((f) => list.append(filmItem(f)));
}

function filmItem(f) {
  const item = el("div", "film");
  const top = el("div", "film-top");

  const left = el("div");
  left.append(el("div", "film-title", f.title + (f.year ? ` (${f.year})` : "")));
  left.append(el("div", "film-meta",
    `${f.genre} · ${f.date} · зашло на ${f.personal} (${toFive(f.personal)}/5)`));

  const badge = el("div", "badge");
  badge.append(el("div", "badge-num", f.quality.toFixed(1)));
  badge.append(el("div", "badge-stars", stars(f.quality)));

  top.append(left, badge);
  top.addEventListener("click", () => {
    expandedId = expandedId === f.id ? null : f.id;
    renderDiary();
  });
  item.append(top);

  if (expandedId === f.id) {
    const detail = el("div", "film-detail");
    detail.append(el("div", "film-crit",
      CRITERIA.map((c) => `${c.label}: ${f.scores[c.id]}`).join(" · ")));
    if (f.review) detail.append(el("div", "film-review", f.review));

    const actions = el("div", "film-actions");
    const exp = el("button", "linkbtn", "Экспорт текстом");
    exp.addEventListener("click", async () => {
      const text = `«${f.title}»${f.year ? ` (${f.year})` : ""}\n` +
        `${stars(f.quality)} ${toFive(f.quality)}/5 · качество ${f.quality.toFixed(1)}/10 · зашло ${f.personal}/10` +
        (f.review ? `\n\n${f.review}` : "");
      exp.textContent = (await copyText(text)) ? "Скопировано ✓" : "Не удалось скопировать";
      setTimeout(() => { exp.textContent = "Экспорт текстом"; }, 2000);
    });
    const del = el("button", "linkbtn danger", "Удалить");
    del.addEventListener("click", async () => {
      if (!(await confirmAsk(`Удалить запись «${f.title}»?`))) return;
      await store.remove(f.id);
      expandedId = null;
      renderDiary();
    });
    actions.append(exp, del);
    detail.append(actions);
    item.append(detail);
  }
  return item;
}

// ─── Запуск ──────────────────────────────────────────────────────

$("tab-rate").addEventListener("click", () => showTab("rate"));
$("tab-diary").addEventListener("click", () => showTab("diary"));
$("btn-next").addEventListener("click", openEntryStage);
$("btn-back").addEventListener("click", () => showStage("form"));

$("btn-copy").addEventListener("click", async () => {
  const ok = await copyText($("e-prompt").value);
  $("btn-copy").textContent = ok ? "Скопировано ✓" : "Не удалось — выдели текст вручную";
  setTimeout(() => { $("btn-copy").textContent = "Скопировать промпт"; }, 2000);
});

$("btn-save").addEventListener("click", () => {
  const review = $("e-review").value.trim();
  if (!review) {
    $("entry-err").textContent = "Вставь текст записи (или нажми «Сохранить без записи»).";
    $("entry-err").classList.remove("hidden");
    return;
  }
  saveEntry(review);
});

$("btn-save-empty").addEventListener("click", () => saveEntry(""));

if (!inTelegram) $("storage-note").classList.remove("hidden");

buildForm();
