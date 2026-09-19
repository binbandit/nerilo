import type {ReactNode} from 'react';
import {DM_Sans, DM_Serif_Display} from 'next/font/google';
import './globals.css';

const sans = DM_Sans({subsets: ['latin'], variable: '--font-nerilo-sans'});
const serif = DM_Serif_Display({subsets: ['latin'], weight: '400', variable: '--font-nerilo-serif'});

export const metadata = {title: 'Nerilo · Astryx theme', description: 'Nerilo component and theme preview.'};

export default function RootLayout({children}: {children: ReactNode}) {
  return <html lang="en"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
