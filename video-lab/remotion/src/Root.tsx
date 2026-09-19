import { MyComposition } from "./Composition";
import {Composition} from 'remotion';
import {BankVideo, BankPost, bankDurationInFrames} from './Bank';
import bank from './bank.json';
import {ExamVideo, ExamPost, examDurationInFrames} from './Exam';
import examBank from './exam-bank.json';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      {(bank as BankPost[]).map((post) => <Composition key={post.id} id={'Bank-' + post.id} component={BankVideo} defaultProps={{post}} width={1080} height={1920} fps={30} durationInFrames={bankDurationInFrames(post)} />)}
      {(examBank as ExamPost[]).flatMap(post => post.format === 'Reels'
        ? [<Composition key={post.id} id={'Exam-' + post.id} component={ExamVideo} defaultProps={{post}} width={1080} height={1920} fps={30} durationInFrames={examDurationInFrames(post)} />]
        : post.scenes.map((scene, slideIndex) => <Composition key={`${post.id}-${slideIndex}`} id={`Exam-${post.id}-slide-${slideIndex + 1}`} component={ExamVideo} defaultProps={{post, slideIndex}} width={1080} height={1350} fps={30} durationInFrames={Math.round(scene.seconds * 30)} />))}
    </>
  );
};
