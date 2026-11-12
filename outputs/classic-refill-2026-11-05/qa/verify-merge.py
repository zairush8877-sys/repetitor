#!/usr/bin/env python3
"""Independent read-only verifier. Inputs never mutated; writes a QA report only."""
import argparse
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zoneinfo import ZoneInfo

ROOT = Path('/private/tmp/mama-classic-refill-2026-11-05')
NEW_OUTPUT = ROOT / 'project/outputs/classic-refill-2026-11-05'
EXPECTED_IDS = [
    '2026-11-classic-23-apellyatsiya',
    '2026-11-classic-24-prichastiya',
    '2026-11-classic-25-osnova',
    '2026-11-classic-26-ne-vvodnye',
    '2026-11-classic-27-kratkie-prichastiya',
    '2026-11-classic-28-kogda',
]
MEDIA_FIELDS = ['imageUrls', 'videoUrls', 'videoUrl', 'coverOffsetMs', 'coverUrl',
                'music', 'background', 'lightBg', 'generatedBg']
DECODER = json.JSONDecoder()
MSK = ZoneInfo('Europe/Moscow')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def whitespace(text, pos):
    while pos < len(text) and text[pos].isspace():
        pos += 1
    return pos


def object_raw_values(text):
    """Extract literal value fragments, preserving all inner whitespace/escapes."""
    pos = whitespace(text, 0)
    if text[pos] != '{':
        raise ValueError('Expected an object')
    pos += 1
    result = {}
    while True:
        pos = whitespace(text, pos)
        if text[pos] == '}':
            return result
        key, pos = DECODER.raw_decode(text, pos)
        if key in result:
            raise ValueError('Duplicate JSON object key: ' + str(key))
        pos = whitespace(text, pos)
        if text[pos] != ':':
            raise ValueError('Expected object colon')
        pos = whitespace(text, pos + 1)
        start = pos
        _, pos = DECODER.raw_decode(text, pos)
        result[key] = text[start:pos]
        pos = whitespace(text, pos)
        if text[pos] == '}':
            return result
        if text[pos] != ',':
            raise ValueError('Expected object separator')
        pos += 1


def array_raw_values(text):
    pos = whitespace(text, 0)
    if text[pos] != '[':
        raise ValueError('Expected an array')
    pos += 1
    result = []
    while True:
        pos = whitespace(text, pos)
        if text[pos] == ']':
            return result
        start = pos
        _, pos = DECODER.raw_decode(text, pos)
        result.append(text[start:pos])
        pos = whitespace(text, pos)
        if text[pos] == ']':
            return result
        if text[pos] != ',':
            raise ValueError('Expected array separator')
        pos += 1


def load_document(root, relative):
    text = (root / relative).read_text()
    return json.loads(text), object_raw_values(text)


