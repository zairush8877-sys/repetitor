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

const colors = {
  cream: {paper: '#f7f3e9', ink: '#153f92', accent: '#d9e5c7'},
  mint: {paper: '#dcece2', ink: '#193e36', accent: '#fff2ae'},
  yellow: {paper: '#fff0b4', ink: '#37351e', accent: '#e9dbc0'},
  blue: {paper: '#e3eaf7', ink: '#153f92', accent: '#ffffff'},
};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
let loadedFonts: Promise<unknown> | undefined;

function fontsReady() {
  if (!loadedFonts) {
    loadedFonts = Promise.all([
      ['BankSerif', 'IBMPlexSerif-Bold.ttf', '700'],
      ['BankSans', 'manrope-600.woff2', '600'],
      ['BankSans', 'manrope-400.woff2', '400'],
    ].map(async ([family, file, weight]) => {
      const font = new FontFace(family, `url("${staticFile(`fonts/${file}`)}")`, {weight});
      const loaded = await font.load();
      document.fonts.add(loaded);
    }));
  }
  return loadedFonts;
}

const Scene: React.FC<{scene: BankScene; index: number; total: number; photo: string}> = ({scene, index, total, photo}) => {
  const frame = useCurrentFrame();
  const palette = colors[scene.tone];
  const first = index === 0;
  const last = index === total - 1;
  const titleSize = scene.headline.length > 68 ? 76 : scene.headline.length > 42 ? 88 : 106;
  const bodySize = scene.body.length > 240 ? 43 : scene.body.length > 170 ? 49 : 57;
  return (
    <AbsoluteFill style={{backgroundColor: palette.paper, color: palette.ink, fontFamily: 'BankSans', overflow: 'hidden'}}>
      <div style={{position: 'absolute', left: 90, right: 90, top: 304, bottom: 266, display: 'flex', flexDirection: 'column'}}>
        <div style={{fontSize: 25, letterSpacing: 2.5, fontWeight: 600, marginBottom: 48}}>@mairova_a_a</div>
        <div style={{position: 'relative', paddingBottom: 32}}>
          <div style={{fontFamily: 'BankSerif', fontWeight: 700, fontSize: titleSize, lineHeight: 1.1, letterSpacing: -2, whiteSpace: 'pre-line', overflowWrap: 'break-word', translate: `0 ${interpolate(frame, [0, 12], [first ? 0 : 22, 0], clamp)}px`, opacity: interpolate(frame, [0, 9], [first ? 1 : 0.35, 1], clamp)}}>{scene.headline}</div>
          <div style={{height: 8, width: `${interpolate(frame, [6, 21], [0, 34], clamp)}%`, background: palette.ink, marginTop: 34, borderRadius: 8}} />
        </div>
        <div style={{fontSize: bodySize, lineHeight: 1.42, fontWeight: 400, whiteSpace: 'pre-line', overflowWrap: 'break-word', marginTop: 18, opacity: interpolate(frame, [5, 17], [0.25, 1], clamp), translate: `0 ${interpolate(frame, [5, 17], [12, 0], clamp)}px`}}>{scene.body}</div>
        {first ? (
          <div style={{marginTop: 46, flex: '1 1 280px', minHeight: 160, maxHeight: 450, backgroundColor: '#ffffff', padding: 18, boxShadow: '0 12px 30px #17281b12', rotate: '-1.2deg'}}>
            <CanvasImage src={staticFile(`photos/${photo}`)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
          </div>
        ) : <div style={{flex: 1, minHeight: 30}} />}
        <div style={{marginTop: first ? 26 : 45, display: 'flex', alignItems: 'center', gap: 10}}>
          {Array.from({length: total}, (_, n) => <div key={n} style={{height: 5, flex: 1, backgroundColor: palette.ink, opacity: n <= index ? 0.75 : 0.12}} />)}
        </div>
        {last && <div style={{fontSize: 27, marginTop: 26, letterSpacing: 0.2}}>Русский язык в обычной жизни</div>}
      </div>
    </AbsoluteFill>
  );
};

export const bankDurationInFrames = (post: BankPost, fps = 30) => post.scenes.reduce((sum, scene) => sum + Math.round(scene.seconds * fps), 0);

export const BankVideo: React.FC<{post: BankPost}> = ({post}) => {
  const {fps} = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading local Cyrillic fonts'));
  useEffect(() => {
    fontsReady().then(() => continueRender(fontHandle)).catch(cancelRender);
  }, [fontHandle]);
  const totalFrames = bankDurationInFrames(post, fps);
  const photo = post.school || post.id.length % 2 === 0 ? 'jeshoots-notebook.jpg' : 'clay-banks-notebook.jpg';
  let cursor = 0;
  return (
    <AbsoluteFill>
      {post.scenes.map((scene, index) => {
        const from = cursor;
        const durationInFrames = Math.round(scene.seconds * fps);
        cursor += durationInFrames;
        return <Sequence key={`${post.id}-${index}`} name={scene.headline} from={from} durationInFrames={durationInFrames}><Scene scene={scene} index={index} total={post.scenes.length} photo={photo} /></Sequence>;
      })}
      <Audio src={staticFile('music.mp3')} volume={(frame) => interpolate(frame, [0, fps * 0.7, Math.max(fps, totalFrames - fps * 1.2), totalFrames - 1], [0, 0.22, 0.22, 0], clamp)} />
    </AbsoluteFill>
  );
};
