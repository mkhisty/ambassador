import './globals.css';
import logo from '../assets/logo.png';

export const metadata = {
  title: 'Ambassador — Outreach campaigns',
  description: 'Plan outreach campaigns, manage contacts, and track responses, follow-ups, and outcomes.',
  icons: { icon: { url: logo.src, type: 'image/png' }, apple: logo.src },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