def parse_instant(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=ROOT / 'base/content')
    parser.add_argument('--merged', type=Path, default=ROOT / 'merged-content')
    parser.add_argument('--media-root', type=Path, default=NEW_OUTPUT / 'content')
    parser.add_argument('--report', type=Path, default=ROOT / 'qa/merge-independent-audit.json')
    args = parser.parse_args()
    report = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'mode': 'Read-only input audit; no publication, reconciliation or GitHub mutation',
              'base': str(args.base), 'merged': str(args.merged),
              'mediaRoot': str(args.media_root), 'checks': [], 'errors': []}

    def check(name, condition, detail=None):
        result = {'name': name, 'pass': bool(condition)}
        if detail is not None:
            result['detail'] = detail
        report['checks'].append(result)
        if not condition:
            report['errors'].append(name)

    def preserve_top(a, b, excluded, label):
        ak, bk = set(a) - set(excluded), set(b) - set(excluded)
        changed = [k for k in sorted(ak | bk) if a.get(k) != b.get(k)]
        check(label, ak == bk and not changed, changed)

    def local_file(relative):
        root = args.media_root.resolve()
        file = (root / relative).resolve()
        if not file.is_relative_to(root):
            raise ValueError('Media path escapes content root: ' + relative)
        return file

    try:
        docs = {}
        for relative in ['queue.json', 'prepared/index.json', 'reposts/index.json',
                         'active-feed-campaign.json']:
            docs[relative] = (load_document(args.base, relative), load_document(args.merged, relative))
        (bq, bqr), (mq, mqr) = docs['queue.json']
        (bp, bpr), (mp, mpr) = docs['prepared/index.json']
        (br, brr), (mr, mrr) = docs['reposts/index.json']
        (bc, bcr), (mc, mcr) = docs['active-feed-campaign.json']
        old_ids = [p['id'] for p in bq['posts']]
        merged_ids = [p['id'] for p in mq['posts']]
        new_ids = [i for i in merged_ids if i not in old_ids]
        by_id = {p['id']: p for p in mq['posts']}
        check('baseline counts are129 queue81 prepared84 repost',
              (len(old_ids), len(bp['posts']), len(br['posts'])) == (129, 81, 84))
        check('queue has135 unique IDs', len(merged_ids) == 135 and len(set(merged_ids)) == 135)
        check('six exact expected IDs appended in order', new_ids == EXPECTED_IDS and
              merged_ids[:129] == old_ids and merged_ids[129:] == EXPECTED_IDS, new_ids)
        check('all129 old queue objects equal', mq['posts'][:129] == bq['posts'])
        raw_old = array_raw_values(bqr['posts'])
        raw_merged = array_raw_values(mqr['posts'])
        changed_old_raw = [old_ids[i] for i, raw in enumerate(raw_old)
                           if i >= len(raw_merged) or raw != raw_merged[i]]
        check('all129 old queue objects literal-byte-identical', not changed_old_raw, changed_old_raw)
        preserve_top(bqr, mqr, ['posts'], 'queue other top fields literal-byte-identical')
        for label, original, merged, raw_original, raw_updated, expected in [
                ('prepared', bp, mp, bpr, mpr, 81),
                ('reposts', br, mr, brr, mrr, 84)]:
            raw_a = object_raw_values(raw_original['posts'])
            raw_b = object_raw_values(raw_updated['posts'])
            changed = [i for i, item in original['posts'].items()
                       if i not in merged['posts'] or item != merged['posts'][i]]
            changed_bytes = [i for i, raw in raw_a.items() if raw_b.get(i) != raw]
            check('all' + str(expected) + ' old ' + label + ' entries equal', not changed, changed)
            check('all' + str(expected) + ' old ' + label + ' entries literal-byte-identical',
                  not changed_bytes, changed_bytes)
            check(label + ' adds only six expected IDs',
                  len(merged['posts']) == expected + 6 and
                  set(merged['posts']) - set(original['posts']) == set(EXPECTED_IDS))
            preserve_top(raw_original, raw_updated, ['posts'], label + ' other top fields literal-byte-identical')
        check('15 primary voice slots unchanged', len(mc['slots']) == 15 and mc['slots'] == bc['slots']
              and mcr['slots'] == bcr['slots'])
        preserve_top(bcr, mcr, ['additionalSlots'], 'all campaign fields except additionalSlots literal-byte-identical')
        check('additionalSlots preserves22 old objects and appends6',
              len(mc['additionalSlots']) == 28 and mc['additionalSlots'][:22] == bc['additionalSlots']
              and [s['postId'] for s in mc['additionalSlots'][22:]] == EXPECTED_IDS)
        raw_a_slots = array_raw_values(bcr['additionalSlots'])
        raw_m_slots = array_raw_values(mcr['additionalSlots'])
        check('all22 original additional slot objects literal-byte-identical',
              raw_m_slots[:22] == raw_a_slots)
        slots = mc['slots'] + mc['additionalSlots']
        slot_ids = [s['postId'] for s in slots]
        check('calendar has43 unique posts and instants', len(slots) == 43 and
              len(set(slot_ids)) == 43 and len(set(s['scheduledAt'] for s in slots)) == 43)
        mismatches = []
        for slot in slots:
            p = by_id.get(slot['postId'], {})
            instant = parse_instant(slot['scheduledAt'])
            if not (p.get('date') == slot['date'] and p.get('scheduledAt') == slot['scheduledAt']
                    and p.get('campaignId') == mc['id'] and instant.astimezone(MSK).date().isoformat() == slot['date']):
                mismatches.append(slot['postId'])
        check('all43 calendar and queue identities match', not mismatches, mismatches)
        horizon = []
        for day in range(6, 13):
            date = '2026-11-' + str(day).zfill(2)
            current = [s for s in mc['additionalSlots'] if s['date'] == date]
            times = sorted(parse_instant(s['scheduledAt']).astimezone(MSK).strftime('%H:%M') for s in current)
            ready = all(by_id[s['postId']]['status'] in ['approved', 'published'] and
                        s['postId'] in mp['posts'] and s['postId'] in mr['posts'] for s in current)
            horizon.append({'date': date, 'count': len(current), 'times': times, 'ready': ready})
            check(date + ' has exactly3 ready classic slots at10/14/19',
                  len(current) == 3 and len(set(s['postId'] for s in current)) == 3
                  and times == ['10:00', '14:00', '19:00'] and ready)
        report['horizon'] = horizon
        school_week = [s['postId'] for s in mc['additionalSlots']
                       if '2026-11-09' <= s['date'] <= '2026-11-15' and by_id[s['postId']].get('school') is True]
        check('classic school quotaNov9–15 exactlyclassic07',
              school_week == ['2026-11-classic-07-bukvy-zvuki'], school_week)
        report['schoolQuotaScope'] = 'Additional classic slots only; immutable15 primary voice slots retain existing schoolQuotaOverride=true.'
        future_voice = [s['postId'] for s in mc['slots'] if s['date'] >= '2026-11-06']
        bq_by_id = {p['id']: p for p in bq['posts']}
        check('all12 future voice objects unchanged', len(future_voice) == 12 and
              all(by_id[i] == bq_by_id[i] for i in future_voice))
        old_last = max(bc['additionalSlots'], key=lambda s: s['scheduledAt'])
        new_slots = sorted(mc['additionalSlots'][22:], key=lambda s: s['scheduledAt'])
        sequence = [by_id[old_last['postId']]] + [by_id[s['postId']] for s in new_slots]
        photo_ids = [p['assetSelection']['photoId'] for p in sequence]
        music_ids = [p['assetSelection']['musicId'] for p in sequence]
        check('rotation boundary isold desk/Bach tonew blank/Chopin',
              photo_ids[:2] == ['desk-books-laptop', 'blank-books-table'] and
              music_ids[:2] == ['bach-var1-ishizaka', 'chopin-op62-no1'])
        check('every consecutive old/new photo and music differs',
              all(photo_ids[i] != photo_ids[i+1] and music_ids[i] != music_ids[i+1]
                  for i in range(len(sequence) - 1)))
        report['rotation'] = [{'postId': p['id'], 'photoId': photo_ids[i], 'musicId': music_ids[i]}
                              for i,p in enumerate(sequence)]
        # Use the exact baseline Node draftKey function; Python float serialization differs from JS.
        node_code = r"""
const fs=require('fs'),vm=require('vm'),path=require('path');
const base=process.argv[1],merged=process.argv[2],ids=JSON.parse(process.argv[3]);
const m={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'..','prepared-media.js'),'utf8'),
  {require:n=>n==='./repost-state'?{}:require(n),module:m,exports:m.exports,process,__dirname:base,Buffer});
const q=JSON.parse(fs.readFileSync(path.join(merged,'queue.json'),'utf8'));
console.log(JSON.stringify(ids.map(id=>{const p=q.posts.find(p=>p.id===id);return {postId:id,draftKey:m.exports.draftKey(p)};})));
"""
        proc = subprocess.run(['node', '-e', node_code, str(args.base), str(args.merged),
                               json.dumps(EXPECTED_IDS)], capture_output=True, text=True, check=True)
        computed_keys = {x['postId']: x['draftKey'] for x in json.loads(proc.stdout)}
        check('six distinct draftKeys', len(set(computed_keys.values())) == 6)
        media_rows = []
        url_prefix = 'https://raw.githubusercontent.com/zairush8877-sys/repetitor/main/content/'
        for post_id in EXPECTED_IDS:
            p, e, r = by_id[post_id], mp['posts'][post_id], mr['posts'][post_id]
            check(post_id + ' approved current draftKey', p['status'] == 'approved' and
                  e['draftKey'] == computed_keys[post_id])
            check(post_id + ' classic format footer and Stories settings',
                  p['format'] == 'Reels' and p['visualStyle'] == 'classic-table' and
                  p['hideFooter'] is True and p['showProgress'] is False and
                  p['storyRepostMode'] == 'full_video' and p['branding'] ==
                  {'show_handle': False, 'show_author_signature': False, 'show_services_footer': False})
            check(post_id + ' music selection matches prepared',
                  p['assetSelection']['musicId'] == e['media']['music']['id'] and
                  p['assetSelection']['musicOffsetSeconds'] == e['media']['music']['offsetSeconds'])
            files = e['files']
            video = next((f for f in files if f['url'] == e['media']['videoUrl']), None)
            cover = next((f for f in files if f['url'] == e['media']['coverUrl']), None)
            check(post_id + ' exactlyfeed MP4 and cover JPG', len(files) == 2 and video is not None
                  and cover is not None and video['relative'].endswith('.mp4') and
                  cover['relative'].endswith('.jpg'))
            for media_file in files:
                relative = media_file['relative']
                file = local_file(relative)
                exists = file.is_file()
                actual = sha256(file.read_bytes()) if exists else None
                check(post_id + ' ' + relative + ' actual SHA/size/URL', exists and
                      actual == media_file['sha256'] and file.stat().st_size == media_file['size']
                      and media_file['url'] == url_prefix + relative,
                      {'expectedSha256': media_file['sha256'], 'actualSha256': actual})
            assets = r['assets']
            check(post_id + ' one fullVIDEO Story export', r['kind'] == 'reel_video' and
                  r.get('publicationStatus') == 'export_only' and len(assets) == 1 and
                  assets[0]['mediaType'] == 'VIDEO' and assets[0]['mimeType'] == 'video/mp4' and
                  assets[0]['width'] == 1080 and assets[0]['height'] == 1920)
            for asset in assets:
                file = local_file('reposts/' + asset['file'])
                actual = sha256(file.read_bytes()) if file.is_file() else None
                geometry = asset.get('geometry', {})
                check(post_id + ' complete Story identicaltofeed actualSHA',
                      actual is not None and actual == asset['sha256'] == video['sha256']
                      and geometry.get('sourceSha256') == video['sha256'] and
                      geometry.get('sha256') == video['sha256'] and
                      asset['sourceUrl'] == video['url'] and
                      asset['url'] == url_prefix + 'reposts/' + asset['file'],
                      {'videoSha256': video['sha256'], 'storySha256': actual})
            media_rows.append({'postId': post_id, 'draftKey': e['draftKey'],
                               'videoSha256': video['sha256'], 'storySha256': assets[0]['sha256']})
        check('six distinct video Story hashes', len(set(m['videoSha256'] for m in media_rows)) == 6)
        report['newMedia'] = media_rows
        report['numbers'] = {'oldQueuePreserved': 129 - len(changed_old_raw),
                             'queueTotal': len(merged_ids), 'preparedOld': len(bp['posts']),
                             'preparedTotal': len(mp['posts']), 'repostsOld': len(br['posts']),
                             'repostsTotal': len(mr['posts']), 'voiceSlots': len(mc['slots']),
                             'calendarTotal': len(slots), 'newIds': len(new_ids),
                             'horizonClassicSlots': sum(d['count'] for d in horizon),
                             'classicSchoolWeekNov9': len(school_week)}
    except Exception as exc:
        report['errors'].append(type(exc).__name__ + ': ' + str(exc))
    report['passed'] = not report['errors']
    report['passedChecks'] = sum(c['pass'] for c in report['checks'])
    report['totalChecks'] = len(report['checks'])
    report['limitations'] = ['This audit checks preservation, scheduling and actual media hashes. It does not establish listening, author creative approval, media decode success or Instagram publication.']
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'checks': str(report['passedChecks']) + '/' + str(report['totalChecks']),
                      'numbers': report.get('numbers'), 'errors': report['errors'], 'report': str(args.report)},
                     ensure_ascii=False, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
