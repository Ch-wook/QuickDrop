import type { CSSProperties } from 'react';
const paths = {
  bolt: 'm13 2-9 12h7l-1 8 10-13h-8z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8m-8 4h5',
  copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
  check: 'm5 12 4 4L19 6',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
  monitor: 'M3 3h18v13H3zM8 21h8m-4-5v5',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 16h2',
  upload: 'M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 7a8 8 0 1 0 1 8M20 2v5h-5',
  image: 'M3 3h18v18H3zM3 16l5-5 5 5 4-4 4 4M15 7h.01',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4m-4 5v2',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  paperclip: 'm9 17 8-8a3 3 0 0 0-4-4L5 13a5 5 0 0 0 7 7l8-8M8 16l7-7',
};
export function Icon({ name, size = 20, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
