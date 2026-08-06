export const meta = {
  name: 'rebuild-bank',
  description: 'Пересборка банка контента под данные исследования: стратегия, Reels, сторис',
  whenToUse: 'Когда банк надо переделать целиком под новую фактуру: конкуренты, тренды, статистика аккаунта',
  phases: [
    { title: 'Стратегия', detail: 'СММ-стратег ставит темы и хуки по фактуре' },
    { title: 'Черновики', detail: 'копирайтер по каждому Reels' },
    { title: 'Корректор', detail: 'каждая пара по словарям РАН' },
    { title: 'Редактор', detail: 'сборка финальных версий' },
    { title: 'Сторис', detail: 'банк сторис: черновик, проверка, сборка' },
  ],
}

const input = typeof args === 'string' ? JSON.parse(args) : args
if (!input || !input.research) throw new Error('rebuild-bank: в args нет research — фабрике не на чем работать')

const RESEARCH = input.research
const STATS = input.stats
const REELS_COUNT = input.reelsCount || 4
const STORIES_COUNT = input.storiesCount || 14

const TONE = `Правила тона (нарушение = переделка):
- Запрещённые клише: «Признавайтесь…», «Сохраните, чтобы не потерять», «А вы знали?», «Друзья!»,
  «Готовы? Поехали!», «Спойлер:», риторические вопросы-приманки, «не листай».
- Эмодзи: максимум один на подпись, лучше ноль. Хештеги: 2–4, узкие.
- Тест: если фразу могла написать любая нейросеть про любую тему — переписать.
- Подпись: сильная первая строка → фактура (история слова, живая деталь) → спокойное
  завершение без призыва-штампа.
- Никаких переобещаний вроде «100 баллов за пять минут»: аудитория родителей к ним скептична.
- Автор — Анна Маирова, учитель русского языка. Личные запреты: пара «одеть/надеть»
  не используется (контекстно-зависима); спорные словарные пары (риэлтор/риелтор) не берём.`

// ─────────────────────────────── Стратегия ───────────────────────────────

phase('Стратегия')

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string', description: 'Чем обоснован выбор тем — со ссылкой на цифры' },
    reels: {
      type: 'array', minItems: REELS_COUNT, maxItems: REELS_COUNT,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'латиницей, без дат, например ege-paronimy' },
          topic: { type: 'string', description: 'о чём таблица «неправильно → правильно»' },
          hook: { type: 'string', description: 'заголовок первого кадра, до 40 знаков' },
          why: { type: 'string', description: 'почему эта тема — по данным исследования' },
        },
        required: ['id', 'topic', 'hook', 'why'],
      },
    },
    storiesBrief: { type: 'string', description: 'ТЗ на банк сторис: какие типы, в какой пропорции, какие темы' },
  },
  required: ['reasoning', 'reels', 'storiesBrief'],
}

const plan = await agent(
  `Ты СММ-стратег аккаунта @mairova_a_a — репетитор по русскому языку, подготовка к ЕГЭ и ОГЭ.
Задача: назначить ${REELS_COUNT} тем для Reels и составить ТЗ на банк сторис.

СОБСТВЕННАЯ СТАТИСТИКА АККАУНТА (это главный аргумент, важнее любых внешних данных):
${STATS}

ИССЛЕДОВАНИЕ РЫНКА И ТРЕНДОВ:
${RESEARCH}

${TONE}

Требования к выбору:
- Reels — единственный носитель, который даёт охват; статичные разборы проваливаются.
  Поэтому темы бери те, что раньше уходили в статику, и переноси в Reels.
- Формат каждого Reels фиксирован: таблица «неправильно → правильно», 8–10 пар,
  один экран, без озвучки. Значит тема должна разбиваться на пары.
- Опирайся на незанятые ниши из исследования и на свежие инфоповоды, но только на
  подтверждённые факты. Всё, где исследование пишет «не подтверждено», не бери.
- Хук строй по рабочим формулам: оспаривание («тебя учили неправильно»),
  предупреждение об ошибке, обещание списка. Выгоревшие формулировки не бери.

В reasoning объясни выбор ЦИФРАМИ из статистики, а не общими словами.`,
  { schema: PLAN_SCHEMA })

