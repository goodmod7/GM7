import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>AI Operator</h1>
      <p>TeamViewer-style AI operator platform for remote device control.</p>
      
      <nav style={{ marginTop: '2rem' }}>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ marginBottom: '1rem' }}>
            <Link href="/download" style={{ color: '#0070f3', textDecoration: 'none' }}>
              → Download Desktop App
            </Link>
          </li>
          <li>
            <Link href="/dashboard" style={{ color: '#0070f3', textDecoration: 'none' }}>
              → Open Dashboard
            </Link>
          </li>
          <li style={{ marginTop: '1rem' }}>
            <Link href="/login" style={{ color: '#0070f3', textDecoration: 'none' }}>
              → Login
            </Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
