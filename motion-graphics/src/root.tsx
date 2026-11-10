import React from 'react';
import {Composition} from 'remotion';
import {Film} from './video';
export const Root = () => <><Composition id="Science30" component={Film} durationInFrames={10800} fps={60} width={3840} height={2160}/><Composition id="Science30Fast" component={Film} durationInFrames={2700} fps={15} width={3840} height={2160}/></>;
