import {AbsoluteFill, Composition, staticFile} from 'remotion';
import {Video} from '@remotion/media';

const Pilot = () => (
  <AbsoluteFill style={{backgroundColor: '#f7f3e9'}}>
    <Video src={staticFile('pilot.mp4')} objectFit="contain" style={{width: '100%', height: '100%'}} />
  </AbsoluteFill>
);

export const MyComposition = () => (
  <Composition id="MamaPilot" component={Pilot} durationInFrames={600} fps={30} width={1080} height={1920} />
);
