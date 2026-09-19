import React, {useEffect, useState} from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, CanvasImage, Sequence, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

export type ExamScene = {headline: string; body: string; seconds: number};
export type ExamPost = {id: string; slug: string; photoSlug: string; exam: 'ЕГЭ' | 'ОГЭ'; format: 'Reels' | 'carousel'; scenes: ExamScene[]};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
let fonts: Promise<unknown> | undefined;
const loadFonts = () => fonts ??= Promise.all([
  ['ExamDisplay', 'Oswald-variable.ttf'], ['ExamSans', 'manrope-600.woff2'],
].map(async ([family, file]) => {
  const face = new FontFace(family, `url("${staticFile(`fonts/${file}`)}")`, {weight: '600'});
  document.fonts.add(await face.load());
}));
const textCache = new Map<string, {text: string; size: number}>();
function fitted(text: string, family: string, preferred: number, maxLines: number, preserveBreaks: boolean) {
  const key = JSON.stringify([text, family, preferred, maxLines, preserveBreaks]);
  const known = textCache.get(key);
  if (known) return known;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Canvas is required to measure Cyrillic text');
  for (let size = preferred; size >= 36; size -= 2) {
    context.font = `600 ${size}px ${family}`;
    const lines: string[] = [];
    for (const paragraph of preserveBreaks ? text.split('\n') : [text]) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > 884) { lines.push(line); line = word; }
        else line = candidate;
      }
      if (line) lines.push(line);
    }
    if (lines.length <= maxLines && lines.every(line => context.measureText(line).width <= 884)) {
      const result = {text: lines.join('\n'), size}; textCache.set(key, result); return result;
    }
  }
  throw new Error(`Exam text needs editorial shortening or another scene: ${text}`);
}

const ExamFrame: React.FC<{post: ExamPost; index: number}> = ({post, index}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const scene = post.scenes[index];
  const reel = post.format === 'Reels';
  const last = index === post.scenes.length - 1;
  const title = fitted(scene.headline, 'ExamDisplay', reel ? 116 : 100, 3, false);
  const body = fitted(scene.body, 'ExamSans', reel ? 52 : 48, 5, true);
  const top = reel ? 310 : 110;
  const gap = reel ? 40 : 30;
  const titleHeight = title.text.split('\n').length * title.size * 1.12;
  const bodyTop = top + titleHeight + gap;
  const textEnd = bodyTop + body.text.split('\n').length * body.size * 1.34;
  const creditTop = reel ? 1450 : 1100;
  if (textEnd > (last ? creditTop - 35 : reel ? 1630 : 1220)) throw new Error(`${post.id}: text exceeds safe area on scene ${index + 1}`);
  const stop = (pixels: number) => `${pixels / height * 100}%`;
  const bodyContrast = post.slug === 'oge-dvoetochie' && index === 4 ? 0.72 : post.slug === 'oge-argument' && index === 3 ? 0.62 : undefined;
  const textGradient = bodyContrast === undefined
    ? `linear-gradient(180deg, rgba(255,252,245,0.12) 0%, rgba(255,252,245,0.32) ${stop(top)}, rgba(255,252,245,0.38) ${stop(textEnd)}, rgba(255,252,245,0) ${stop(textEnd + 90)})`
    : `linear-gradient(180deg, rgba(255,252,245,0.12) 0%, rgba(255,252,245,0.32) ${stop(top)}, rgba(255,252,245,0.32) ${stop(bodyTop - 24)}, rgba(255,252,245,${bodyContrast}) ${stop(bodyTop + 4)}, rgba(255,252,245,${bodyContrast}) ${stop(textEnd)}, rgba(255,252,245,0) ${stop(textEnd + 90)})`;
  return <AbsoluteFill style={{background: '#ede9df', overflow: 'hidden'}}>
    <CanvasImage src={staticFile(`photos/exam-v1/${post.photoSlug || post.slug}.png`)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', transformOrigin: '50% 64%', scale: interpolate(frame, [0, scene.seconds * fps - 1], index % 2 ? [1.10, 1.06] : [1, 1.04], clamp)}} />
    <AbsoluteFill style={{background: textGradient}} />
    <div style={{position: 'absolute', top, left: 90, right: 90, color: '#102330', textShadow: '0 1px 3px rgba(255,255,255,0.4)'}}>
      <div style={{fontFamily: 'ExamDisplay', fontSize: title.size, fontWeight: 600, lineHeight: 1.12, whiteSpace: 'pre', opacity: interpolate(frame, [0, 8], [0.6, 1], clamp), translate: `0 ${interpolate(frame, [0, 12], [8, 0], clamp)}px`}}>{title.text}</div>
      <div style={{fontFamily: 'ExamSans', fontSize: body.size, fontWeight: 600, lineHeight: 1.34, marginTop: gap, whiteSpace: 'pre', opacity: interpolate(frame, [0, 12], [0.35, 1], clamp)}}>{body.text}</div>
    </div>
    {last && <>
      <AbsoluteFill style={{background: `linear-gradient(180deg, rgba(255,252,245,0) ${stop(creditTop - 70)}, rgba(255,252,245,0.84) ${stop(creditTop - 5)}, rgba(255,252,245,0.84) ${stop(creditTop + 92)}, rgba(255,252,245,0) ${stop(creditTop + 140)})`}} />
      <div style={{position: 'absolute', left: 90, right: 90, top: creditTop, color: '#102330', fontFamily: 'ExamSans', fontSize: 34, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'pre'}}>{'И. С. Бах · Гольдберг-вариации, № 1\nФортепиано — Кимико Ишизака'}</div>
    </>}
  </AbsoluteFill>;
};

export const examDurationInFrames = (post: ExamPost, fps = 30) => post.scenes.reduce((sum, scene) => sum + Math.round(scene.seconds * fps), 0);
export const ExamVideo: React.FC<{post: ExamPost; slideIndex?: number}> = ({post, slideIndex}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const [handle] = useState(() => delayRender('Load exam fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => { loadFonts().then(() => {setReady(true); continueRender(handle);}).catch(cancelRender); }, [handle]);
  if (!ready) return null;
  const indices = slideIndex === undefined ? post.scenes.map((_, i) => i) : [slideIndex];
  let offset = 0;
  const audioOffset = slideIndex === undefined ? 0 : post.scenes.slice(0, slideIndex).reduce((sum, scene) => sum + Math.round(scene.seconds * fps), 0);
  return <AbsoluteFill>
    {indices.map(index => {
      const from = offset, duration = Math.round(post.scenes[index].seconds * fps); offset += duration;
      return <Sequence key={index} from={from} durationInFrames={duration} name={post.scenes[index].headline}><ExamFrame post={post} index={index} /></Sequence>;
    })}
    <Audio src={staticFile('classical.mp3')} trimBefore={audioOffset} volume={frame => interpolate(frame, [0, fps * 0.1, durationInFrames - fps * 0.5, durationInFrames - 1], [0, 0.75, 0.75, 0], clamp)} />
  </AbsoluteFill>;
};
