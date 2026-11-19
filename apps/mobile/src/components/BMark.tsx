import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// The BMUETTE "B": the upper loop is a play button (video), the lower loop is an open bag (shop).
export const B_PATH =
  'M300 230H540C650 230 722 290 722 382C722 442 692 482 644 502C708 522 752 572 752 646C752 746 676 800 560 800H300Z' +
  'M420 332L420 452Q420 462 429 457L590 396Q600 392 590 388L429 327Q420 324 420 332Z' +
  'M420 568H560Q640 568 640 634Q640 700 560 700H420Z';

export function BMark({ size = 48, color = 'card' }: { size?: number; color?: 'card' | 'ink' }) {
  return (
    <Svg width={size} height={size} viewBox="280 200 490 620">
      <Defs>
        <LinearGradient id="bm" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color === 'card' ? '#FFFFFF' : '#26272B'} />
          <Stop offset="1" stopColor={color === 'card' ? '#DCDDE1' : '#050506'} />
        </LinearGradient>
      </Defs>
      <Path d={B_PATH} fill="url(#bm)" fillRule="evenodd" />
    </Svg>
  );
}
