import React, {useEffect, useState} from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill, CanvasImage, Sequence, cancelRender, continueRender,
  delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig,
} from 'remotion';

export type BankScene = {
  headline: string;
  body: string;
  seconds: number;
  tone: 'cream' | 'mint' | 'yellow' | 'blue';
};
export type BankPost = {
  id: string;
  title: string;
  caption: string;
  school: boolean;
  scenes: BankScene[];
};

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
let loadedFonts: Promise<unknown> | undefined;

function fontsReady() {
  if (!loadedFonts) {
    loadedFonts = Promise.all([
      ['BankDisplay', 'Oswald-variable.ttf', '600'],
      ['BankSans', 'manrope-600.woff2', '600'],
      ['BankSans', 'manrope-400.woff2', '400'],
    ].map(async ([family, file, weight]) => {
      const font = new FontFace(family, `url("${staticFile(`fonts/${file}`)}")`, {weight});
      document.fonts.add(await font.load());
    }));
  }
  return loadedFonts;
}

// Measure with the loaded local fonts: preserve every word while adapting only
// line breaks. No ellipsis, clipping, abbreviated recap or browser-dependent fit.
const layoutCache = new Map<string, {text: string; size: number}>();
function fitText(text: string, family: string, preferred: number, maxLines: number, preserveBreaks = false) {
  const key = `${text}|${family}|${preferred}|${maxLines}|${preserveBreaks}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Canvas text measurement is unavailable');
  const paragraphs = preserveBreaks ? text.trim().split('\n') : [text.trim()];
  for (let size = preferred; size >= 36; size -= 2) {
    context.font = `600 ${size}px ${family}`;
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (current && context.measureText(next).width > 884) { lines.push(current); current = word; }
        else current = next;
      }
      if (current) lines.push(current);
    }
    if (lines.length <= maxLines && lines.every(line => context.measureText(line).width <= 884)) {
      const result = {text: lines.join('\n'), size};
      layoutCache.set(key, result);
      return result;
    }
  }
  throw new Error(`Text exceeds the photo layout: ${text}`);
}

const Scene: React.FC<{scene: BankScene; index: number; total: number; photo: string}> = ({scene, index, total, photo}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const last = index === total - 1;
  const heading = fitText(scene.headline, 'BankDisplay', index === 0 ? 128 : last ? 110 : 120, 3);
  const body = fitText(scene.body, 'BankSans', last ? 56 : 52, 4, last);
  const headingHeight = heading.text.split('\n').length * heading.size * 1.12;
  const bodyHeight = body.text.split('\n').length * body.size * 1.38;
  const textEnd = 320 + headingHeight + 42 + bodyHeight;
  const gradientStop = (pixels: number) => `${pixels / 1920 * 100}%`;
  // All source photos are vertical 9:16. Cover preserves their proportions;
  // the small uniform zoom crops the perimeter only and changes between shots.
  const close = index % 2 === 1;
  return <AbsoluteFill style={{backgroundColor: '#ebe7df', overflow: 'hidden'}}>
    <CanvasImage src={staticFile(`photos/photo-v3/${photo}.png`)} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%', transformOrigin: '50% 64%', scale: interpolate(frame, [0, scene.seconds * fps - 1], close ? [1.14, 1.10] : [1, 1.04], clamp)}} />
    <AbsoluteFill style={{background: photo === 'dosmotryu' || (photo === 'amfiboliya' && index === 0)
      ? `linear-gradient(180deg, rgba(255,251,243,0.12) 0%, rgba(255,251,243,0.3) ${gradientStop(290)}, rgba(255,251,243,0.3) ${gradientStop(Math.round(320 + headingHeight - 12))}, rgba(255,251,243,0.68) ${gradientStop(Math.round(320 + headingHeight + 34))}, rgba(255,251,243,0.68) ${gradientStop(Math.round(textEnd + 8))}, rgba(255,251,243,0) ${gradientStop(Math.round(textEnd + 88))})`
      : `linear-gradient(180deg, rgba(255,251,243,0.12) 0%, rgba(255,251,243,0.3) ${gradientStop(290)}, rgba(255,251,243,0.26) ${gradientStop(Math.round(Math.min(textEnd, 1000)))}, rgba(255,251,243,0) ${gradientStop(Math.round(Math.min(textEnd, 1000) + 100))})`}} />
    <div style={{position: 'absolute', top: 320, left: 90, right: 90, bottom: 270, color: '#102330', textShadow: '0 1px 3px rgba(255,255,255,0.45)'}}>
      <div style={{fontFamily: 'BankDisplay', fontSize: heading.size, fontWeight: 600, lineHeight: 1.12, letterSpacing: -0.5, whiteSpace: 'pre', opacity: interpolate(frame, [0, 8], [index === 0 ? 1 : 0.4, 1], clamp), translate: `0 ${interpolate(frame, [0, 12], [index === 0 ? 0 : 13, 0], clamp)}px`}}>{heading.text}</div>
      <div style={{marginTop: 42, fontFamily: 'BankSans', fontSize: body.size, fontWeight: 600, lineHeight: 1.38, whiteSpace: 'pre', opacity: interpolate(frame, [0, 12], [0.35, 1], clamp), translate: `0 ${interpolate(frame, [0, 14], [10, 0], clamp)}px`}}>{body.text}</div>
    </div>
  </AbsoluteFill>;
};

export const bankDurationInFrames = (post: BankPost, fps = 30) => post.scenes.reduce((sum, scene) => sum + Math.round(scene.seconds * fps), 0);

export const BankVideo: React.FC<{post: BankPost}> = ({post}) => {
  const {fps} = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading local Cyrillic fonts'));
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    fontsReady().then(() => { setFontsLoaded(true); continueRender(fontHandle); }).catch(cancelRender);
  }, [fontHandle]);
  const totalFrames = bankDurationInFrames(post, fps);
  const photo = post.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  if (!fontsLoaded) return null;
  let cursor = 0;
  return (
    <AbsoluteFill>
      {post.scenes.map((scene, index) => {
        const from = cursor;
        const durationInFrames = Math.round(scene.seconds * fps);
        cursor += durationInFrames;
        return <Sequence key={`${post.id}-${index}`} name={scene.headline} from={from} durationInFrames={durationInFrames}><Scene scene={scene} index={index} total={post.scenes.length} photo={photo} /></Sequence>;
      })}
      <Audio src={staticFile('classical.mp3')} volume={(frame) => interpolate(frame, [0, fps * 0.1, Math.max(fps, totalFrames - fps * 0.5), totalFrames - 1], [0, 0.75, 0.75, 0], clamp)} />
    </AbsoluteFill>
  );
};
