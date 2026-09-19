#!/usr/bin/env python3
"""Offline Pillow/FFmpeg renderer for the editable Exam.tsx scene contract.

This exports video without opening a browser, binding a port or accessing the
network. Generated source photos stay unchanged. It is not a Remotion export.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import threading
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / 'assets/fonts'
FALLBACK_FONT = Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
if not FALLBACK_FONT.exists():
    FALLBACK_FONT = FONT_DIR / 'IBMPlexSerif-Bold.ttf'
COMPOSITOR = ROOT / 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64'
MUSIC = ROOT / 'content/music/bach-goldberg-var1-ishizaka.mp3'
FPS = 30
WIDTH = 1080
INK = (16, 35, 48, 255)
PAPER = (255, 252, 245)
CREDIT = ['И. С. Бах · Гольдберг-вариации, № 1', 'Фортепиано — Кимико Ишизака']
LOCAL = threading.local()


def digest(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def font(family: str, size: int) -> ImageFont.FreeTypeFont:
    if not hasattr(LOCAL, 'fonts'):
        LOCAL.fonts = {}
    key = (family, size)
    if key not in LOCAL.fonts:
        filename = FONT_DIR / ('Oswald-variable.ttf' if family == 'display' else 'manrope-600.woff2')
        result = ImageFont.truetype(str(FALLBACK_FONT if family == 'fallback' else filename), size)
        if family != 'fallback':
            axes = result.get_variation_axes()
            result.set_variation_by_axes([600 if a['name'] == b'Weight' else a['default'] for a in axes])
        LOCAL.fonts[key] = result
    return LOCAL.fonts[key]


def covered(character: str, family: str, size: int) -> bool:
    if not hasattr(LOCAL, 'coverage'):
        LOCAL.coverage = {}
    key = (character, family, size)
    if key not in LOCAL.coverage:
        face = font(family, size)
        missing = face.getmask('\uffff')
        glyph = face.getmask(character)
        LOCAL.coverage[key] = glyph.size != missing.size or bytes(glyph) != bytes(missing)
    return LOCAL.coverage[key]


def text_runs(text: str, family: str, size: int) -> list[tuple[str, str]]:
    # Browser CSS provides glyph fallback automatically. The local Manrope WOFF2
    # is a Cyrillic subset, so punctuation, digits and Latin need it explicitly.
    runs = []
    for character in text:
        selected = family if covered(character, family, size) else 'fallback'
        if not covered(character, selected, size):
            raise ValueError(f'No font covers U+{ord(character):04X} {character!r}')
        if runs and runs[-1][0] == selected:
            runs[-1] = (selected, runs[-1][1] + character)
        else:
            runs.append((selected, character))
    return runs


def text_width(text: str, family: str, size: int) -> float:
    return sum(font(selected, size).getlength(run) for selected, run in text_runs(text, family, size))


def fit(text: str, family: str, preferred: int, max_lines: int, preserve_breaks: bool) -> dict:
    for size in range(preferred, 35, -2):
        lines = []
        for paragraph in text.split('\n') if preserve_breaks else [text]:
            line = ''
            for word in paragraph.split():
                candidate = f'{line} {word}' if line else word
                if line and text_width(candidate, family, size) > 884:
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            if line:
                lines.append(line)
        if len(lines) <= max_lines and all(text_width(s, family, size) <= 884 for s in lines):
            return {'lines': lines, 'size': size, 'family': family}
    raise ValueError(f'Text needs shortening: {text}')


def scene_layout(post: dict, index: int) -> dict:
    reel = post['format'] == 'Reels'
    scene = post['scenes'][index]
    title = fit(scene['headline'], 'display', 116 if reel else 100, 3, False)
    body = fit(scene['body'], 'sans', 52 if reel else 48, 5, True)
    top, gap = (310, 40) if reel else (110, 30)
    body_top = top + len(title['lines']) * title['size'] * 1.12 + gap
    text_end = body_top + len(body['lines']) * body['size'] * 1.34
    last = index == len(post['scenes']) - 1
    credit_top = 1450 if reel else 1100
    limit = credit_top - 35 if last else (1630 if reel else 1220)
    if text_end > limit:
        raise ValueError(f"{post['id']} scene {index + 1}: text ends at {text_end:.1f}, limit {limit}")
    if any(text_width(line, 'sans', 34) > 884 for line in CREDIT):
        raise ValueError('Music credit exceeds the safe width')
    body_contrast = .72 if post['slug'] == 'oge-dvoetochie' and index == 4 else \
                    .62 if post['slug'] == 'oge-argument' and index == 3 else None
    return {'index': index, 'height': 1920 if reel else 1350, 'top': top,
            'bodyTop': body_top, 'textEnd': text_end, 'safeEnd': limit,
            'creditTop': credit_top, 'last': last, 'title': title, 'body': body,
            'bodyContrast': body_contrast}


def white_gradient(height: int, stops: list[tuple[float, float]]) -> Image.Image:
    # CSS percentage stops are converted directly to y coordinates in this raster.
    # No scaled-browser gradient interpretation is involved.
    y = np.arange(height, dtype=np.float32)
    alpha = np.rint(np.interp(y, [s[0] for s in stops], [s[1] for s in stops]) * 255).astype(np.uint8)
    mask = Image.fromarray(np.repeat(alpha[:, None], WIDTH, axis=1))
    layer = Image.new('RGBA', (WIDTH, height), PAPER + (0,))
    layer.putalpha(mask)
    return layer


def text_layer(height: int, block: dict, y: float, leading: float, opacity: float = 1.0) -> Image.Image:
    layer = Image.new('RGBA', (WIDTH, height))
    face = font(block['family'], block['size'])
    draw = ImageDraw.Draw(layer)
    ascent, descent = face.getmetrics()
    line_height = block['size'] * leading
    baseline = y + (line_height - ascent - descent) / 2 + ascent
    for line in block['lines']:
        x = 90.0
        for selected, run in text_runs(line, block['family'], block['size']):
            current = font(selected, block['size'])
            draw.text((x, round(baseline)), run, font=current, anchor='ls', fill=INK)
            x += current.getlength(run)
        baseline += line_height
    if opacity < 1:
        layer.putalpha(layer.getchannel('A').point(lambda a: round(a * opacity)))
    return layer


def overlay(layout: dict, local_frame: int) -> Image.Image:
    h, top, end = layout['height'], layout['top'], layout['textEnd']
    strong = layout.get('bodyContrast')
    stops = [(0, .12), (top, .32), (end, .38), (end + 90, 0), (h, 0)]
    if strong:
        body_top = layout['bodyTop']
        stops = [(0, .12), (top, .32), (body_top - 24, .32), (body_top + 4, strong),
                 (end, strong), (end + 90, 0), (h, 0)]
    layer = white_gradient(h, stops)
    progress = min(local_frame / 12, 1)
    title_opacity = .6 + .4 * min(local_frame / 8, 1)
    layer = Image.alpha_composite(layer, text_layer(h, layout['title'], top + 8 * (1 - progress), 1.12, title_opacity))
    layer = Image.alpha_composite(layer, text_layer(h, layout['body'], layout['bodyTop'], 1.34, .35 + .65 * progress))
    if layout['last']:
        c = layout['creditTop']
        layer = Image.alpha_composite(layer, white_gradient(h, [(0, 0), (c - 70, 0), (c - 5, .84), (c + 92, .84), (c + 140, 0), (h, 0)]))
        layer = Image.alpha_composite(layer, text_layer(h, {'lines': CREDIT, 'size': 34, 'family': 'sans'}, c, 1.4))
    return layer


def base_photo(post: dict, height: int) -> Image.Image:
    source = ROOT / 'assets/photos/exam-v1' / f"{post.get('photoSlug', post['slug'])}.png"
    with Image.open(source) as original:
        im = original.convert('RGB')
    # object-fit: cover with uniform scaling and a centered crop.
    scale = max(WIDTH / im.width, height / im.height)
    crop_width, crop_height = WIDTH / scale, height / scale
    x, y = (im.width - crop_width) / 2, (im.height - crop_height) / 2
    return im.resize((WIDTH, height), Image.Resampling.LANCZOS, box=(x, y, x + crop_width, y + crop_height)).convert('RGBA')


def frame_image(base: Image.Image, scene_index: int, local_frame: int, total_frames: int, text: Image.Image) -> Image.Image:
    p = local_frame / max(1, total_frames - 1)
    scale = 1.10 - .04 * p if scene_index % 2 else 1 + .04 * p
    ox, oy = WIDTH * .5, base.height * .64
    # Inverse affine map of CSS scale around 50% 64%; no x/y stretching.
    photo = base.transform(base.size, Image.Transform.AFFINE,
                           (1 / scale, 0, ox * (1 - 1 / scale), 0, 1 / scale, oy * (1 - 1 / scale)),
                           Image.Resampling.BICUBIC)
    return Image.alpha_composite(photo, text).convert('RGB')


def make_jobs(posts: list[dict]) -> list[tuple[dict, int | None]]:
    jobs = []
    for post in posts:
        if post['format'] == 'Reels':
            jobs.append((post, None))
        else:
            jobs.extend((post, i) for i in range(4))
    return jobs


def render_job(job: tuple[dict, int | None], output: Path, ffmpeg: Path, ffprobe: Path, config_hash: str, overwrite: bool) -> dict:
    post, slide = job
    reel = slide is None
    height = 1920 if reel else 1350
    indices = list(range(len(post['scenes']))) if reel else [slide]
    relative = Path('reels') / f"{post['id']}.mp4" if reel else Path('images') / f"{post['id']}-{slide + 1}.mp4"
    dest = output / relative
    if dest.exists() and not overwrite:
        raise FileExistsError(f'{dest}: already exists; inspect before using --overwrite')
    dest.parent.mkdir(parents=True, exist_ok=True)
    qa = output.parent / 'qa/offline'
    qa.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp.mp4')
    log = qa / f'{dest.stem}.ffmpeg.log'
    duration = sum(post['scenes'][i]['seconds'] for i in indices)
    audio_start = 0 if reel else sum(s['seconds'] for s in post['scenes'][:slide])
    env = dict(os.environ)
    env['DYLD_LIBRARY_PATH'] = str(ffmpeg.parent) + (':' + env['DYLD_LIBRARY_PATH'] if env.get('DYLD_LIBRARY_PATH') else '')
    # Bundled FFmpeg has volume automation but no afade filter.
    volume = f"volume=0.75*min(1\\,t/0.1)*max(0\\,min(1\\,({duration}-t)/0.5)):eval=frame"
    # This FFmpeg build omits the rawvideo demuxer; uncompressed PNG packets
    # carry the same lossless RGB pixels through its supported image2pipe input.
    cmd = [str(ffmpeg), '-v', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png',
           '-framerate', str(FPS), '-i', 'pipe:0',
           '-ss', str(audio_start), '-i', str(MUSIC), '-map', '0:v:0', '-map', '1:a:0',
           '-t', str(duration), '-af', volume, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
           '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
           '-movflags', '+faststart', str(tmp)]
    started = time.monotonic()
    print(json.dumps({'event': 'start', 'file': str(relative), 'duration': duration}, ensure_ascii=False), flush=True)
    photo = ROOT / 'assets/photos/exam-v1' / f"{post.get('photoSlug', post['slug'])}.png"
    photo_hash, music_hash = digest(photo), digest(MUSIC)
    base = base_photo(post, height)
    layouts = []
    with log.open('wb') as stderr:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=stderr, env=env)
        try:
            for index in indices:
                layout = scene_layout(post, index)
                layouts.append(layout)
                settled = overlay(layout, 12)
                count = round(post['scenes'][index]['seconds'] * FPS)
                for n in range(count):
                    composed = frame_image(base, index, n, count, settled if n >= 12 else overlay(layout, n))
                    if n == count - 30:
                        composed.save(qa / f"{post['id']}-scene-{index + 1}.jpg", quality=94, subsampling=0)
                    packet = io.BytesIO()
                    composed.save(packet, format='PNG', compress_level=0)
                    proc.stdin.write(packet.getbuffer())
                print(json.dumps({'event': 'scene', 'file': str(relative), 'scene': index + 1}, ensure_ascii=False), flush=True)
            proc.stdin.close()
            result = proc.wait()
            if result:
                raise RuntimeError(f'FFmpeg exited {result}: {log.read_text()[-2000:]}')
        except BaseException as error:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
            if proc.poll() is None:
                proc.terminate()
            proc.wait()
            tmp.unlink(missing_ok=True)
            if isinstance(error, BrokenPipeError):
                raise RuntimeError(f'FFmpeg closed frame pipe: {log.read_text()[-2000:]}') from error
            raise
    probe = json.loads(subprocess.check_output([str(ffprobe), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(tmp)], env=env))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    if video['width'] != WIDTH or video['height'] != height or abs(float(probe['format']['duration']) - duration) > .15:
        raise ValueError(f'{relative}: exported geometry/duration mismatch')
    if digest(photo) != photo_hash or digest(MUSIC) != music_hash:
        raise ValueError(f'{relative}: a source changed while rendering; inspect the temporary output')
    tmp.replace(dest)
    receipt = {'renderer': 'offline Pillow + FFmpeg; not Remotion export', 'pillowVersion': pillow_version,
               'file': str(relative), 'sha256': digest(dest), 'bytes': dest.stat().st_size,
               'width': WIDTH, 'height': height, 'fps': FPS, 'duration': duration,
               'audioCodec': audio['codec_name'], 'audioSource': str(MUSIC.relative_to(ROOT)),
               'audioSha256': music_hash, 'audioStartSeconds': audio_start, 'volume': .75,
               'audioFadeInSeconds': .1, 'audioFadeOutSeconds': .5,
               'photoSource': str(photo.relative_to(ROOT)), 'photoSha256': photo_hash,
               'fontWeight': 600, 'fallbackFont': str(FALLBACK_FONT), 'fallbackFontSha256': digest(FALLBACK_FONT),
               'configSha256': config_hash, 'layouts': layouts,
               'elapsedSeconds': round(time.monotonic() - started, 2)}
    (qa / f'{dest.stem}.render.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'event': 'done', 'file': str(relative), 'seconds': receipt['elapsedSeconds']}, ensure_ascii=False), flush=True)
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'video-lab/exam-bank.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/exam-bank-2026-09-26/content')
    parser.add_argument('--ffmpeg', type=Path, default=COMPOSITOR / 'ffmpeg')
    parser.add_argument('--ffprobe', type=Path, default=COMPOSITOR / 'ffprobe')
    parser.add_argument('--ids', nargs='+', help='Select exact IDs or slugs')
    parser.add_argument('--limit', type=int, help='Limit number of exported MP4 files')
    parser.add_argument('--samples', action='store_true', help='First full Reels plus final slide of first carousel')
    parser.add_argument('--workers', type=int, choices=[1, 2], default=2)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to((ROOT / 'outputs').resolve()) or output.name != 'content':
        raise ValueError('Use an isolated outputs/.../content directory')
    config = json.loads(args.config.read_text())
    posts = config if isinstance(config, list) else config['posts']
    if args.ids:
        posts = [p for p in posts if p['id'] in args.ids or p['slug'] in args.ids]
        if not posts:
            raise ValueError('No matching IDs')
    for p in posts:
        if p['status'] != 'pending' or p.get('date'):
            raise ValueError(f"{p['id']}: expected undated pending review draft")
        if len(p['scenes']) != (5 if p['format'] == 'Reels' else 4) or any(s['seconds'] != 6 for s in p['scenes']):
            raise ValueError(f"{p['id']}: expected five/four six-second scenes")
        for i in range(len(p['scenes'])):
            scene_layout(p, i)
    jobs = make_jobs(posts)
    if args.samples:
        jobs = [next(j for j in jobs if j[1] is None), next(j for j in jobs if j[1] == 3)]
    if args.limit is not None:
        if args.limit < 1:
            raise ValueError('--limit must be positive')
        jobs = jobs[:args.limit]
    music_index = json.loads((ROOT / 'content/music/index.json').read_text())
    track = next(t for t in music_index['tracks'] if t['file'] == MUSIC.name and t.get('active') is not False)
    if digest(MUSIC) != track['sha256']:
        raise ValueError('Music source SHA256 differs from the verified index')
    output.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(render_job, job, output, args.ffmpeg, args.ffprobe, digest(args.config), args.overwrite) for job in jobs]
        receipts = [f.result() for f in futures]
    print(json.dumps({'completed': len(receipts), 'output': str(output), 'publicationPerformed': False}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
