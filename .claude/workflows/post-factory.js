export const meta = {
  name: 'post-factory',
  description: 'Фабрика поста: СММ, копирайтер и корректор параллельно, редактор сводит',
  whenToUse: 'Подготовка любого поста для @mairova_a_a: черновик поста передаётся в args, на выходе готовый пост',
  phases: [
    { title: 'Специалисты', detail: 'СММ-стратег, копирайтер, корректор — параллельно' },
    { title: 'Редактор', detail: 'сводит финальный пост' },
  ],
}

// args: { draft: {title, kicker, rows, caption, hashtags, rubric, format}, context: string }
// args может прийти и строкой JSON — разбираем в любом случае
const input = typeof args === 'string' ? JSON.parse(args) : args
const draft = input.draft
const context = input.context || ''
if (!draft || !draft.rows) throw new Error('post-factory: в args.draft нет черновика с rows')

const TONE = `Правила тона (обязательные):
- Запрещённые клише: «Признавайтесь…», «Сохраните, чтобы не потерять», «А вы знали?», «Друзья!», «Готовы? Поехали!», «Спойлер:», риторические вопросы-приманки.
- Эмодзи: максимум один на подпись, лучше ноль. Хештеги: 2–4.
- Тест: если фразу могла написать любая нейросеть про любую тему — переписать.
- Аудитория: родители выпускников и взрослые, которым важна грамотность. Пишем как живой образованный человек, без канцелярита.`

phase('Специалисты')

const [smm, copy, facts] = await parallel([
  () => agent(
    `Ты СММ-стратег аккаунта репетитора русского языка @mairova_a_a (236 подписчиков).
Что известно по статистике: посты «про правила» дают 37–295 охвата; история ученицы — 8 498; вирусный формат-эталон — таблица «неправильно → правильно» на один экран (18,3 тыс. лайков у конкурента). Формат таблицы выбран, менять его нельзя.
${context}
Черновик поста: ${JSON.stringify(draft, null, 2)}
${TONE}
Верни: 3 варианта заголовка для картинки (коротких, цепких, без кликбейт-клише), 2–4 хештега, и одну заметку — что усилить в этом посте.`,
    { label: 'смм', phase: 'Специалисты', schema: {
      type: 'object',
      properties: {
        titles: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
        hashtags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
        note: { type: 'string' },
      },
      required: ['titles', 'hashtags', 'note'],
    } }),

  () => agent(
    `Ты копирайтер аккаунта репетитора русского языка. Пишешь подпись к посту-таблице «неправильно → правильно».
Черновик поста: ${JSON.stringify(draft, null, 2)}
${TONE}
Структура подписи: сильная первая строка (по ней решают, читать ли) → разбор одной-двух самых интересных пар с фактурой (история слова, почему ошибаются) → спокойное завершение без призыва-штампа. 3–6 предложений, без хештегов.
Верни 2 разных варианта подписи.`,
    { label: 'копирайтер', phase: 'Специалисты', schema: {
      type: 'object',
      properties: { variants: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
      required: ['variants'],
    } }),

  () => agent(
    `Ты корректор с орфографическим словарём РАН. Аккаунт принадлежит учителю русского языка — одна фактическая ошибка в посте про грамотность стоит репутации.
Проверь каждую пару «неправильно → правильно»: ${JSON.stringify(draft.rows)}
Для каждой пары ответь: верна ли норма в правой колонке, нет ли случаев, где «неправильный» вариант тоже допустим словарями (как «одеть/надеть» зависит от контекста — такие пары бракуем). Если пара спорная или неверная — предложи замену из той же темы. Проверь также подпись черновика на фактические ошибки: ${JSON.stringify(draft.caption)}`,
    { label: 'корректор', phase: 'Специалисты', schema: {
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
    } }),
])

phase('Редактор')

const final = await agent(
  `Ты выпускающий редактор. Собери финальный пост из работы команды.
Черновик: ${JSON.stringify(draft, null, 2)}
СММ-стратег (заголовки, хештеги, заметка): ${JSON.stringify(smm)}
Копирайтер (2 варианта подписи): ${JSON.stringify(copy)}
Корректор (проверка пар и подписи): ${JSON.stringify(facts)}
${TONE}
Правила сборки: спорные и забракованные корректором пары убери или замени его вариантами (в таблице должно остаться 8–10 пар); выбери лучший заголовок и лучшую подпись (можно объединить сильные куски двух вариантов, но без склейки швов); учти замечания корректора к подписи; хештеги — от СММ.`,
  { label: 'редактор', phase: 'Редактор', schema: {
    type: 'object',
    properties: {
      kicker: { type: 'string' },
      title: { type: 'string', description: 'Заголовок картинки, с \\n для переноса строки' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 }, minItems: 8, maxItems: 10 },
      caption: { type: 'string' },
      hashtags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
      changes: { type: 'string', description: 'Что изменено против черновика и почему, в двух предложениях' },
    },
    required: ['kicker', 'title', 'rows', 'caption', 'hashtags', 'changes'],
  } })

return { final, factNotes: facts, smmNote: smm.note }
