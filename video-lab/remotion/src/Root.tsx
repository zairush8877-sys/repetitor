import { MyComposition } from "./Composition";
import {Composition} from 'remotion';
import {BankVideo, BankPost, bankDurationInFrames} from './Bank';
import bank from './bank.json';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      {(bank as BankPost[]).map((post) => <Composition key={post.id} id={'Bank-' + post.id} component={BankVideo} defaultProps={{post}} width={1080} height={1920} fps={30} durationInFrames={bankDurationInFrames(post)} />)}
    </>
  );
};
