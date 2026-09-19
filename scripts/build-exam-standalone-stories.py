#!/usr/bin/env python3
"""Build isolated question/answer Stories from the 32 verified exam MP4s.

No server, network, publication, live queue changes or source-photo edits.
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
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'outputs/exam-bank-2026-09-26'
COMPOSITOR = ROOT / 'video-lab/remotion/node_modules/@remotion/compositor-darwin-arm64'
MUSIC = ROOT / 'content/music/bach-goldberg-var1-ishizaka.mp3'
FPS = 30


def sha(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def run(args: list[str], env: dict) -> str:
    result = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace')[-3000:])
    return result.stdout.decode()


def probe(file: Path, ffprobe: Path, env: dict, width: int, height: int, duration: int) -> dict:
    data = json.loads(run([str(ffprobe), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)], env))
    visual = next(s for s in data['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in data['streams'] if s['codec_type'] == 'audio')
    actual_duration = float(data['format']['duration'])
    if (visual['width'], visual['height']) != (width, height) or abs(actual_duration - duration) > .15:
        raise ValueError(f'{file}: wrong dimensions or duration')
    if visual.get('avg_frame_rate') != '30/1' or int(visual.get('nb_frames', 0)) != duration * FPS:
        raise ValueError(f'{file}: wrong frame rate/count')
    return {'width': width, 'height': height, 'fps': FPS, 'frames': duration * FPS,
            'duration': actual_duration, 'videoCodec': visual['codec_name'], 'audioCodec': audio['codec_name']}


def source_files(post: dict, content: Path) -> list[Path]:
    if post['format'] == 'Reels':
        return [content / 'reels' / f"{post['id']}.mp4"]
    return [content / 'images' / f"{post['id']}-{n}.mp4" for n in range(1, 5)]


def preflight(posts: list[dict], content: Path, config_sha: str, ffprobe: Path, env: dict, wait_seconds: int) -> dict:
    expected = [(p, f) for p in posts for f in source_files(p, content)]
    if len(posts) != 14 or len(expected) != 32:
        raise ValueError('Expected the complete fourteen-post / thirty-two-MP4 bank')
    if any(p['status'] != 'pending' or p.get('date') for p in posts):
        raise ValueError('Only undated pending drafts can enter this isolated Story bank')
    deadline = time.monotonic() + wait_seconds
    while True:
        missing = [str(f.relative_to(content)) for _, f in expected
                   if not f.exists() or not (content.parent / 'qa/offline' / f'{f.stem}.render.json').exists()]
        if not missing:
            break
        if time.monotonic() >= deadline:
            raise FileNotFoundError(f'All 32 completed MP4s and receipts are required; missing {len(missing)}: {missing}')
        print(json.dumps({'event': 'waiting_for_complete_source_bank', 'missing': len(missing)}, ensure_ascii=False), flush=True)
        time.sleep(min(10, max(0, deadline - time.monotonic())))
    track = next(t for t in json.loads((ROOT / 'content/music/index.json').read_text())['tracks']
                 if t['file'] == MUSIC.name and t.get('active') is not False)
    music_sha = sha(MUSIC)
    if music_sha != track['sha256']:
        raise ValueError('Verified music source changed')
    verified = {}
    for p, file in expected:
        receipt_file = content.parent / 'qa/offline' / f'{file.stem}.render.json'
        receipt = json.loads(receipt_file.read_text())
        fingerprint = sha(file)
        if receipt['sha256'] != fingerprint or receipt['configSha256'] != config_sha or receipt['audioSha256'] != music_sha:
            raise ValueError(f'{file}: receipt/source/config mismatch')
        slide = 0 if p['format'] == 'Reels' else source_files(p, content).index(file)
        if receipt['audioStartSeconds'] != slide * 6:
            raise ValueError(f'{file}: unexpected musical section')
        reel = p['format'] == 'Reels'
        meta = probe(file, ffprobe, env, 1080, 1920 if reel else 1350, 30 if reel else 6)
        verified[str(file)] = {'file': str(file.relative_to(ROOT)), 'sha256': fingerprint, **meta}
    print(json.dumps({'event': 'source_bank_verified', 'posts': 14, 'mp4': 32}, ensure_ascii=False), flush=True)
    return verified


def encoder_options(duration: int) -> list[str]:
    return ['-t', str(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-threads', '2',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart']


def edge_fade(duration: int, gain: float = 1) -> str:
    return f'volume={gain}*min(1\\,t/0.04)*max(0\\,min(1\\,({duration}-t)/0.12)):eval=frame'


def read_frame(pipe, count: int) -> bytes:
    result = bytearray()
    while len(result) < count:
        part = pipe.read(count - len(result))
        if not part:
            break
        result.extend(part)
    if result and len(result) != count:
        raise ValueError('Incomplete decoded RGB frame')
    return bytes(result)


def carousel_video(files: list[Path], destination: Path, duration: int, audio_start: int, background: str,
                   ffmpeg: Path, env: dict, log: Path) -> None:
    # pad is absent in bundled FFmpeg. Preserve each complete 4:5 video frame
    # at native width, centered vertically on a plain 9:16 canvas.
    command = [str(ffmpeg), '-v', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', '30', '-i', 'pipe:0',
               '-ss', str(audio_start), '-i', str(MUSIC), '-map', '0:v:0', '-map', '1:a:0',
               '-af', edge_fade(duration, .75), *encoder_options(duration), str(destination)]
    with log.open('wb') as errors:
        encoder = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=errors, env=env)
        decoder = None
        try:
            for source in files:
                decoder = subprocess.Popen([str(ffmpeg), '-v', 'error', '-i', str(source), '-an', '-threads', '2',
                                            '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-f', 'image2pipe', 'pipe:1'],
                                           stdout=subprocess.PIPE, stderr=errors, env=env)
                count = 0
                while True:
                    pixels = read_frame(decoder.stdout, 1080 * 1350 * 3)
                    if not pixels:
                        break
                    frame = Image.frombytes('RGB', (1080, 1350), pixels)
                    canvas = Image.new('RGB', (1080, 1920), background)
                    canvas.paste(frame, (0, 285))
                    packet = io.BytesIO()
                    canvas.save(packet, format='PNG', compress_level=0)
                    encoder.stdin.write(packet.getbuffer())
                    count += 1
                decoder.stdout.close()
                if decoder.wait() or count != 180:
                    raise RuntimeError(f'{source}: decoder returned {count} frames; {log.read_text()[-1500:]}')
                decoder = None
            encoder.stdin.close()
            if encoder.wait():
                raise RuntimeError(f'Encoder failed: {log.read_text()[-2000:]}')
        except BaseException as error:
            if decoder and decoder.poll() is None:
                decoder.terminate()
                decoder.wait()
            if encoder.stdin and not encoder.stdin.closed:
                encoder.stdin.close()
            if encoder.poll() is None:
                encoder.terminate()
            encoder.wait()
            if isinstance(error, BrokenPipeError):
                raise RuntimeError(f'Encoder closed pipe: {log.read_text()[-2000:]}') from error
            raise


def build_post(post: dict, content: Path, output: Path, verified: dict, ffmpeg: Path, ffprobe: Path,
               env: dict, config_sha: str, overwrite: bool) -> dict:
    started = time.monotonic()
    sources = source_files(post, content)
    reel = post['format'] == 'Reels'
    qa = output / 'qa'
    qa.mkdir(parents=True, exist_ok=True)
    parts = []
    print(json.dumps({'event': 'start', 'post': post['id']}, ensure_ascii=False), flush=True)
    for n, duration in [(1, 6), (2, 24 if reel else 18)]:
        dest = output / f"{post['id']}-{n}.mp4"
        if dest.exists() and not overwrite:
            raise FileExistsError(f'{dest}: already exists, inspect before --overwrite')
        temp = dest.with_suffix('.tmp.mp4')
        audio_start = 0 if n == 1 else 6
        selected = sources if reel else sources[:1] if n == 1 else sources[1:]
        if reel:
            command = [str(ffmpeg), '-v', 'error', '-y', '-ss', str(audio_start), '-i', str(sources[0]),
                       '-map', '0:v:0', '-map', '0:a:0', '-af', edge_fade(duration), *encoder_options(duration), str(temp)]
            run(command, env)
            geometry = {'x': 0, 'y': 0, 'width': 1080, 'height': 1920, 'cropped': False}
        else:
            background = '#dbe9ec' if post['exam'] == 'ЕГЭ' else '#f4e7c7'
            carousel_video(selected, temp, duration, audio_start, background, ffmpeg, env, qa / f'{dest.stem}.ffmpeg.log')
            geometry = {'x': 0, 'y': 285, 'width': 1080, 'height': 1350, 'background': background, 'cropped': False}
        meta = probe(temp, ffprobe, env, 1080, 1920, duration)
        if any(sha(s) != verified[str(s)]['sha256'] for s in selected):
            raise ValueError(f"{post['id']}: source changed while building")
        temp.replace(dest)
        scene_indices = [1] if n == 1 else list(range(2, len(post['scenes']) + 1))
        decoded = []
        for index, scene in enumerate(scene_indices):
            preview = qa / f"{post['id']}-scene-{scene}.jpg"
            run([str(ffmpeg), '-v', 'error', '-y', '-ss', str(index * 6 + 5), '-i', str(dest),
                 '-frames:v', '1', '-q:v', '2', str(preview)], env)
            decoded.append(str(preview.relative_to(output)))
        parts.append({'index': n, 'role': 'question' if n == 1 else 'answer', 'file': dest.name,
                      'sha256': sha(dest), 'bytes': dest.stat().st_size, **meta, 'sceneIndices': scene_indices,
                      'geometry': geometry, 'decodedFrames': decoded,
                      'sourceFiles': [verified[str(s)] for s in selected],
                      'audioStartSeconds': audio_start, 'edgeFadeSeconds': {'in': .04, 'out': .12},
                      'musicMode': 'preserved Reels audio' if reel else 'continuous verified source music, gain 0.75'})
    result = {'id': post['id'] + '-standalone', 'sourcePostId': post['id'], 'exam': post['exam'], 'title': post['title'],
              'status': 'pending', 'proposedDate': post.get('proposedDate'), 'kind': 'question_answer',
              'configSha256': config_sha, 'musicSource': str(MUSIC.relative_to(ROOT)), 'musicSha256': sha(MUSIC),
              'creditInFinalAnswerScene': True, 'parts': parts, 'elapsedSeconds': round(time.monotonic() - started, 2)}
    (qa / f"{post['id']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'event': 'done', 'post': post['id'], 'seconds': result['elapsedSeconds']}, ensure_ascii=False), flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'video-lab/exam-bank.json')
    parser.add_argument('--content', type=Path, default=BANK / 'content')
    parser.add_argument('--output', type=Path, default=BANK / 'standalone-stories')
    parser.add_argument('--wait-seconds', type=int, default=0)
    parser.add_argument('--workers', choices=[1, 2], type=int, default=2)
    parser.add_argument('--ids', nargs='+')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    for location in [args.content.resolve(), args.output.resolve()]:
        if not location.is_relative_to((ROOT / 'outputs').resolve()):
            raise ValueError('All input/output media must remain under isolated outputs/')
    env = dict(os.environ, DYLD_LIBRARY_PATH=str(COMPOSITOR))
    ffmpeg, ffprobe = COMPOSITOR / 'ffmpeg', COMPOSITOR / 'ffprobe'
    config = json.loads(args.config.read_text())
    posts = config if isinstance(config, list) else config['posts']
    config_sha = sha(args.config)
    verified = preflight(posts, args.content, config_sha, ffprobe, env, args.wait_seconds)
    chosen = [p for p in posts if not args.ids or p['id'] in args.ids or p['slug'] in args.ids]
    if not chosen:
        raise ValueError('No matching Stories')
    args.output.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(build_post, p, args.content, args.output, verified, ffmpeg, ffprobe,
                               env, config_sha, args.overwrite) for p in chosen]
        completed = [f.result() for f in futures]
    if sha(args.config) != config_sha:
        raise ValueError('Editorial config changed during the build; inspect outputs before creating index')
    index_file = args.output / 'index.json'
    previous = json.loads(index_file.read_text())['stories'] if index_file.exists() else []
    replaced = {p['id'] for p in completed}
    stories = [p for p in previous if p['id'] not in replaced] + completed
    order = {p['id'] + '-standalone': n for n, p in enumerate(posts)}
    stories.sort(key=lambda p: order[p['id']])
    index = {'version': 1, 'purpose': 'Isolated ready question/answer Stories; publication not authorized',
             'status': 'pending', 'publicationPerformed': False, 'liveQueueChanged': False,
             'sourceMp4Count': len(verified), 'stories': stories}
    temp = index_file.with_suffix('.tmp.json')
    temp.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    temp.replace(index_file)
    print(json.dumps({'completedStories': len(completed), 'videos': len(completed) * 2,
                      'manifest': str(index_file), 'publicationPerformed': False}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
