from pathlib import Path
from datetime import datetime, timezone
import json, hashlib
p=Path('/private/tmp/mama-classic-refill-2026-11-07/editorial')
b=(p/'drafts.json').read_bytes(); drafts=json.loads(b)
S={}
def source(key,title,url,locator,access='indexed_primary_extract'):
 S[key]={'title':title,'url':url,'locator':locator,'access':access}
source('online-ran','Русский орфографический словарь РАН: онлайн-/офлайн-',
 'https://gramota.ru/poisk?dicts%5B0%5D=71&mode=slovari&query=%D0%BE%D0%BD%D0%BB%D0%B0%D0%B9%D0%BD&simple=0',
 'Обе первые части сложных слов присоединяются дефисом; отдельно указаны самостоятельные онлайн, офлайн.')
source('online-spravka','Справочная служба Грамоты №272946',
 'https://gramota.ru/spravka/vopros/272946',
 'Онлайн самостоятельно слитно; как первая часть сложных слов — через дефис.')
source('ran-orthographic','Русский орфографический словарь РАН, Лопатин/Иванова',
 'https://gramota.ru/storage/public/normdicts/orfograficheskij_slovar.pdf',
 'Статьи компания, кампания, зато; компания — группа людей/объединение; зато союз, за то местоименное сочетание.')
source('company-meaning','Л. П. Крысин. Современный словарь иностранных слов',
 'https://gramota.ru/storage/public/normdicts/slovar_inostr_slov.pdf',
 'Компания: группа людей или коммерческая организация. Метафора: переносное значение на основании сходства.')
source('campaign','Метасловарь Грамоты: кампания',
 'https://gramota.ru/meta/kampaniya',
 'Мероприятия, связанные целью; явно приведена избирательная кампания. Прямое открытие403, поисковое извлечение доступно.')
source('ne146-150','Полный академический справочник под ред. Лопатина: НЕ',
 'https://orthographia.ru/orfografia.php?sid=76',
 '§146 п.1б — краткие причастия; §150 — полные причастия с зависимыми словами, противопоставлением или без них.',
 'full_page_open; relevant_lines236-243_and312-322')
source('zato140','Полный академический справочник под ред. Лопатина: §140 п.2',
 'https://orthographia.ru/orfografia.php?sid=74',
 'Зато — слитный союз; за то — предлог с самостоятельно употреблённым местоимением.',
 'full_page_open; relevant_lines204-210')
source('simple-complex','Е. И. Литневская: Простое предложение. Главные члены',
 'https://gramota.ru/biblioteka/spravochniki/prostoe-predlozhenie',
 'Одна грамматическая основа — простое предложение, несколько — сложное. Прямое открытие403, индексированный текст получен.')
source('homogeneous27','Академический справочник на Грамоте: однородные члены',
 'https://gramota.ru/biblioteka/spravochniki/pravila-russkoy-orfografii-i-punktuatsii/znaki-prepinaniya-pri-odnorodnykh-chlenakh-predlozheniya',
 '§27: между однородными членами с одиночным И запятая не ставится.')
source('comparison','Метасловарь Грамоты: сравнение',
 'https://gramota.ru/meta/sravnenie',
 'Уподобление одного предмета или ситуации другому; содержится словарное определение литературного приёма.')
source('metaphor','Словари Грамоты: метафора',
 'https://gramota.ru/poisk?mode=all&query=%D0%BC%D0%B5%D1%82%D0%B0%D1%84%D0%BE%D1%80%D0%B0',
 'Большой толковый словарь и словарь иностранных слов: переносное употребление на основании сходства.')
source('wall','Метасловарь Грамоты: стена',
 'https://gramota.ru/meta/stena',
 'Значение6: сплошная масса/тесный ряд; прямо приведено стена леса. Пример языковой метафоры.')
