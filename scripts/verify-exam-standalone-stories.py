#!/usr/bin/env python3
"""Read-only media verification; writes only QA reports/contact sheets."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
base = root / 'outputs/exam-bank-2026-09-26/standalone-stories'
comp = root / 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64'
env = dict(os.environ, DYLD_LIBRARY_PATH=str(comp))
data = json.loads((base / 'index.json').read_text())
assert len(data['stories']) == 14 and data['status'] == 'pending' and data['publicationPerformed'] is False
checks = []
sources = {}
preview_count = 0
for story in data['stories']:
    assert story['status'] == 'pending' and 'date' not in story and len(story['parts']) == 2
    for part in story['parts']:
        file = base / part['file']
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        assert digest == part['sha256'] and part['width'] == 1080 and part['height'] == 1920 and part['fps'] == 30
        assert part['frames'] == round(part['duration'] * 30)
        assert part['geometry']['cropped'] is False
        for frame in part['decodedFrames']:
            assert Image.open(base / frame).size == (1080, 1920)
            preview_count += 1
        for source in part['sourceFiles']:
            sources[source['file']] = source['sha256']
        cmd = [str(comp / 'ffmpeg'), '-hide_banner', '-i', str(file), '-vn', '-af',
               'loudnorm=I=-20:TP=-1.5:LRA=11:print_format=json', '-c:a', 'pcm_s16le', '-f', 'null', '-']
        result = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        meter = json.loads(re.findall(r'\{[^{}]+\}', result.stderr.decode())[-1])
        lufs, peak = float(meter['input_i']), float(meter['input_tp'])
        assert math.isfinite(lufs) and -35 < lufs < -10 and peak < 0, (file, lufs, peak)
        checks.append({'file': part['file'], 'sha256': digest, 'duration': part['duration'], 'frames': part['frames'],
                       'audioLUFS': lufs, 'audioTruePeakDBTP': peak})
assert preview_count == 64 and len(sources) == 32 and len(checks) == 28
for source, digest in sources.items():
    assert hashlib.sha256((root / source).read_bytes()).hexdigest() == digest
sheets = []
for group in range(7):
    canvas = Image.new('RGB', (1080, 516), 'white')
    draw = ImageDraw.Draw(canvas)
    for n, story in enumerate(data['stories'][group * 2:group * 2 + 2]):
        for j, part in enumerate(story['parts']):
            image = Image.open(base / part['decodedFrames'][-1 if j else 0]).convert('RGB')
            image.thumbnail((270, 480))
            x = (n * 2 + j) * 270
            canvas.paste(image, (x, 36))
            draw.text((x + 8, 5), story['sourcePostId'][11:] + (' Q' if j == 0 else ' A final'), fill='black')
    file = base / 'qa' / f'verified-contact-{group + 1}.jpg'
    canvas.save(file, quality=94)
    sheets.append(str(file.relative_to(base)))
report = {'stories': 14, 'videos': 28, 'decodedScenePreviews': 64, 'sourceMp4ShaVerified': 32, 'status': 'pending',
          'publicationPerformed': False, 'liveQueueChanged': False, 'allSourcesAndOutputsSHA256Match': True,
          'audioAudiblyListened': False, 'audioMeasured': True, 'checks': checks, 'contactSheets': sheets}
(base / 'qa/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'stories': 14, 'videos': 28, 'sources': 32, 'sceneFrames': 64,
                  'audioLUFSRange': [min(c['audioLUFS'] for c in checks), max(c['audioLUFS'] for c in checks)],
                  'maxTruePeak': max(c['audioTruePeakDBTP'] for c in checks), 'verification': str(base / 'qa/verification.json')}))
