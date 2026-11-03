# Builder ротации: локальная передача

3 ноября 2026, Europe/Moscow. Новый builder находится только в этой ревизии.
Старый `outputs/cadence-2026-11-03/build-classic.cjs`, его медиа, основной
публикатор и календарь не изменялись.

## Проверено

- 13 тестов `runtime/asset-resolver.test.cjs` прошли. Использованы временные
  фикстуры и поддельная browser page; реальный Chromium/FFmpeg-рендер не запускался.
- На фактическом `release.json` выполнены `validatePosts` и `preflight`:
  21 хронологический classic, 8 разных фото, 7 разных записей. Все выбранные
  файлы найдены и SHA256 совпали с каталогами; ffprobe подтвердил длительности
  35.04 секунды для шести новых записей и 32.04 секунды для Баха. Во всех
  21 назначении `musicOffsetSeconds + total` помещается в запись.
- У соседних chronologicalclassic различны и photoId, и musicId; одинаковые
  SHA под разными ID тоже запрещены. Первый выпуск: books-pile / chopin-op62-no1.
- Реальные видео, визуальное качество и звучание этой ревизии здесь не проверены.
  Публикационных вызовов, push и dispatch не было.

## Контракт

`release.json.posts` — только ещё не опубликованные `pending`/`approved`
`Reels` с `visualStyle: "classic-table"`, уникальными ID и строго возрастающими
`scheduledAt`. Исторический classic01 и голосовые сюда не включать.
`storyRepostMode: "full_video"` и три `branding.show_*: false` задаются явно;
builder сохраняет исходные редакционные поля и статусы.

Каждый пост содержит ровно четыре поля `assetSelection`:
`photoId`, `musicId`, `musicOffsetSeconds` (число >= 0), `backgroundPosition`
(две безопасные CSS-позиции, например `50% 50%` или `72% center`).

Каталоги: `photos-rotation.json.photos` и `music-rotation.json.tracks`.
У актива обязательны уникальный `id`, относительный `file` внутри
`assets/photos/` или `assets/music/` и фактический `sha256`. Для музыки нужны
числовой `durationSeconds`, `composer`, `piece`, `license`, `source`, `attribution`.
Исходные credits сохраняются; строковые Commons-флаги `"false"`/`"true"`
нормализуются в boolean. Метаданные дополнены точными offset, длительностью
фрагмента и обработкой громкости. HTML, рендер и pack используют один resolver.

Ключ рендера включает выбранные ID/пути/SHA, offset, crop, текст/таблицу,
тайминги, код builder/resolver/legacy и фактические IBM Plex Serif/Mono fonts.
Изменённые фото/музыка не переиспользуют старый MP4. `--pack-only` требует
актуальные render receipt, video SHA и cover SHA до записи индексов/Stories.
Каждый полный Story остаётся побайтной копией соответствующего MP4.

## Команды из корня проекта

```sh
node --test outputs/cadence-variation-2026-11-03/runtime/asset-resolver.test.cjs
node outputs/cadence-variation-2026-11-03/build-classic.cjs --preview --jobs=2
node outputs/cadence-variation-2026-11-03/build-classic.cjs --jobs=2
node outputs/cadence-variation-2026-11-03/build-classic.cjs --id=2026-11-classic-02-rast-rashch-ros
node outputs/cadence-variation-2026-11-03/build-classic.cjs --pack-only
```

По умолчанию `--jobs=1`; допустимы только 1 или 2. Разные посты получают
отдельные browser pages и временные каталоги. FFmpeg вызывается асинхронно,
по два encoder threads; после ошибки новые посты не начинают, уже начатые
дожидаются завершения перед закрытием браузера.

`--preview` пишет `qa/<id>-layout.json`, `qa/<id>-preview.jpg` и composition HTML,
сохраняя готовые MP4, финальные обложки и render receipts. `--id` без
`--pack-only` не запускает упаковку. Сочетание `--pack-only --id=...` обновляет
только выбранные prepared/repost записи, при этом требует актуальные render
receipts и prepared/Story для всего release до записи общей queue. Изменение
другого поста при старой сборке блокирует partial pack; перед первой интеграцией
всех 21 поста нужен full pack. Все команды проверяют весь release до работы.

По умолчанию используются локальные `/private/tmp/mama-reels-tools/ffmpeg`,
`ffprobe` и установленный Google Chrome. Переопределения: `CLASSIC_FFMPEG`,
`CLASSIC_FFPROBE`, `CLASSIC_CHROME`. Файлы создаются только внутри этой папки.
Выходной `content/queue.json` содержит только данный release; с основной
очередью 129 постов его объединяет владелец задачи отдельно.
