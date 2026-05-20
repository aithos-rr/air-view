export function WebGLFallback() {
  return (
    <main style={{ padding: '48px', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: '17px' }}>Air View</h1>
      <p>
        Air View requires WebGL2 to render the globe. Your browser does not appear to support it.
      </p>
      <p style={{ marginTop: '17px', opacity: 0.7 }}>
        Try a recent version of Chrome, Firefox, Safari, or Edge.
      </p>
    </main>
  );
}
