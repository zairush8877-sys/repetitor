#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import hashlib
import unicodedata
from pathlib import Path
from datetime import datetime, timezone

base = Path('/private/tmp/mama-classic-refill-2026-11-10')
out = base / 'editorial'
draft_path = out / 'drafts.json'
release_path = base / 'project/outputs/classic-refill-2026-11-10/release.json'
queue_path = base / 'base/content/queue.json'
draft_bytes, release_bytes = draft_path.read_bytes(), release_path.read_bytes()
draft, release = json.loads(draft_bytes), json.loads(release_bytes)
now = datetime.now(timezone.utc).isoformat()
sha = lambda data: hashlib.sha256(data).hexdigest()
canon = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
keys = ['id', 'kicker', 'title', 'heads', 'rows', 'caption', 'hashtags', 'rubric', 'school']
projection = lambda post: {key: post[key] for key in keys if key in post}

def source(sid, title, url, evidence, access='full_primary_page', location=None):
    result = dict(id=sid, title=title, url=url, access=access, evidence=evidence)
    if location:
        result['location'] = location
    return result

sources = [
    source('S1', 'Академос РАН: стекло',
        'https://orfo.ruslang.ru/abc/part/es?end=151693&start=151393',
        'Словарная статья стекло́ имеет именные падежные и числовые формы.', location='Статья стекло, строка 198 веб-извлечения'),
    source('S2', 'Академос РАН: стечь',
        'https://orfo.ruslang.ru/abc/part/es?end=152057&start=151757',
        'Стечь дано как глагол с личными формами и прошедшими формами стёк, стекла́.', location='Статья стечь, строка 322'),
    source('S3', 'Академос РАН: стих и стихнуть',
        'https://orfo.ruslang.ru/abc/part/es?end=152295&start=151995',
        'Стих — существительное с родительным стиха́; у стихнуть прямо дана прошедшая форма стих.', location='Строки 104 и 131'),
    source('S4', 'О. Н. Чарыкова, З. Д. Попова, И. А. Стернин: Основы теории языка и коммуникации, 2010',
        'https://sterninia.ru/files/757/15_Studentam_i_aspirantam/Osnovy_jazykoznanija.pdf',
        'Авторское учебное пособие непосредственно сопоставляет существительное стекло с прошедшей формой среднего рода от стечь как примером омоформ.',
        access='primary_academic_book_on_author_site; relevant_passage_read', location='PDF страница 70, индекс страницы 69; строки 2837–2841'),
    source('S5', 'Грамота, ответ №333469: согласование причастий',
        'https://gramota.ru/spravka/vopros/333469',
        'Полные причастия согласуются с определяемым существительным в роде, числе и падеже; в предложном падеже приведены окончания -ом/-ем.',
        access='indexed_primary_answer_333469_in_related_search_page; direct_open_403'),
    source('S6', 'Полный академический справочник: обособленные согласованные определения, §46',
        'https://orthographia.ru/punctuatio.php?sid=118',
        'Оборот с зависимыми словами после определяемого существительного обособляется; правило применено к четырём фрагментам про лес.',
        access='full_primary_academic_text', location='§46.1'),
    source('S7', 'Грамота: тире, раздел о сложносочинённом предложении',
        'https://gramota.ru/journal/stati/pravila-i-normy/tire-funktsii-i-pravila-postanovki-v-russkom-yazyke',
        'Определение ССП включает равноправие частей и сочинительные союзы и, а и другие.',
        access='indexed_primary_explanation'),
    source('S8', 'Полный академический справочник: сложносочинённое предложение, §112',
        'https://orthographia.ru/punctuatio.php?sid=133',
        'И и а соединяют части ССП; между частями в обычном повествовательном случае ставится запятая.',
        access='full_primary_academic_text', location='§112'),
    source('S9', 'Полный академический справочник: сложноподчинённое предложение, §115',
        'https://orthographia.ru/punctuatio.php?sid=134',
        'Хотя и пока перечислены среди средств подчинительной связи; главная и придаточная части разделяются запятой.',
        access='full_primary_academic_text', location='§115'),
    source('S10', 'Академос РАН: какао',
        'https://orfo.ruslang.ru/abc/part/ka?end=54791&start=54491',
        'Какао указано как несклоняемое существительное среднего рода.', location='Статья какао, строка 308'),
    source('S11', 'Академос РАН: салями',
        'https://orfo.ruslang.ru/abc/part/es?end=139144&start=138844',
        'Салями указано как несклоняемое существительное женского рода.', location='Статья салями, строка 188'),
    source('S12', 'Академос РАН: сулугуни',
        'https://orfo.ruslang.ru/abc/part/es?end=153837&start=153537',
        'Сулугуни указано как несклоняемое существительное мужского рода.', location='Статья сулугуни, строка 400'),
    source('S13', 'Академос РАН: брокколи',
        'https://orfo.ruslang.ru/abc/part/be?end=13503&start=13203',
        'Брокколи указано как несклоняемое существительное женского рода.', location='Статья брокколи, строка 381'),
    source('S14', 'РАН, Орфографическое комментирование русского словаря: суффиксы глаголов, §34.2',
        'https://oross.ruslang.ru/paragraph/34',
        'Выбор ова/ева и ыва/ива связан с чередованием в личных формах; танцевать приведено отдельно для ева после ц. Исключения и глаголы с ударным ва рассматриваются отдельно.', location='§34.2, строки 209–245'),
    source('S15', 'Полный академический справочник: глагольные суффиксы, §61–62',
        'https://orthographia.ru/orfografia.php?sid=35',
        'У типа ова/ева форма первого лица имеет ую/юю; у ыва/ива суффикс сохраняется. Ударный ва выделен в следующий параграф.',
        access='full_primary_academic_text', location='§61–62'),
    source('S16', 'Полный академический справочник: обращения, §101',
        'https://orthographia.ru/punctuatio.php?sid=129',
        'Обращение называет адресата речи и отделяется или выделяется запятыми.',
        access='full_primary_academic_text', location='§101'),
    source('S17', 'Грамота, журнал Русский язык в школе: обращение и подлежащее',
        'https://gramota.ru/journal/stati/nasledie/otvety-redaktsii-zhurnala-russkiy-yazyk-v-shkole-na-voprosy-chitateley',
        'В ответе на вопрос о подлежащем прямо разъяснено: обращение не входит в члены предложения, подлежащее связано со сказуемым.',
        access='indexed_primary_editorial_answer; direct_open_403'),
    source('S18', 'Грамота, ответ №331508: стих в значении целого стихотворения',
        'https://gramota.ru/spravka/vopros/331508',
        'С опорой на БАС, т.27, 2021, значение целого стихотворения помечено как разговорное или устаревшее; из резервной подписи исключено ненужное обобщение.',
        access='indexed_primary_answer'),
]

