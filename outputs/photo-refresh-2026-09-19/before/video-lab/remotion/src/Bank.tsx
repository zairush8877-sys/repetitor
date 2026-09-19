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
const ink = '#172b57';
const coral = '#dd483e';
const paper = '#f6f1e7';
const blue = '#c9def6';
const pink = '#f2bfc7';
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

const Paper: React.FC<React.PropsWithChildren<{frame: number; delay?: number; rotate?: number; style?: React.CSSProperties}>> = ({frame, delay = 0, rotate = -1.5, style, children}) => (
  <div style={{position: 'absolute', padding: 36, boxSizing: 'border-box', background: '#fffdfa', boxShadow: '7px 13px 0 #172b5715', rotate: `${interpolate(frame, [delay, delay + 14], [rotate + 2.5, rotate], clamp)}deg`, translate: `0 ${interpolate(frame, [delay, delay + 14], [34, 0], clamp)}px`, opacity: interpolate(frame, [delay, delay + 7], [0, 1], clamp), ...style}}>{children}</div>
);

const Headline: React.FC<{text: string; frame: number; size?: number; light?: boolean}> = ({text, frame, size = 120, light = false}) => {
  const lines = text.split('\n');
  return <div style={{fontFamily: 'BankDisplay', fontWeight: 600, fontSize: size, lineHeight: 1.12, letterSpacing: -1.5, color: light ? '#fffdfa' : ink}}>
    {lines.map((line, i) => <div key={i} style={{opacity: interpolate(frame, [i * 4, i * 4 + 8], [i === 0 ? 1 : 0.25, 1], clamp), translate: `${interpolate(frame, [i * 4, i * 4 + 12], [i % 2 ? 26 : -18, 0], clamp)}px 0`, whiteSpace: 'pre'}}>{i === lines.length - 1 ? <span style={{color: light ? '#ffddd1' : coral}}>{line}</span> : line}</div>)}
  </div>;
};

const Photo: React.FC<{src: string; frame: number; style?: React.CSSProperties}> = ({src, frame, style}) => <Paper frame={frame} delay={8} rotate={-3} style={{padding: 16, ...style}}>
  <CanvasImage src={staticFile(`photos/${src}`)} style={{width: '100%', height: '100%', objectFit: 'contain'}} />
  <div style={{position: 'absolute', top: -14, left: '40%', height: 35, width: 155, background: '#eedfabae', rotate: '-5deg'}} />
</Paper>;

const Arrow: React.FC<{frame: number; style?: React.CSSProperties}> = ({frame, style}) => <div style={{position: 'absolute', width: 130, height: 60, borderBottom: `7px solid ${coral}`, borderRight: `7px solid ${coral}`, borderBottomRightRadius: 45, opacity: interpolate(frame, [30, 39], [0, 1], clamp), ...style}}><div style={{position: 'absolute', left: 1, bottom: -14, width: 22, height: 22, borderLeft: `7px solid ${coral}`, borderBottom: `7px solid ${coral}`, rotate: '45deg'}} /></div>;

