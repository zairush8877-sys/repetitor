#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone

base = Path('/private/tmp/mama-classic-refill-2026-11-08')
out = base / 'editorial'
draft_path = out / 'drafts.json'
release_path = base / 'project/outputs/classic-refill-2026-11-08/release.json'
draft_bytes = draft_path.read_bytes()
release_bytes = release_path.read_bytes()
draft = json.loads(draft_bytes)
release = json.loads(release_bytes)
now = datetime.now(timezone.utc).isoformat()
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
keys = ['id', 'kicker', 'title', 'heads', 'rows', 'caption', 'hashtags', 'rubric', 'school']
projection = lambda p: {k: p[k] for k in keys if k in p}

sources = [
    dict(id='S1', title='Полный академический справочник: однородные члены, §26, примечание 1',
         url='https://gramota.ru/biblioteka/spravochniki/pravila-russkoy-orfografii-i-punktuatsii/znaki-prepinaniya-pri-odnorodnykh-chlenakh-predlozheniya',
         publisher='Грамота.ру, академический справочник под ред. В. В. Лопатина',
         access='indexed_primary_extract; direct_open_403',
         evidence='В цельных фразеологических сочетаниях с повтором ни запятая не ставится; в примерах есть ни рыба ни мясо и ни то ни се.'),
    dict(id='S2', title='Ответ справочной службы №313129: пожелание ни пуха ни пера',
         url='https://gramota.ru/spravka/vopros/313129', publisher='Грамота.ру',
         access='indexed_primary_extract',
         evidence='При пожелании используется фразеологизм без внутренней запятой; свободное перечисление требует отдельного анализа.'),
    dict(id='S3', title='Русский орфографический словарь РАН, нормативная электронная версия',
         url='https://gramota.ru/storage/public/normdicts/orfograficheskij_slovar.pdf',
         publisher='Институт русского языка им. В. В. Виноградова РАН; размещено Грамотой',
         access='indexed_primary_dictionary_extracts; not_full_pdf',
         evidence='В словнике все четыре сочетания с ни представлены без внутренней запятой. Проверено только написание этих статей; искажённые поисковым парсером диакритики не использованы.'),
    dict(id='S4', title='Орфографическое комментирование русского словаря, §24, гар/гор',
         url='https://oross.ruslang.ru/paragraph/24',
         publisher='Институт русского языка им. В. В. Виноградова РАН',
         access='full_primary_page', location='§24.1, строки веб-извлечения 164–174',
         evidence='Для гар/гор без ударения О, под ударением А. Загореть и угореть включены в примеры. Выгарки, изгарь, пригарь перечислены среди исключений; полный список шире трёх слов.'),
    dict(id='S5', title='Полный академический справочник: особенности написания отдельных корней, §35',
         url='https://orthographia.ru/orfografia.php?sid=32',
         publisher='Полный академический справочник под ред. В. В. Лопатина, электронный текст',
         access='full_primary_academic_text', location='Абзац гар — гор, строка веб-извлечения 207',
         evidence='Примеры зага́р, уга́р, угоре́ть подтверждают ударения и буквы. Вы́гарки, и́згарь, при́гарь даны как написания гар без ударения.'),
    dict(id='S6', title='Академос: словник У, статьи угар и угореть',
         url='https://orfo.ruslang.ru/abc/part/u?end=162910&start=162610',
         publisher='Институт русского языка им. В. В. Виноградова РАН',
         access='full_primary_dictionary_page', location='Строки веб-извлечения 123 и 524',
         evidence='Актуальный словник непосредственно показывает уга́р и угоре́ть.'),
    dict(id='S7', title='Учебник Грамоты: корни с чередованием, зависящим от ударения',
         url='https://gramota.ru/uchebnik/pravila/korni-s-cheredovaniem-glasnykh-vybor-kotorykh-zavisit-ot-udareniya',
         publisher='Грамота.ру', access='indexed_primary_extract; direct_open_403',
         evidence='Подтверждены А под ударением, О без ударения в гар/гор и исключения; отдельная оговорка о корнях-омонимах исключает распространение правила на любую последовательность букв гор.'),
    dict(id='S8', title='Е. И. Литневская: местоимение; разделы по значению и грамматическим признакам',
         url='https://gramota.ru/biblioteka/spravochniki/russkij-yazyk-kratkij-teoreticheskij-kurs-dlya-shkolnikov/mestoimenie-kak-chast-rechi',
         publisher='Е. И. Литневская, авторский теоретический курс для школьников на Грамоте',
         access='indexed_primary_course_and_related_sections; direct_open_403',
         evidence='Кто и чей названы вопросительными; те же формы при связи частей СПП — относительные, то есть союзные слова. Кто соотнесено с существительным, чей — с прилагательным.'),
    dict(id='S9', title='Ответ справочной службы №316043: союзные слова и члены придаточной части',
         url='https://gramota.ru/spravka/vopros/316043', publisher='Грамота.ру с отсылкой к курсу Е. И. Литневской',
         access='indexed_primary_extract; direct_open_403',
         evidence='Относительные местоимения кто и чей относятся к союзным словам; они связывают части СПП и выполняют синтаксическую функцию в придаточной части.'),
    dict(id='S10', title='БТСРГ: карточка ЗАГОРАТЬ с совершенной формой загореть, индексированный словарный фрагмент',
         url='https://gramota.ru/poisk?mode=slovari&page=15&query=%D0%B7%D0%B0%D1%81%D0%BE%D1%81%D0%B0%D1%82%D1%8C&simple=0',
         publisher='Большой толковый словарь русских глаголов, словари Грамоты',
         access='indexed_primary_dictionary_fragment_in_search_page',
         evidence='Карточка ЗАГОРАТЬ содержит загоре́ть в качестве совершенного вида; использована только эта явно показанная словарная форма, а не сам нерелевантный запрос страницы.'),
]