row_analyses = [
    [
        ('В именном сочетании стекло называет предмет/материал; тонкое согласовано с существительным.', ['S1', 'S4']),
        ('В предложении молоко стекло слово стекло — прошедшая форма среднего рода глагола стечь.', ['S2', 'S4']),
        ('Стих в сочетании с короткий является существительным. Полное произведение в этом объяснении не определяется.', ['S3']),
        ('Стих — прошедшая форма мужского рода глагола стихнуть; ветер является подлежащим.', ['S3']),
    ],
    [
        ('Вопрос к полному причастию укрытый — какой. Изолированная форма допускает совпадение именительного и винительного; вопрос от этого не меняется.', ['S5', 'S6']),
        ('В лесу обозначает местонахождение: предложный падеж; причастие укрытом имеет вопрос каком.', ['S5', 'S6']),
        ('Над лесом — творительный падеж, укрытым согласовано с лесом; вопрос каким.', ['S5', 'S6']),
        ('К лесу — дательный падеж; согласованное причастие укрытому имеет вопрос какому.', ['S5', 'S6']),
    ],
    [
        ('Две основы дождь идёт / я гуляю соединены сочинительным а; части грамматически равноправны.', ['S7', 'S8']),
        ('Хотя присоединяет придаточную уступки к главной части я гуляю; есть подчинение.', ['S9']),
        ('Основы я замёрз / мы ушли соединены сочинительным и. Возможная причинность смысла не меняет тип связи.', ['S7', 'S8']),
        ('Пока ждал — придаточная времени при я замёрз; вопрос когда. Пропуск повторного я не устраняет подчинение.', ['S9']),
    ],
    [
        ('Какао среднего рода; прилагательное горячее должно быть среднего рода.', ['S10']),
        ('Салями женского рода, поэтому острая.', ['S11']),
        ('Сулугуни мужского рода, поэтому свежий.', ['S12']),
        ('Брокколи женского рода, поэтому полезная.', ['S13']),
    ],
    [
        ('Советую — форма первого лица советовать; в инфинитиве ова, в личной форме ую.', ['S14', 'S15']),
        ('Танцую — форма первого лица танцевать; ева после ц прямо подтверждено РАН.', ['S14', 'S15']),
        ('Опаздываю соответствует опаздывать: ыва сохраняется в обеих основах.', ['S14', 'S15']),
        ('Откладываю соответствует откладывать: ыва сохраняется в обеих основах.', ['S14', 'S15']),
    ],
    [
        ('Лена называет адресата побуждения читай и отделена запятой: обращение.', ['S16', 'S17']),
        ('Лена грамматически связана со сказуемым читает и является подлежащим; запятая не нужна.', ['S17']),
        ('Друзья называет адресатов побуждения подождите и отделено запятой: обращение.', ['S16', 'S17']),
        ('Друзья связано со сказуемым ждут во множественном числе и является подлежащим.', ['S17']),
    ],
]

