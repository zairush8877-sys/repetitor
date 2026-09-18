# Видео Анны

`node video-lab/prepare.cjs` проверяет исходный MP4 и копирует локальные фото,
шрифты и музыку в проекты. Публикацию эта команда не выполняет.

## Remotion

В `remotion`: `npm ci`, `npm run lint`, `npm run build`.
`MamaPilot` воспроизводит исходный пилот v2, а шесть `Bank-*` — самостоятельные
композиции из `src/Bank.tsx`. Сценарии находятся в `bank.json`.
Экспорт: в Studio выбрать композицию → Render in browser → MP4.
Готовые MP4 положить в `content/reels/{id}.mp4`.

`node scripts/package-remotion-bank.cjs --python <Python с Pillow>` создаёт
обложки и полные Stories-анонсы, проверяет хеши и собирает манифесты. Скрипт
предназначен для банка 20–25 сентября 2026: он назначает даты и approved,
поэтому применяется только в рамках разрешённого пользователем выпуска.
Он не заменяет проверку текстов и визуальный просмотр и не вызывает Instagram.

## HyperFrames

`hyperframes/index.html` — 20-секундная композиция исходного v2 с раздельными
видео- и аудиодорожками. Линтер прошёл без ошибок и предупреждений.
Проверка runtime и повторный рендер HyperFrames на этом Mac заблокированы
ограничением запуска Chromium (`MachPortRendezvousServer Permission denied`).
Экспорт банка выполнен Remotion в браузере; не считать его рендером HyperFrames.

Фото и лицензии: `assets/photos/index.json`, `assets/photos/wordplay.json`,
`assets/photos/bank-refresh.json`.
Музыка новых выпусков: Бах, BWV 988, вариация № 1; Кимико Ишизака, CC0.
Кредиты и права на запись: `content/music/index.json`. Опубликованный v2 сохраняет Easy Lemon.
Кредиты подставляются издателем из манифеста. Секреты для рендера не нужны.
