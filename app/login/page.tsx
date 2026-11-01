import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/lib/actions";
import { getSessionUser } from "@/lib/session";
import AuthPasswordField from "@/components/AuthPasswordField";

export const metadata = { title: "Login" };

// Demo accounts for quick login
export const DEMO = [
  { email: "admin@relialedger.app", name: "Maya Iyer", role: "Company Admin", note: "Full access, can enable modules", password: "demo1234" },
  { email: "analyst@relialedger.app", name: "Priya Raman", role: "Analyst", note: "Write to PBS, Register, FMEA", password: "demo1234" },
  { email: "reviewer@relialedger.app", name: "Tom Beckett", role: "Reviewer", note: "Read‑only everywhere", password: "demo1234" },
  { email: "username-test", name: "Test User", role: "Tester", note: "Testing credentials", password: "password-test" },
];

const BULLETS = [
  "λ per component, propagated to FMECA, FTA, RBD and spares",
  "MIL‑STD‑1629A criticality and IEC‑61078 block diagrams, done correctly",
  "Freeze‑frame report snapshots — a reviewer can always reproduce a number",
  "Excel‑first: every grid imports, every report exports",
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect("/projects");
  const params = await searchParams;
  const error = params.error === "1";

  return (
    <div className="login-page">
      <div className="auth">
        <aside className="auth-art">
          <div className="brand auth-brand">
            <div className="brand-mark">R</div>
            <div>
              <div className="brand-name">RAMSport03</div>
              <div className="brand-sub">Reliability · Availability · Maintainability · Safety</div>
            </div>
          </div>

          <div className="auth-art-body">
            <span className="auth-kicker">Reliability engineering workspace</span>
            <h1>
              Reliability analysis that can <em>prove itself.</em>
            </h1>
            <p>
              Nine linked modules model the data flow. Change a failure rate, see the impact on criticality,
              hazard, cut set and report recompute — with the revision that used it.
            </p>

            <ul className="auth-bullets">
              {BULLETS.map((line, i) => (
                <li key={i} className="auth-bullet" data-i={String(i + 1).padStart(2, "0")}>
                  <span className="auth-tick">✓</span> {line}
                </li>
              ))}
            </ul>

            <div className="auth-metrics" aria-hidden="true">
              <div className="auth-metric">
                <b>09</b>
                <span>Linked modules</span>
              </div>
              <div className="auth-metric">
                <b>04</b>
                <span>Standards</span>
              </div>
              <div className="auth-metric">
                <b>100%</b>
                <span>Traceable</span>
              </div>
            </div>

            <svg
              className="auth-plot"
              viewBox="0 0 340 96"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <linearGradient id="authPlotFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f2a33c" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="#f2a33c" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 14C52 18 84 30 126 48s92 30 214 36v12H0Z" fill="url(#authPlotFill)" />
              <path d="M0 14C52 18 84 30 126 48s92 30 214 36" stroke="#f2a33c" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="126" cy="48" r="3" fill="#ffc168" />
              <circle cx="126" cy="48" r="7" stroke="#f2a33c" strokeOpacity="0.35" />
              <line x1="126" y1="48" x2="126" y2="96" stroke="#f2a33c" strokeOpacity="0.18" strokeDasharray="3 4" />
            </svg>
          </div>

          <div className="auth-foot">
            Clean‑room implementation · IEC‑61078 · MIL‑STD‑1629A · MIL‑HDBK‑217F part‑stress method
          </div>
        </aside>

        <main className="auth-form-wrap">
          <div className="auth-card">
            <div className="auth-card-top">
              <span className="auth-secure">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="10.5" width="16" height="9.5" rx="2.2" />
                  <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
                </svg>
                Secure sign‑in
              </span>
              <span className="auth-env">Local demo</span>
            </div>

            <div className="brand auth-card-brand">
              <div className="brand-mark">R</div>
              <div>
                <div className="brand-name">RAMSport03</div>
                <div className="brand-sub">Reliability · Availability · Maintainability · Safety</div>
              </div>
            </div>

            <h2>Sign in</h2>
            <p className="sub">Welcome back. Use your credentials or a one‑click demo account below.</p>

            {error && (
              <div className="auth-error" role="alert">
                That username/email and password combination did not match.
              </div>
            )}

            <form action={signInAction} className="stack auth-form" style={{ gap: 14 }}>
              <div className="field">
                <label htmlFor="email">Username or email</label>
                <div className="auth-input">
                  <span className="auth-input-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="2.2" />
                      <path d="m3.5 6.5 8.5 6 8.5-6" />
                    </svg>
                  </span>
                  <input
                    className="input"
                    id="email"
                    name="email"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    placeholder="you@company.com or username"
                    defaultValue={params.email ?? "admin@relialedger.app"}
                    required
                  />
                  <span className="field-hint">Testing user: <strong>username-test</strong></span>
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <AuthPasswordField
                  id="password"
                  name="password"
                  placeholder="Enter your password"
                  defaultValue="demo1234"
                />
                <span className="field-hint">Testing password: <strong>password-test</strong></span>
              </div>

              <button className="btn btn-primary auth-submit" type="submit">
                Sign in
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12h15" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue as demo</span>
            </div>

            <div className="demo-box">
              {DEMO.map((demo) => (
                <form action={signInAction} key={demo.email}>
                  <input type="hidden" name="email" value={demo.email} />
                  <input type="hidden" name="password" value={demo.password} />
                  <button className="demo-btn" type="submit" title={demo.note}>
                    <span className="demo-name">{demo.name}</span>
                    <span className="demo-role">{demo.role}</span>
                    <svg className="demo-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </form>
              ))}
              <p className="auth-cred-note">
                Test login <code>username-test</code> / <code>password-test</code>
              </p>
            </div>

            <p className="tiny muted auth-card-foot">
              <Link href="/login">RAMSport03</Link> · local demo environment, data stored in
              <span className="muted"> data/relialedger.db</span>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