R=[
 [
  ('Онлайн- как первая часть перед встреча присоединяется дефисом.',['online-ran','online-spravka']),
  ('Онлайн- как первая часть перед курс присоединяется дефисом.',['online-ran','online-spravka']),
  ('Офлайн- как первая часть перед магазин присоединяется дефисом; в офлайн одна ф.',['online-ran']),
  ('Офлайн- как первая часть перед встреча присоединяется дефисом.',['online-ran'])
 ],
 [
  ('Полное причастие без зависимых слов и отрицательного противопоставления в данном контексте — слитно.',['ne146-150']),
  ('Мной — зависимое слово с обозначением деятеля; НЕ с данным полным причастием раздельно.',['ne146-150']),
  ('Прочитана — краткое страдательное причастие; НЕ раздельно.',['ne146-150']),
  ('Конструкция не..., а... явно отрицает один признак и утверждает другой; раздельно. Определяемое слово книга опущено в учебном фрагменте.',['ne146-150'])
 ],
 [
  ('Одна основа: солнце встало и согрело; оба однородных сказуемых относятся к солнце.',['simple-complex','homogeneous27']),
  ('Две основы: солнце встало; сад ожил. Между частями бессоюзного сложного предложения запятая.',['simple-complex']),
  ('Одна основа: пёс проснулся и залаял; однородные сказуемые при одном подлежащем.',['simple-complex','homogeneous27']),
  ('Две основы: пёс залаял; кот убежал.',['simple-complex'])
 ],
 [
  ('Кампания с А: связанные общей рекламной целью мероприятия. Правая ячейка — краткая смысловая подсказка.',['campaign','ran-orthographic']),
  ('Компания с О: в сочетании страховая компания имеется в виду организация.',['company-meaning','ran-orthographic']),
  ('Избирательная кампания — словарно подтверждённый пример мероприятий с общей целью.',['campaign']),
  ('Компания с О: группа людей, находящихся вместе, в данном случае дружная.',['company-meaning','ran-orthographic'])
 ],
 [
  ('Зато — противительный союз; замена на но сохраняет основное отношение частей. Оттенок возмещения выражен союзом зато.',['zato140','ran-orthographic']),
  ('За то — предлог и указательное местоимение перед письмо; допустима замена то на это.',['zato140']),
  ('Зато — противительный союз; но тепло — смысловая подстановка с некоторой потерей оттенка компенсации.',['zato140']),
  ('За то — предлог и указательное местоимение перед дело; замена на за это дело поддерживает раздельное написание.',['zato140'])
 ],
 [
  ('Река прямо уподоблена ленте с помощью как; в данном образном учебном фрагменте сравнение.',['comparison']),
  ('Река образно названа лентой по сходству вытянутой формы; переносное употребление, метафора. Это анализ собственного примера по словарному критерию.',['metaphor','company-meaning']),
  ('Лес уподоблен стене с помощью словно; в данном образном контексте сравнение.',['comparison']),
  ('Стена обозначает плотный массив леса по сходству с преградой; языковая метафора. Словарное значение6 содержит этот пример.',['metaphor','wall'])
 ]
]
posts=[]
for post,checks in zip(drafts['posts'],R):
 rows=[]
 assert len(post['rows'])==len(checks)==4
 for number,(row,(analysis,ids)) in enumerate(zip(post['rows'],checks),1):
  rows.append({'row':number,'left':row[0],'right':row[1],
   'verdict':'pass','analysis':analysis,'sourceIds':ids,
   'sourceUrls':[S[k]['url'] for k in ids],
   'basis':'dictionary_rule_and_independent_analysis_of_own_example'})
 posts.append({'id':post['id'],'rubric':post['rubric'],'school':post['school'],
  'rowsVerdict':'pass','rows':rows,
  'captionVariantsReview':[{'variant':i+1,'verdict':'pass','reviewedText':s}
    for i,s in enumerate(post['captionVariants'])],
  'selectedCaptionVerdict':'pass','selectedCaption':post['caption'],
  'titleVerdict':'pass','title':post['title'],'headsVerdict':'pass',
  'heads':post.get('heads',['Неправильно','Правильно'])})
