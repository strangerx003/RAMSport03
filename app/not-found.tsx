import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div className="card" style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <div className="card-body">
          <div className="eyebrow">404 — off the map</div>
          <h1
            className="page-title"
            style={{ fontSize: 26, marginBottom: 8, textTransform: "uppercase", fontFamily: "var(--font-mono)" }}
          >
            Nothing logged here
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 18px" }}>
            This page is not part of the record. The link may be stale — open the project list and
            choose a project, then use the section navigation.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/projects">
              All projects
            </Link>
            <Link className="btn" href="/">
              Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
