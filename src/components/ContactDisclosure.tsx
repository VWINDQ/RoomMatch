import type { User } from '../types';
import { contactDetails, contactNames, matchContactDetails } from '../lib/contactDetails';

export function friendContactDisclosure(user: User | null, accepting = false) {
  const ownChannels = contactNames(contactDetails(user));
  const condition = accepting ? 'เมื่อคุณตอบรับ' : 'หากอีกฝ่ายตอบรับ';
  return `${condition} ${ownContactDisclosure('อีกฝ่าย', ownChannels)} และคุณจะเห็นช่องทางติดต่อที่อีกฝ่ายระบุไว้`;
}

export function matchContactNames(user: User | null) {
  return contactNames(matchContactDetails(user));
}

export function ownContactDisclosure(recipient: string, channels: string) {
  return channels ? `${recipient}จะเห็น ${channels} ของคุณ` : `${recipient}จะไม่เห็นช่องทางติดต่อของคุณ`;
}

export function ContactDisclosure({ lines }: { lines: string[] }) {
  return <div className="contact-disclosure">
    {lines.filter(Boolean).map(line => <p className="field-hint" key={line}>{line}</p>)}
  </div>;
}