log(`Стратег назначил темы: ${plan.reels.map(r => r.id).join(', ')}`)

// ─────────────────────────────── Reels ───────────────────────────────

const REELS_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kicker: { type: 'string', description: 'надзаголовок, до 30 знаков' },
    title: { type: 'string', description: 'заголовок кадра, \\n для переноса строки' },
    rows: {
      type: 'array', minItems: 8, maxItems: 10,
      items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    notes: { type: 'string', description: 'что изменено против черновика и почему' },
  },
  required: ['id', 'kicker', 'title', 'rows', 'caption', 'hashtags', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pair: { type: 'string' },
          ok: { type: 'boolean' },
          comment: { type: 'string', description: 'со ссылкой на словарь или ФИПИ' },
          replacement: { type: 'array', items: { type: 'string' } },
        },
        required: ['pair', 'ok', 'comment'],
      },
    },
    captionIssues: { type: 'string' },
  },
  required: ['verdicts', 'captionIssues'],
}

// Каждая тема идёт своим путём: как только копирайтер закончил — она сразу
// у корректора, не дожидаясь остальных.
const reels = await pipeline(
  plan.reels,
  (item) => agent(
    `Ты копирайтер аккаунта @mairova_a_a (репетитор по русскому языку).
Собери Reels-таблицу «неправильно → правильно».

Тема: ${item.topic}
Хук от стратега: ${item.hook}
Зачем эта тема: ${item.why}
Идентификатор: ${item.id}

${TONE}

Нужно: 8–10 пар (слева ошибка, справа норма), кикер, заголовок кадра, подпись
(3–6 предложений) и 2–4 хештега.
Пары бери только с бесспорной нормой: если у «неправильного» варианта есть
словарная помета «допустимо» или «разг.» — пару не бери, она вызовет спор.
Слева пиши ровно ту форму, которую реально пишут и говорят, а не выдуманную.`,
    { label: `черновик:${item.id}`, phase: 'Черновики', schema: REELS_SCHEMA }),

  (draft, item) => agent(
    `Ты корректор. Аккаунт принадлежит учителю русского языка: одна фактическая ошибка
стоит репутации, поэтому проверяй придирчиво и не подтверждай то, в чём не уверен.

Проверь каждую пару по орфографическому словарю РАН и словарям из перечня Минобрнауки:
${JSON.stringify(draft.rows)}

По каждой паре ответь:
- верна ли норма справа;
- не перевёрнута ли пара (частая и самая опасная ошибка: слева случайно оказывается норма);
- нет ли у «неправильного» варианта пометы «допустимо»/«разг.», из-за которой пара
  становится спорной — такие бракуем;
- если тема про ЕГЭ: верно ли назван номер задания и число баллов за него.

Отдельно проверь подпись на фактические ошибки: ${JSON.stringify(draft.caption)}
Особенно: номера заданий, количество баллов, этимологии, ссылки на ФИПИ и словари.`,
    { label: `корректор:${item.id}`, phase: 'Корректор', schema: VERDICT_SCHEMA })
    .then(v => ({ draft, verdict: v, item })),

  ({ draft, verdict, item }) => agent(
    `Ты выпускающий редактор. Собери финальную версию Reels.
Черновик: ${JSON.stringify(draft)}
Вердикт корректора: ${JSON.stringify(verdict)}
${TONE}
Забракованные пары замени предложениями корректора или убери — должно остаться 8–10.
Исправь всё, что корректор отметил в подписи. id оставь прежним: ${item.id}.
В notes перечисли, что именно изменено против черновика и почему.`,
    { label: `редактор:${item.id}`, phase: 'Редактор', schema: REELS_SCHEMA }),
)

// ─────────────────────────────── Сторис ───────────────────────────────

phase('Сторис')