assert len(posts)==6 and sum(len(x['rows']) for x in posts)==24
assert sum(len(x['captionVariantsReview']) for x in posts)==12
assert hashlib.sha256(b).hexdigest()=='93cedf3884b21b8aa35f60566ebb6c5c7f3f4bbee6ad1d40bcab529029403698'
obj={'schemaVersion':1,'reviewedAt':datetime.now(timezone.utc).isoformat(),
 'role':'independent_russian_proofreader','verdict':'pass',
 'reviewedDraftPath':str(p/'drafts.json'),
 'reviewedDraftSha256':hashlib.sha256(b).hexdigest(),
 'totalPosts':6,'totalRows':24,'totalCaptionVariants':12,
 'distribution':{'adult_language':2,'EGE':2,'OGE':2,'extra_school_or_olympiad':0},
 'posts':posts,'sources':S,
 'appliedEditorialCorrections':[
  {'id':'2026-11-classic-29-online','field':'captionVariants[1]',
   'result':'Терминология исправлена: в первом случае, четыре сложных слова.'},
  {'id':'2026-11-classic-33-zato','field':'captionVariants[1]',
   'result':'Служебная информация о редакционном банке удалена.'},
  {'id':'2026-11-classic-34-metafora','field':'caption/captionVariants[0]',
   'result':'Убрано смешение реки и её русла; реку образно назвали лентой.'}],
 'caveats':[
  'Все предложения и образные сочетания рассматриваются как авторские учебные примеры, не цитаты из официальных КИМ и не задания конкретного номера/года.',
  'В29 дефис относится к первым частям сложного слова; в самостоятельном наречном употреблении встреча онлайн — раздельно.',
  'В30 правило ограничено указанными контекстами: не любое зависимое слово даёт раздельное написание. Для кратких причастий и противопоставления основания отдельные.',
  'В31 основа включает оба однородных сказуемых. Число глаголов не равно числу основ.',
  'В32 правые ячейки дают смысловые подсказки к указанным сочетаниям, не исчерпывающие определения. Компания/кампания — омофоны, не паронимы.',
  'В33 но и это — диагностические подстановки для четырёх конкретных случаев. Но не передаёт полностью оттенок возмещения у зато.',
  'В34 отсутствие как не доказывает метафору; не всякое словно автоматически создаёт троп. Стена леса — общеязыковая метафора; переносный смысл определяется контекстом.',
  'Заголовки колонок30–34 нейтральные: обе левые формы/конструкции верны; оформлять их как ошибочные нельзя.',
  'Значительная часть страниц Грамоты проверена через индексированные выдержки первичных словарей/справочников. Прямое открытие отдельных страниц403; полное чтение этих страниц не заявляется. Orthographia §140/146/150 открыта полностью.'
 ],
 'independentDedupe':json.loads((p/'independent-row-dedupe.json').read_text()),
 'checksNotPerformed':['media_render','audio_or_visual_QA','Instagram_publication','official_KIM_alignment_for_specific_task_number_or_year']}
(p/'factcheck.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
md=['# Независимая языковая проверка classic29–34','',
 'Вердикт: PASS. 6 постов, 24 строки, 12 вариантов подписи. Редакционные уточнения применены.',
 '',f"Дата: {obj['reviewedAt']}",'',
 f"Проверен drafts.json, SHA256 `{obj['reviewedDraftSha256']}`.",'']
for post in posts:
 md += [f"## {post['id']}",'',
  '| № | Левая ячейка | Правая ячейка | Вердикт и основание | Источники |',
  '|---|---|---|---|---|']
 for row in post['rows']:
  urls='; '.join(f'[{sid}]({S[sid]["url"]})' for sid in row['sourceIds'])
  md.append(f'| {row["row"]} | {row["left"]} | {row["right"]} | PASS. {row["analysis"]} | {urls} |')
 md += ['', 'Оба варианта подписи, выбранная подпись, заголовок и колонки: PASS.','']
md += ['## Оговорки и пределы проверки','']+[f'- {x}' for x in obj['caveats']]
md += ['','## Источники','']
for key,s in S.items():
 md.append(f'- **{key}**: [{s["title"]}]({s["url"]}). {s["locator"]} Доступ: `{s["access"]}`.')
md += ['','## Дополнительная проверка дублей','',
 'Сопоставлены 24 полные левые ячейки с текстовыми строками title/rows/slides/caption в124 approved/published записях свежейbase135. Точных совпадений не найдено. Это не доказательство смысловой уникальности; проверка дополняет редакционную проверку копирайтера.']
(p/'factcheck.md').write_text('\n'.join(md)+'\n')
print(json.dumps({'verdict':obj['verdict'],'posts':6,'rows':24,'captions':12,
 'draftSha256':obj['reviewedDraftSha256'],'sources':len(S)},ensure_ascii=False))
