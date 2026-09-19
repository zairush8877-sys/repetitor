#!/usr/bin/env python3
"""Decode every teaching scene from the delivered videos and record media evidence."""
import hashlib, json, os, pathlib, subprocess
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs/exam-bank-2026-09-26'
BIN = ROOT / 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64'
ENV = dict(os.environ, DYLD_LIBRARY_PATH=str(BIN))
posts = json.loads((ROOT / 'video-lab/exam-bank.json').read_text())
posts = posts if isinstance(posts, list) else posts['posts']
qa = OUT / 'qa/decoded'; qa.mkdir(parents=True, exist_ok=True)
reports = []
for post in posts:
    frames = []; media = []
    reel = post['format'] == 'Reels'
    for i, scene in enumerate(post['scenes']):
        file = OUT / 'content' / (f"reels/{post['id']}.mp4" if reel else f"images/{post['id']}-{i+1}.mp4")
        dest = qa / f"{post['id']}-{i+1}.jpg"
        at = i * 6 + 4.5 if reel else 4.5
        subprocess.run([str(BIN/'ffmpeg'), '-v', 'error', '-y', '-ss', str(at), '-i', str(file), '-frames:v', '1', '-q:v', '2', str(dest)], env=ENV, check=True)
        frames.append(dest)
        if not reel or i == 0:
            probe = json.loads(subprocess.check_output([str(BIN/'ffprobe'), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)], env=ENV))
            v = next(x for x in probe['streams'] if x['codec_type'] == 'video')
            a = next(x for x in probe['streams'] if x['codec_type'] == 'audio')
            assert (v['width'],v['height']) == ((1080,1920) if reel else (1080,1350))
            assert abs(float(probe['format']['duration']) - (30 if reel else 6)) < .1
            audio = subprocess.run([str(BIN/'ffmpeg'), '-hide_banner', '-i', str(file), '-vn', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], env=ENV, capture_output=True, text=True, check=True)
            start=audio.stderr.rfind('{'); level=json.JSONDecoder().raw_decode(audio.stderr[start:])[0]
            assert float(level['input_tp']) < -1
            assert -25 < float(level['input_i']) < -14
            media.append({'file':str(file.relative_to(ROOT)), 'sha256':hashlib.sha256(file.read_bytes()).hexdigest(), 'duration':float(probe['format']['duration']), 'video':v['codec_name'], 'audio':a['codec_name'], 'loudness':level})
    thumbw=360; thumbh=640 if reel else 450
    sheet=Image.new('RGB',(thumbw*len(frames),thumbh+34),'white')
    draw=ImageDraw.Draw(sheet)
    for i,f in enumerate(frames):
        pic=Image.open(f);pic.thumbnail((thumbw,thumbh));sheet.paste(pic,(i*thumbw,34));draw.text((i*thumbw+8,8),f"scene {i+1}",fill='black')
    sheet.save(qa/f"{post['id']}-contact.jpg",quality=94)
    reports.append({'id':post['id'], 'scenes':len(frames), 'media':media})
(OUT/'verification-media.json').write_text(json.dumps({'sceneCount':sum(x['scenes'] for x in reports),'fileCount':sum(len(x['media']) for x in reports),'posts':reports,'instagramPublicationPerformed':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'verifiedVideos':sum(len(x['media']) for x in reports),'decodedScenes':sum(x['scenes'] for x in reports)}))