const Scene: React.FC<{scene: BankScene; index: number; total: number; photo: string}> = ({scene, index, total, photo}) => {
  const frame = useCurrentFrame();
  const last = index === total - 1;
  const lines = scene.body.split('\n');
  const longestHeadingLine = Math.max(...scene.headline.split('\n').map(l => l.length));
  const headlineSize = Math.min(index === 0 ? 156 : 142, 1450 / longestHeadingLine);
  const bodyStyle: React.CSSProperties = {fontFamily: 'BankSans', fontWeight: 600, fontSize: 51, lineHeight: 1.34, whiteSpace: 'pre-line'};
  return <AbsoluteFill style={{background: last ? blue : paper, color: ink, fontFamily: 'BankSans', overflow: 'hidden'}}>
    <div style={{position: 'absolute', left: 82, right: 82, top: 247, height: 36, fontSize: 25, fontWeight: 600, letterSpacing: 1.6, display: 'flex', justifyContent: 'space-between'}}><span>@mairova_a_a</span><span>РУССКИЙ ЯЗЫК</span></div>
    {index === 0 ? <>
      <div style={{position: 'absolute', left: 90, right: 90, top: 340}}><Headline text={scene.headline} frame={frame} size={headlineSize} /><div style={{height: 10, background: ink, marginTop: 28, width: `${interpolate(frame, [10, 30], [0, 72], clamp)}%`, rotate: '-1deg'}} /></div>
      <div style={{position: 'absolute', left: 115, top: 880, width: 790, height: 525, background: pink, rotate: '5deg'}} />
      <Photo src={photo} frame={frame} style={{left: 105, top: 805, width: 870, height: 545}} />
      <Paper frame={frame} delay={15} rotate={1.5} style={{left: 100, top: 1340, width: 875, minHeight: 245, background: '#fff3a4', ...bodyStyle, fontSize: 47}}>{scene.body}</Paper>
    </> : last ? <>
      <div style={{position: 'absolute', left: 95, right: 95, top: 365}}><Headline text={scene.headline} frame={frame} size={Math.min(116, headlineSize)} /></div>
      {lines.map((line, n) => <Paper key={n} frame={frame} delay={n * 6} rotate={n % 2 ? 1.5 : -1.5} style={{left: n % 2 ? 108 : 87, top: 770 + n * (lines.length > 2 ? 260 : 365), width: 885, minHeight: lines.length > 2 ? 215 : 290, background: n === 0 ? '#fffdfa' : n === 1 ? pink : '#fff3a4', display: 'flex', alignItems: 'center', ...bodyStyle, fontSize: line.length > 55 ? 46 : 55}}>{line}</Paper>)}
    </> : index === 1 ? <>
      <Paper frame={frame} rotate={-2} style={{left: 97, top: 365, width: 880, minHeight: 350, background: ink}}><Headline text={scene.headline} frame={frame} size={Math.min(132, headlineSize)} light /></Paper>
      <Paper frame={frame} delay={9} rotate={2} style={{left: 98, top: 855, width: 875, minHeight: 375, background: '#fff3a4', display: 'flex', alignItems: 'center', ...bodyStyle}}>{scene.body}</Paper>
      <Arrow frame={frame} style={{left: 755, top: 753, rotate: '-20deg'}} />
      <Photo src={photo} frame={frame} style={{left: 190, top: 1265, width: 695, height: 335}} />
    </> : index === 2 ? <>
      <div style={{position: 'absolute', left: 80, right: 80, top: 360, padding: '35px 18px', background: pink, rotate: '-1.5deg'}}><Headline text={scene.headline} frame={frame} size={headlineSize} /></div>
      <Photo src={photo} frame={frame} style={{left: 220, top: 925, width: 720, height: 645, rotate: '4deg'}} />
      <Paper frame={frame} delay={10} rotate={-3} style={{left: 95, top: 790, width: 850, minHeight: 325, background: '#fffdfa', ...bodyStyle}}>{scene.body}</Paper>
      <Arrow frame={frame} style={{left: 97, top: 1260, rotate: '-70deg'}} />
    </> : <>
      <div style={{position: 'absolute', left: 95, right: 95, top: 370}}><Headline text={scene.headline} frame={frame} size={headlineSize} /></div>
      {lines.map((line, n) => <Paper key={n} frame={frame} delay={n * 9 + 5} rotate={n % 2 ? 2 : -2} style={{left: n % 2 ? 128 : 90, top: 810 + n * (lines.length > 2 ? 245 : 330), width: n % 2 ? 820 : 865, minHeight: lines.length > 2 ? 200 : 280, background: n % 2 ? blue : '#fffdfa', display: 'flex', alignItems: 'center', ...bodyStyle, fontSize: line.length > 56 ? 46 : 53}}>{line}</Paper>)}
      <div style={{position: 'absolute', left: 150, bottom: 310, height: 9, background: coral, width: interpolate(frame, [40, 65], [0, 550], clamp), rotate: '-1.5deg'}} />
    </>}
    <div style={{position: 'absolute', left: 90, right: 90, bottom: 244, display: 'flex', gap: 10}}>{Array.from({length: total}, (_, n) => <div key={n} style={{height: 5, flex: 1, backgroundColor: ink, opacity: n <= index ? 0.8 : 0.12}} />)}</div>
  </AbsoluteFill>;
};

export const bankDurationInFrames = (post: BankPost, fps = 30) => post.scenes.reduce((sum, scene) => sum + Math.round(scene.seconds * fps), 0);

export const BankVideo: React.FC<{post: BankPost}> = ({post}) => {
  const {fps} = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading local Cyrillic fonts'));
  useEffect(() => {
    fontsReady().then(() => continueRender(fontHandle)).catch(cancelRender);
  }, [fontHandle]);
  const totalFrames = bankDurationInFrames(post, fps);
  const photo = /amfiboliya/.test(post.id) ? 'blue-carriage-nilov.jpg' : /adresant/.test(post.id) ? 'envelope-kerngker.jpg' : /dosmotryu/.test(post.id) ? 'clock-koolshooters.jpg' : /abonent/.test(post.id) ? 'red-phone-outdoors.jpg' : /nevezha/.test(post.id) ? 'atlas-anez.jpg' : 'jeshoots-notebook.jpg';
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
