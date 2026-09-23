import type { ReactNode } from "react";

export default function HomePage(): ReactNode {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>AWS Infrastructure Explorer</h1>
      <p>
        Read-only visual overview of AWS infrastructure across accounts and
        regions.
      </p>
      <p style={{ color: "#888" }}>
        Frontend pages (Overview, Infrastructure Map, Resource Explorer) arrive
        in a later phase.
      </p>
    </main>
  );
}
