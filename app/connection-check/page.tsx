import type { Metadata } from 'next';
import ConnectionCheck from './probe';
export const metadata: Metadata = { title: 'Connection check · Cambio', robots: { index: false, follow: false } };
export default function Page() { return <ConnectionCheck/>; }