caption_notes = [
    ['Верно названы два существительных и два глагола с инфинитивами. Есть родительская рамка и авторская подача; официальный тур не заявлен.',
     'Совпадение форм объяснено через контекст. Описание стиха как целого произведения удалено; формальный ярлык полных лексических омонимов не используется.'],
    ['Предложный при местонахождении в лесу и творительный над лесом определены верно; объясняется согласование полного причастия.',
     'Дательный в сочетании к лесу указан верно. Снята неоднозначная квалификация изолированного укрытый лес как исключительно именительного.'],
    ['Равноправие прямо названо грамматическим; для хотя верно выделены главная и придаточная.',
     'Смысловая причинность отделена от грамматического сочинения. Пока ждал относится ко времени замерзания; когда — корректный вопрос.'],
    ['Все четыре рода и формы прилагательных подтверждены текущим Академосом; несклоняемость не смешивается с отсутствием рода.',
     'Соотношение неизменяемой формы и грамматического рода объяснено верно.'],
    ['Все четыре пары инфинитив/первое лицо верны; речь ограничена выбором данных глагольных суффиксов.',
     'Точная оговорка не распространяет приём на любой глагол, оканчивающийся в первом лице на ую.'],
    ['Обращение и подлежащее различены через адресата и грамматическую связь; утверждение о нечлене предложения соответствует школьному разбору.',
     'В данных четырёх контекстах различие роли и соответствующей запятой описано верно; универсального правила по одной только форме слова нет.'],
]

qualifiers = [
    ['Авторская компоновка известного языкового наблюдения; глобальная уникальность идеи не установлена и не заявлена.',
     'Материал не назван заданием официальной олимпиады, не приписаны номер, год, тур или результаты ученика.',
     'Название/действие — короткие смысловые подсказки, части речи точно названы в подписи.'],
    ['Проверяются полные формы причастия. Вопросы к причастию задаются от лес, предлог не является частью вопроса к зависимому определению.',
     'Фрагмент лес, укрытый снегом не доказывает единственный падеж без внешнего предложения; выбранная подпись этого не утверждает.',
     'Форма лесу в местном употреблении в лесу трактуется в школьной шестипадежной системе как предложный падеж.'],
    ['Равноправие грамматическое; причинно-следственный смысл возможен и при сочинительной связи.',
     'Неполнота придаточного пока ждал не превращает его в простое предложение или однородное сказуемое главной части.'],
    ['Слова употребляются как самостоятельные названия продуктов, без явно выраженного другого главного существительного.',
     'Полезная — пример грамматического согласования, не индивидуальная рекомендация по питанию.'],
    ['Приём относится к выбору ова/ева и ыва/ива, а не к любому набору букв ую.',
     'Глаголы с ударным ва и словарные исключения требуют отдельного анализа; они не входят в эти четыре пары.'],
    ['Роль определяется по конкретному контексту, адресации и сказуемому, а не по наличию имени или слова друзья само по себе.',
     'Обращение не включается в грамматическую основу по принятому школьному разбору.'],
]

