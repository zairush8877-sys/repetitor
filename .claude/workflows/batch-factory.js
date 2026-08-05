export const meta = {
  name: 'batch-factory',
  description: 'Пакетная фабрика: несколько постов сразу через корректора и редактора',
  whenToUse: 'Пополнение банка контента: массив черновиков в args, на выходе выверенные посты',
  phases: [
    { title: 'Черновики', detail: 'копирайтер по каждой теме' },
    { title: 'Корректор', detail: 'проверка пар по словарям' },
    { title: 'Редактор', detail: 'сборка финальных версий' },
  ],
}

const input = typeof args === 'string' ? JSON.parse(args) : args
const items = input.items || []
const context = input.context || ''
if (!items.length) throw new Error('batch-factory: в args.items пусто')

const TONE = `Правила тона (обязательные):
- Запрещённые клише: «Признавайтесь…», «Сохраните, чтобы не потерять», «А вы знали?», «Друзья!», «Готовы? Поехали!», «Спойлер:», риторические вопросы-приманки.
- Эмодзи: максимум один на подпись, лучше ноль. Хештеги: 2–4.
- Тест: если фразу могла написать любая нейросеть про любую тему — переписать.
- Аудитория: родители выпускников и взрослые, которым важна грамотность.`

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kicker: { type: 'string' },
    title: { type: 'string', description: 'Заголовок картинки, \\n для переноса строки' },
    rows: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
      minItems: 8, maxItems: 10,
    },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    notes: { type: 'string', description: 'Что изменено против черновика и почему' },
  },
  required: ['id', 'kicker', 'title', 'rows', 'caption', 'hashtags', 'notes'],
}

// Каждая тема проходит свой путь независимо: черновик → проверка → сборка.
// pipeline не ждёт, пока все допишут — готовая тема сразу идёт к корректору.
const results = await pipeline(
  items,
  (item) => agent(
    `Ты копирайтер аккаунта репетитора русского языка @mairova_a_a.
Собери пост-таблицу «неправильно → правильно» на тему: «${item.topic}».
Формат публикации: ${item.format}. Идентификатор: ${item.id}.
${context}
${TONE}
Нужно: 10 пар (слева ошибка, справа норма), заголовок для картинки, подпись
(сильная первая строка → фактура: история слова, почему ошибаются → спокойный финал,
3–6 предложений), 2–4 хештега.
Пары бери такие, где норма бесспорна: если у «неправильного» варианта есть словарная
помета «допустимо» или «разг.», пару не бери.`,
    { label: `черновик:${item.id}`, phase: 'Черновики', schema: ITEM_SCHEMA }),

  (draft, item) => agent(
    `Ты корректор с орфографическим словарём РАН. Аккаунт принадлежит учителю русского
языка — одна фактическая ошибка стоит репутации.
Проверь каждую пару: ${JSON.stringify(draft.rows)}
Для каждой скажи: верна ли норма справа; не перевёрнута ли пара; нет ли у «неправильного»
варианта словарной пометы, делающей его допустимым (такие пары бракуем).
Отдельно проверь подпись на фактические ошибки: ${JSON.stringify(draft.caption)}`,
    { label: `корректор:${item.id}`, phase: 'Корректор', schema: {
      type: 'object',
      properties: {
        verdicts: { type: 'array', items: {
          type: 'object',
          properties: {
            pair: { type: 'string' },
            ok: { type: 'boolean' },
            comment: { type: 'string' },
            replacement: { type: 'array', items: { type: 'string' } },
          },
          required: ['pair', 'ok', 'comment'],
        } },
        captionIssues: { type: 'string' },
      },
      required: ['verdicts', 'captionIssues'],
    } }).then(v => ({ draft, verdict: v, item })),

  ({ draft, verdict, item }) => agent(
    `Ты выпускающий редактор. Собери финальную версию поста.
Черновик: ${JSON.stringify(draft)}
Вердикт корректора: ${JSON.stringify(verdict)}
${TONE}
Забракованные пары замени вариантами корректора или убери (должно остаться 8–10 пар).
Исправь фактические ошибки подписи. id оставь прежним: ${item.id}.`,
    { label: `редактор:${item.id}`, phase: 'Редактор', schema: ITEM_SCHEMA }),
)

const ready = results.filter(Boolean)
log(`Готово постов: ${ready.length} из ${items.length}`)
return { items: ready }