analyses = [
    [
        ('В значении пожелания это цельный фразеологизм; внутренняя запятая не нужна.', ['S1', 'S2', 'S3']),
        ('Цельное фразеологическое сочетание; запятая между компонентами не ставится.', ['S1', 'S3']),
        ('Устойчивое наречное выражение о раннем времени; без внутренней запятой.', ['S1', 'S3']),
        ('Цельное устойчивое сочетание; вариант с ё допустим и соответствует словарному написанию.', ['S1', 'S3']),
    ],
    [
        ('В зага́р ударение падает на А корня -гар-.', ['S4', 'S5']),
        ('В загоре́ть ударение на Е, О корня -гор- безударна.', ['S4', 'S10']),
        ('В уга́р А корня под ударением.', ['S4', 'S5', 'S6']),
        ('В угоре́ть ударение на Е, корневая О без ударения.', ['S4', 'S5', 'S6']),
    ],
    [
        ('В прямом вопросе кто — вопросительное местоимение; оно является подлежащим.', ['S8']),
        ('Кто присоединяет изъяснительную придаточную часть и остаётся её подлежащим; это относительное местоимение и союзное слово.', ['S8', 'S9']),
        ('Чей запрашивает принадлежность и употреблено как вопросительное местоимение.', ['S8']),
        ('Чей связывает части СПП; в придаточной части выступает определением к шарф. Это союзное слово, а не союз.', ['S8', 'S9']),
    ],
]

caption_notes = [
    ['Указаны пожелание и устойчивые сочетания; нет ложного общего запрета на запятую при повторяющемся ни.',
     'Значения устойчивых выражений переданы допустимо; свободное перечисление явно отделено.'],
    ['Все четыре ударения и орфограммы верны. Три названных слова действительно содержат безударную А. Список не заявлен исчерпывающим.',
     'Правило верно только для данного чередующегося корня. Для неполного списка исключений рекомендовано слово «например»; это уточнение не затрагивает выбранную A.'],
    ['Различены вопросительное и относительное употребления; связь частей обозначена верно.',
     'Утверждение о члене придаточной части верно: кто — подлежащее, чей — определение; оба являются союзными словами.'],
]

assert len(draft['posts']) == len(release['posts']) == 3
posts = []
for i, (d, p) in enumerate(zip(draft['posts'], release['posts'])):
    assert d['id'] == p['id']
    assert len(p['rows']) == 4
    assert projection(d) == projection(p), 'Final text differs from proofread draft: ' + p['id']
    reviewed_rows = []
    for j, ((left, right), (note, refs)) in enumerate(zip(p['rows'], analyses[i]), 1):
        reviewed_rows.append(dict(row=j, left=left, right=right, verdict='pass', analysis=note,
                                  sourceIds=refs, sourceUrls=[s['url'] for s in sources if s['id'] in refs]))
    captions = []
    for j, cap in enumerate(d['captionVariants']):
        captions.append(dict(variant='AB'[j], text=cap, sha256=sha(cap.encode('utf-8')),
                             selected=(cap == p['caption']), verdict='pass', note=caption_notes[i][j]))
    posts.append(dict(id=p['id'], verdict='pass', rowCount=4, rows=reviewed_rows,
                      captions=captions, titleVerdict='pass', kickerVerdict='pass',
                      qualifiers=([
                          'Оценка строк относится к устойчивым значениям; буквальное перечисление требует другого пунктуационного анализа.'
                      ] if i == 0 else [
                          'А/О относятся к гласной корня, не ко всем гласным слова.',
                          'Список трёх исключений учебный, не исчерпывающий; правило не переносится на корни-омонимы.'
                      ] if i == 1 else [
                          'Роль «связывает части» не отменяет синтаксической функции внутри придаточного.',
                          'В этих двух СПП местоимения являются союзными словами.'
                      ])))