assert len(draft['posts']) == len(release['posts']) == 6
assert sum(len(p['rows']) for p in release['posts']) == 24
assert sum(bool(p.get('school')) for p in release['posts']) == 1
post_reports = []
for i, (d, p) in enumerate(zip(draft['posts'], release['posts'])):
    assert d['id'] == p['id']
    assert projection(d) == projection(p), 'Text differs: ' + p['id']
    rows = []
    for j, (pair, analysis) in enumerate(zip(p['rows'], row_analyses[i]), 1):
        note, refs = analysis
        rows.append(dict(row=j, left=pair[0], right=pair[1], verdict='pass', analysis=note,
                         sourceIds=refs, sourceUrls=[s['url'] for s in sources if s['id'] in refs],
                         application='Independent application of cited dictionary/grammar to the authored context'))
    captions = [dict(variant='AB'[j], text=cap, sha256=sha(cap.encode('utf-8')),
                    selected=(cap == p['caption']), verdict='pass', note=caption_notes[i][j])
                for j, cap in enumerate(d['captionVariants'])]
    post_reports.append(dict(id=p['id'], verdict='pass', rows=rows, captions=captions,
                             titleVerdict='pass', kickerVerdict='pass', qualifiers=qualifiers[i]))

queue = json.loads(queue_path.read_bytes())
queue_posts = queue if isinstance(queue, list) else queue['posts']
existing = [p for p in queue_posts if p.get('status') in ('approved', 'published')]
def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFD', value.lower()) if unicodedata.category(c) != 'Mn')
    return ' '.join(value.replace('ё', 'е').split())
prior_pairs = {tuple(map(normalize, pair)): p['id'] for p in existing for pair in p.get('rows', [])
              if isinstance(pair, list) and len(pair) == 2 and all(isinstance(v, str) for v in pair)}
duplicates = [dict(id=p['id'], row=pair, previous=prior_pairs[tuple(map(normalize, pair))])
              for p in release['posts'] for pair in p['rows'] if tuple(map(normalize, pair)) in prior_pairs]
assert not duplicates, duplicates

posts_without_status = [{k: v for k, v in p.items() if k != 'status'} for p in release['posts']]
posts_sha = sha(canon(posts_without_status))
text_sha = sha(canon([projection(p) for p in release['posts']]))
limitations = [
    'Ряд страниц Грамоты проверен по индексированным первичным фрагментам, прямое открытие возвращало 403. Доступный контекст источника отмечен для каждого URL.',
    'Словарные статьи Академоса, ОРОСС и нужные разделы академического текста Orthographia открыты полностью; в большом авторском PDF прочитан только относящийся к задаче фрагмент.',
    'Языковая проверка не подтверждает визуальную приёмку, права на медиа, GitHub, включение расписания или публикацию.',
]
verdict = dict(verdict='pass', checkedAt=now, releasePath=str(release_path),
    releaseSha256AtReview=sha(release_bytes), normalizedPostsWithoutStatusSha256=posts_sha,
    textProjectionSha256=text_sha, textProjectionKeys=keys,
    normalization='json.dumps(posts_without_top_level_status, ensure_ascii=False, sort_keys=True, separators=(comma,colon)).encode(utf-8)',
    posts=6, rows=24, captionVariantsReviewed=12, selectedCaptions='A,A,A,A,A,A',
    textEqualsProofreadDraft=True, all24RowsUnchanged=True,
    selectedCaptionsRequireCorrection=False, mandatoryCorrectionsRemaining=0,
    statusAndRevisionHeaderOutsideTextReview=True, sourceCount=len(sources),
    limitations=limitations)