const STORIES_SCHEMA = {
  type: 'object',
  properties: {
    stories: {
      type: 'array', minItems: STORIES_COUNT, maxItems: STORIES_COUNT,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'st-01, st-02, …' },
          type: { type: 'string', enum: ['vopros', 'fakt', 'staroe'] },
          q: { type: 'string', description: 'только для vopros: вопрос первого кадра' },
          a: { type: 'string', description: 'только для vopros: вариант A' },
          b: { type: 'string', description: 'только для vopros: вариант B' },
          right: { type: 'string', description: 'только для vopros: a или b' },
          top: { type: 'string', description: 'только для fakt и staroe: надпись сверху' },
          big: { type: 'string', description: 'только для fakt и staroe: крупная надпись, \\n для переноса' },
          why: { type: 'string', description: 'второй кадр: объяснение, две строки через \\n' },
          source: { type: 'string', description: 'откуда факт: словарь, ФИПИ, документ' },
        },
        required: ['id', 'type', 'why', 'source'],
      },
    },
  },
  required: ['stories'],
}

const storiesDraft = await agent(
  `Ты копирайтер аккаунта @mairova_a_a. Собери банк из ${STORIES_COUNT} сторис.

ТЗ от стратега: ${plan.storiesBrief}

ФАКТУРА ИССЛЕДОВАНИЯ (бери темы отсюда, «не подтверждено» не бери):
${RESEARCH}

${TONE}

Каждая сторис — два кадра: интрига и ответ. Три типа:
- vopros: q — короткий вопрос, a и b — два варианта, right — какой верен, why — объяснение;
- fakt: top — слово в кавычках, big — неожиданная расшифровка, why — объяснение;
- staroe: top — «Что такое», big — забытое слово, why — что оно значило.

Жёсткие требования:
- Текста мало: q до 24 знаков, a и b до 16, big до 22, why — ровно две строки через \\n,
  каждая до 65 знаков. Это вертикальный экран, длинный текст в него не влезет.
- В поле source укажи, чем факт подтверждается: конкретный словарь, статья ФИПИ, документ.
  Если подтвердить нечем — такую сторис не бери вовсе.
- Ни одной выдуманной этимологии. Интернет-мемы и сетевой сленг не выдавать за старые слова.
- Пропорция типов — по ТЗ стратега.`,
  { label: 'черновик:сторис', schema: STORIES_SCHEMA })

const storiesCheck = await agent(
  `Ты корректор. Проверь банк сторис для аккаунта учителя русского языка.
Одна выдуманная этимология или неверная норма стоит репутации автора.

Банк: ${JSON.stringify(storiesDraft.stories)}

По каждой сторис ответь:
- верен ли факт и подтверждается ли он указанным источником;
- нет ли выдуманной этимологии и не выдаётся ли интернет-сленг за старое слово
  (пример реальной ошибки из прошлого банка: «мимокрок» подавался как слово XIX века,
  хотя это интернет-мем «мимокрокодил» 2010-х);
- для vopros: действительно ли верен указанный в right вариант;
- укладывается ли текст в лимиты (q ≤ 24, a и b ≤ 16, big ≤ 22, каждая строка why ≤ 65).

Для каждой проблемной сторис предложи замену или скажи «удалить».`,
  { label: 'корректор:сторис', schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ok: { type: 'boolean' },
            comment: { type: 'string' },
            action: { type: 'string', enum: ['оставить', 'исправить', 'удалить'] },
          },
          required: ['id', 'ok', 'comment', 'action'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['verdicts', 'summary'],
  } })

const stories = await agent(
  `Ты выпускающий редактор. Собери финальный банк сторис.
Черновик: ${JSON.stringify(storiesDraft.stories)}
Вердикт корректора: ${JSON.stringify(storiesCheck)}
${TONE}
Всё, что корректор пометил «удалить», замени новой сторис на подтверждаемом факте.
Всё, что «исправить», исправь. На выходе ровно ${STORIES_COUNT} сторис,
пронумерованных подряд от st-01. Лимиты длины соблюдай строго.`,
  { label: 'редактор:сторис', schema: STORIES_SCHEMA })

const readyReels = reels.filter(Boolean)
log(`Reels готово: ${readyReels.length} из ${plan.reels.length}; сторис: ${stories.stories.length}`)

return {
  reasoning: plan.reasoning,
  reels: readyReels,
  stories: stories.stories,
  storiesReview: storiesCheck.summary,
}
