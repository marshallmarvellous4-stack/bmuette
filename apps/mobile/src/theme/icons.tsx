import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// One icon family: 24px grid, 1.8 stroke, round caps. Every icon has an outline state and a filled "active" state.
export type IconName =
  | 'home' | 'chat' | 'plus' | 'bag' | 'profile' | 'heart' | 'comment' | 'download' | 'search' | 'share' | 'bookmark' | 'play'
  | 'close' | 'back' | 'check' | 'camera' | 'video' | 'image' | 'tag' | 'send' | 'volumeOff' | 'volumeOn' | 'minimize' | 'expand'
  | 'pause' | 'newChat' | 'more' | 'settings' | 'flag' | 'bell' | 'trash' | 'chevron' | 'lock' | 'block' | 'mic' | 'music'
  | 'cart' | 'scissors' | 'text' | 'filter' | 'star' | 'box' | 'trending' | 'eye' | 'refresh' | 'wallet' | 'truck' | 'mail'
  | 'folder' | 'grid' | 'hash' | 'user';

type Def = { d: string[]; fillable?: boolean; extraCircle?: { cx: number; cy: number; r: number }; filledDetail?: string[] };

const ICONS: Record<IconName, Def> = {
  home: { d: ['M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z'], fillable: true, filledDetail: ['M9.8 20v-4.2a2.2 2.2 0 0 1 4.4 0V20'] },
  chat: { d: ['M5 4.5h14A2 2 0 0 1 21 6.5v9a2 2 0 0 1-2 2h-6.6L8 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z'], fillable: true },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  bag: { d: ['M6.2 8h11.6l1 12H5.2Z', 'M9 8V7a3 3 0 0 1 6 0v1'], fillable: true },
  profile: { d: ['M5 20c.4-3.4 3.2-5.6 7-5.6s6.6 2.2 7 5.6'], extraCircle: { cx: 12, cy: 8.4, r: 3.6 }, fillable: true },
  heart: { d: ['M12 20.2S4.6 15.9 4.6 10a4.2 4.2 0 0 1 7.4-2.7A4.2 4.2 0 0 1 19.4 10c0 5.9-7.4 10.2-7.4 10.2Z'], fillable: true },
  comment: { d: ['M12 3.8a8.2 8.2 0 1 0 4 15.4l3.9.9-1-3.7A8.2 8.2 0 0 0 12 3.8Z'], fillable: true },
  download: { d: ['M12 4v11', 'm7.5 11 4.5 4.5 4.5-4.5', 'M5 19.5h14'] },
  search: { d: ['m20 20-4-4'], extraCircle: { cx: 11, cy: 11, r: 6.2 } },
  share: { d: ['m14 5 6 6-6 6', 'M20 11H10a6 6 0 0 0-6 6v1'] },
  bookmark: { d: ['M7 4h10v16.2l-5-3.7-5 3.7Z'], fillable: true },
  play: { d: ['M8.2 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L9.1 5.1a.6.6 0 0 0-.9.5Z'], fillable: true },
  close: { d: ['m6 6 12 12', 'm18 6-12 12'] },
  back: { d: ['m15 5-7 7 7 7'] },
  check: { d: ['m5 12.6 4.4 4.4L19 7.4'] },
  camera: { d: ['M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z'], extraCircle: { cx: 12, cy: 13, r: 3.3 } },
  video: { d: ['M3.5 7.5A1.5 1.5 0 0 1 5 6h8.5A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z', 'm15 10.5 5.5-3v9l-5.5-3'], fillable: true },
  image: { d: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z', 'm4.5 16 4.2-4.2 3.3 3.3 2.5-2.5 5 5'] },
  tag: { d: ['M4 4h7.6l8.4 8.4a1.4 1.4 0 0 1 0 2l-5.6 5.6a1.4 1.4 0 0 1-2 0L4 11.6Z'], extraCircle: { cx: 8.4, cy: 8.4, r: 1.2 } },
  send: { d: ['M20.5 3.5 10.2 13.8', 'M20.5 3.5 14 20.5l-3.8-6.7L3.5 10Z'], fillable: true },
  volumeOff: { d: ['M4 9.5h3.2L12 5.5v13l-4.8-4H4Z', 'm16 9.5 4 5', 'm20 9.5-4 5'] },
  minimize: { d: ['m4 14 6 0 0 6', 'm20 10-6 0 0-6', 'm10 14-6.5 6.5', 'm14 10 6.5-6.5'] },
  expand: { d: ['M14 4h6v6', 'M10 20H4v-6', 'M20 4l-7 7', 'M4 20l7-7'] },
  pause: { d: ['M8 5.5v13', 'M16 5.5v13'] },
  newChat: { d: ['M12 4.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12', 'M17.2 3.6a1.8 1.8 0 0 1 2.6 2.6L12 14l-3.6.9.9-3.6Z'] },
  more: { d: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'], },
  settings: { d: ['M12 3.8v2.2', 'M12 18v2.2', 'm5.9 6 1.6 1.6', 'm16.5 16.4 1.6 1.6', 'M3.8 12H6', 'M18 12h2.2', 'm5.9 18 1.6-1.6', 'm16.5 7.6 1.6-1.6'], extraCircle: { cx: 12, cy: 12, r: 3.2 } },
  flag: { d: ['M6 20.5V4.5', 'M6 5h11.5l-2 3.8 2 3.8H6'], fillable: true },
  bell: { d: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z', 'M10 20.5a2.2 2.2 0 0 0 4 0'], fillable: true },
  trash: { d: ['M4.5 7h15', 'M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2', 'M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7', 'M10 11v5.5', 'M14 11v5.5'] },
  chevron: { d: ['m9 5 7 7-7 7'] },
  lock: { d: ['M6.5 10.5h11a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z', 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'] },
  block: { d: ['m6.2 6.2 11.6 11.6'], extraCircle: { cx: 12, cy: 12, r: 8.2 } },
  mic: { d: ['M12 3.8a3 3 0 0 1 3 3V12a3 3 0 0 1-6 0V6.8a3 3 0 0 1 3-3Z', 'M6.5 11.5a5.5 5.5 0 0 0 11 0', 'M12 17v3.2'], fillable: true },
  music: { d: ['M9 17.5V6.2l10-2v11.3', 'M9 17.5a2.3 2.3 0 1 1-2.3-2.3A2.3 2.3 0 0 1 9 17.5Z', 'M19 15.5a2.3 2.3 0 1 1-2.3-2.3A2.3 2.3 0 0 1 19 15.5Z'] },
  cart: { d: ['M3.5 4.5H6l2 10.5h9.5l1.8-7.5H7', 'M10 19.2h.01', 'M16.5 19.2h.01'] },
  scissors: { d: ['m8.5 8.5 11 9', 'm8.5 15.5 11-9', 'M7 6.5a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 7 6.5Z', 'M7 14.5a2.5 2.5 0 1 1-2.5 2.5 2.5 2.5 0 0 1 2.5-2.5Z'] },
  text: { d: ['M5 6.5V5h14v1.5', 'M12 5v14', 'M9.5 19h5'] },
  filter: { d: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 4v16', 'M5 9.5c3 .8 5 .8 7 0s4-.8 7 0'] },
  star: { d: ['m12 4 2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7Z'], fillable: true },
  box: { d: ['M4 8l8-4 8 4v8.5l-8 4-8-4Z', 'M4 8l8 4 8-4', 'M12 12v8.5'] },
  trending: { d: ['m4 16 5.5-5.5 3.5 3.5L20 7', 'M15 7h5v5'] },
  eye: { d: ['M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z'], extraCircle: { cx: 12, cy: 12, r: 2.8 } },
  refresh: { d: ['M19.5 12a7.5 7.5 0 1 1-2.4-5.5', 'M19.5 4.5v4h-4'] },
  wallet: { d: ['M4 7.5A2 2 0 0 1 6 5.5h11.5v3', 'M4 7.5v10a2 2 0 0 0 2 2h13.5v-11H6a2 2 0 0 1-2-1', 'M16 13.5h.01'] },
  mail: { d: ['M4 6.5h16v11H4Z', 'm4.5 7 7.5 6 7.5-6'] },
  truck: { d: ['M3 6.5h11v9H3Z', 'M14 9.5h4l3 3v3h-7', 'M7.5 18.5a1.6 1.6 0 1 0 0-.01', 'M17.5 18.5a1.6 1.6 0 1 0 0-.01'] },
  grid: { d: ['M4 4h6.5v6.5H4Z', 'M13.5 4H20v6.5h-6.5Z', 'M4 13.5h6.5V20H4Z', 'M13.5 13.5H20V20h-6.5Z'], fillable: true },
  folder: { d: ['M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z'], fillable: true },
  user: { d: ['M5 20c.4-3.4 3.2-5.6 7-5.6s6.6 2.2 7 5.6'], extraCircle: { cx: 12, cy: 8.4, r: 3.6 } },
  hash: { d: ['M9 4 7 20', 'M17 4l-2 16', 'M4.5 9h16', 'M3.5 15h16'] },
  volumeOn: { d: ['M4 9.5h3.2L12 5.5v13l-4.8-4H4Z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.6a7.4 7.4 0 0 1 0 10.8'] },
};

export function Icon({ name, size = 24, color = '#fff', active = false, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; active?: boolean; strokeWidth?: number }) {
  const def = ICONS[name];
  const filled = active && def.fillable;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {def.extraCircle ? (
        <Circle cx={def.extraCircle.cx} cy={def.extraCircle.cy} r={def.extraCircle.r} stroke={color} strokeWidth={strokeWidth} fill={filled ? color : 'none'} />
      ) : null}
      {def.d.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill={filled && i === 0 && !def.extraCircle ? color : 'none'} />
      ))}
      {filled && def.filledDetail?.map((d, i) => <Path key={`f${i}`} d={d} stroke="#0B0B0D" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />)}
    </Svg>
  );
}
