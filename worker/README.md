# Gemini для Кинодневника

Worker нужен, чтобы ключ Gemini не попадал в публичный код GitHub Pages.

## Подключение

1. Создай новый API-ключ в Google AI Studio. Старый ключ из переписки использовать нельзя.
2. В терминале открой эту папку и выполни `npx wrangler login`.
3. Сохрани ключ командой `npx wrangler secret put GEMINI_API_KEY`.
4. Опубликуй Worker командой `npx wrangler deploy`.
5. Скопируй полученный адрес, добавь к нему `/review` и вставь в `window.KINO_AI_ENDPOINT` в `webapp/index.html`.

Ключ нельзя записывать в `worker.js`, `wrangler.jsonc`, `.env`, `webapp/` или отправлять в чат.