corrections = [
    dict(id=draft['posts'][0]['id'], variant='A', applied=True,
         correction='Убрано несуществующее отдельное визуальное выделение; существительные названы прямо.'),
    dict(id=draft['posts'][0]['id'], variant='B', applied=True, sourceIds=['S18'],
         correction='Удалено безусловное определение стиха как целого произведения; остаётся смысловой контекст существительного.'),
    dict(id=draft['posts'][1]['id'], variant='B', applied=True,
         correction='Убрано утверждение об исключительно именительном падеже вне предложения; разъяснён однозначный дательный к лесу.'),
]
report = dict(schemaVersion=1, role='independent Russian-language proofreader', checkedAt=now,
    verdict='pass', scope='classic38–43: 24 пары, 12 подписей',
    sourceDraftPath=str(draft_path), sourceDraftSha256=sha(draft_bytes),
    sourceQueuePath=str(queue_path), sourceQueueSha256=sha(queue_path.read_bytes()),
    counts=dict(posts=6, rows=24, captionVariants=12, selectedCaptions=6,
                adult=1, ege=2, oge=2, olympiad=1, schoolTrue=1, primarySources=len(sources)),
    sources=sources, posts=post_reports, editorialCorrections=corrections,
    finalReview=verdict,
    exactPairDedupe=dict(existingApprovedPublishedPosts=len(existing), normalizedPairsChecked=24,
                         duplicates=duplicates, scope='Exact normalized row-pair check only; does not claim semantic or global originality'),
    provenance=dict(olympiad='Authored examples and arrangement of a standard morphological observation; no official paper or pupil outcome attribution',
                    examExamples='Own study examples, no KIM task number/year assertion'),
    limitations=limitations)
out.mkdir(parents=True, exist_ok=True)
for name, value in [('factcheck.json', report), ('final-text-verdict.json', verdict)]:
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

lines = ['# Независимая языковая проверка classic38–43', '',
    f'PASS. {now}. Проверены 6 роликов, 24 пары и 12 подписей. Все выбранные A совпадают с фактическим release и не требуют правок.', '',
    'Состав: 1 взрослая норма, 2 ЕГЭ, 2 ОГЭ, 1 авторская олимпиадная разминка. Только classic38 имеет school:true. Это языковой вердикт; календарь, рендер и выпуск проверяются отдельно.', '',
    '| Ролик / строка | Пара | Вердикт и применение нормы | Источники |',
    '|---|---|---|---|']
for p in post_reports:
    for row in p['rows']:
        links = ', '.join(f'[{sid}]({next(s["url"] for s in sources if s["id"] == sid)})' for sid in row['sourceIds'])
        lines.append(f'| {p["id"].split("classic-")[1]} / {row["row"]} | {row["left"]} → {row["right"]} | PASS. {row["analysis"]} | {links} |')
lines.extend(['', 'Обе подписи каждого ролика:', ''])
for p in post_reports:
    for cap in p['captions']:
        lines.append(f'- {p["id"]} / {cap["variant"]}: PASS. {cap["note"]}')
lines.extend(['', 'Уточнения и границы:', ''])
for p in post_reports:
    lines.append(f'- {p["id"]}: ' + ' '.join(p['qualifiers']))
lines.extend(['', 'Редакторские правки в проверенной версии:', ''])
for correction in corrections:
    lines.append(f'- {correction["id"]} / {correction["variant"]}: {correction["correction"]}')
lines.extend(['', 'Привязка к файлам:', '',
    f'- Drafts SHA256: `{report["sourceDraftSha256"]}`',
    f'- Release: `{release_path}`',
    f'- SHA256 файла на момент проверки: `{verdict["releaseSha256AtReview"]}`',
    f'- Нормализованные posts без верхнего status: `{posts_sha}`',
    f'- Текстовая проекция: `{text_sha}`',
    '- Нормализация: UTF-8, ensure_ascii=False, sort_keys=True, separators=(",", ":").',
    f'- Дополнительно: среди {len(existing)} approved/published записей исходной очереди нет совпавших нормализованных пар. Это не доказательство глобальной уникальности идеи.',
    '', 'Первичные источники и фактический доступ:', ''])
for s in sources:
    lines.append(f'- [{s["id"]}: {s["title"]}]({s["url"]}) — {s["access"]}. {s["evidence"]}')
lines.extend(['', 'Ограничения:', ''])
lines.extend('- ' + note for note in limitations)
(out / 'factcheck.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps(verdict, ensure_ascii=False, indent=2))