without_status = [{k: v for k, v in p.items() if k != 'status'} for p in release['posts']]
text_sha = sha(canonical([projection(p) for p in release['posts']]))
posts_sha = sha(canonical(without_status))
verdict = dict(
    verdict='pass', checkedAt=now, releasePath=str(release_path),
    releaseSha256AtReview=sha(release_bytes), normalizedPostsWithoutStatusSha256=posts_sha,
    textProjectionSha256=text_sha,
    normalization='json.dumps(posts_without_top_level_status, ensure_ascii=False, sort_keys=True, separators=(comma,colon)).encode(utf-8)',
    textProjectionKeys=keys, posts=3, rows=12, captionVariantsReviewed=6,
    textEqualsProofreadDraft=True, all12RowsUnchanged=True,
    selectedCaptions='A,A,A', selectedCaptionsRequireCorrection=False,
    statusAndRevisionHeaderOutsideTextReview=True, sourceCount=len(sources),
    limitations=['Часть страниц Грамоты проверена по индексированным первичным фрагментам: прямое открытие возвращало 403.',
                 'Проверка языковая. Не подтверждает визуальную приёмку, разрешение автора, GitHub или публикацию.'])
report = dict(
    schemaVersion=1, role='independent Russian-language proofreader', checkedAt=now,
    verdict='pass', scope='classic35–37: 3 ролика, 12 пар, 6 вариантов подписи',
    sourceDraftPath=str(draft_path), sourceDraftSha256=sha(draft_bytes),
    finalReview=verdict, counts=dict(posts=3, rows=12, captionVariants=6, selectedCaptions=3,
                                   adult=1, ege=1, oge=1, olympiad=0, primarySources=len(sources)),
    sources=sources, posts=posts,
    editorialRecommendation=dict(postId='2026-11-classic-36-gar-gor', variant='B',
        requiredForSelectedRelease=False,
        action='Добавить «например» перед перечнем трёх исключений, если этот вариант сохраняется как резервный; в A обязательной правки нет.'),
    claimBoundaries=['Учебные фразы не приписаны официальным КИМ; номер задания и год экзамена не заявлены.',
                     'Истории учеников и измеренные результаты отсутствуют.',
                     'Нет нового утверждения о вирусности или частотности.',
                     'Формат и расписание не являются предметом языковой авторизации.'],
    limitations=verdict['limitations'])
for name, data in [('factcheck.json', report), ('final-text-verdict.json', verdict)]:
    (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

md = [
    '# Независимая языковая проверка classic35–37', '',
    f'Результат: PASS. Проверено {now}: 3 ролика, 12 пар, 6 вариантов подписи; выбранные A,A,A правок не требуют.', '',
    '35: правило относится к устойчивым выражениям. 36: исключения выгарки/изгарь/пригарь и безударная А подтверждены РАН; тройка не исчерпывает словарный список. 37: относительные местоимения являются союзными словами и членами придаточной части.', '',
    'Резервная 36B: рекомендовано «например» перед списком исключений. Это уточнение не требуется для выбранной подписи A.', '',
    '| Ролик / строка | Пара | Вердикт и основание | Источники |',
    '|---|---|---|---|',
]
for p in posts:
    for r in p['rows']:
        refs = ', '.join(f'[{sid}]({next(s["url"] for s in sources if s["id"] == sid)})' for sid in r['sourceIds'])
        md.append(f'| {p["id"].split("classic-")[1]} / {r["row"]} | {r["left"]} → {r["right"]} | PASS. {r["analysis"]} | {refs} |')
md.extend(['', 'Проверка обеих подписей каждого ролика:', ''])
for p in posts:
    for c in p['captions']:
        md.append(f'- {p["id"]} / {c["variant"]}: PASS. {c["note"]}')
md.extend(['', 'Привязка к фактическому release:', '',
           f'- Файл: `{release_path}`',
           f'- SHA256 файла на момент проверки: `{verdict["releaseSha256AtReview"]}`',
           f'- SHA256 всех posts без верхнего поля status: `{posts_sha}`',
           f'- SHA256 текстовой проекции: `{text_sha}`',
           '- Нормализация: UTF-8, ensure_ascii=False, sort_keys=True, separators=(",", ":").',
           '- Все 12 пар и выбранные подписи совпали с проверенным drafts.json; дата, активы и служебные поля не интерпретируются как языковые факты.',
           '', 'Первичные источники и фактический доступ:', ''])
for s in sources:
    md.append(f'- [{s["id"]}: {s["title"]}]({s["url"]}) — {s["access"]}. {s["evidence"]}')
md.extend(['', 'Ограничения: часть первичных материалов Грамоты доступна только индексированными фрагментами; полное открытие возвращало 403. Большие PDF целиком не прочитаны. Полные страницы РАН ОРОСС, Академоса и академического текста Orthographia открыты. Проверка не подтверждает рендер, одобрение автора, GitHub или публикацию.', ''])
(out / 'factcheck.md').write_text('\n'.join(md), encoding='utf-8')
print(json.dumps(verdict, ensure_ascii=False, indent=2))
