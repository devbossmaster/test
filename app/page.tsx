// /app/page.tsx  (add a link)
import Link from 'next/link';

export default function Home() {
  return (
    <main className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">thebotpro — Local Demo</h1>
      <div className="flex gap-3">
        <Link href="/dashboard" className="px-4 py-2 rounded bg-blue-600">Dashboard</Link>
        <Link href="/advanced" className="px-4 py-2 rounded bg-neutral-800">Advanced</Link>
    
      </div>
    </main>
  );
}
