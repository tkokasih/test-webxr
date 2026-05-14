function BranchBanner() {
  const branch = import.meta.env.VITE_BUILD_BRANCH;
  const sha = import.meta.env.VITE_BUILD_SHA;

  if (!branch || branch === 'main') return null;

  return (
    <div className="branch-banner">
      Preview — branch: <strong>{branch}</strong>
      {sha && <span> · {sha}</span>}
    </div>
  );
}

export default function App() {
  return (
    <>
      <BranchBanner />
      <main>
        <h1>Template SPA</h1>
        <p>Start building your app here.</p>
      </main>
    </>
  );
}
