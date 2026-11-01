import { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Synapse — Reliability Dashboard",
    template: "%s — Synapse | RAMSport03",
  },
  description:
    "Real-time reliability, availability, and safety analysis dashboard — per-value provenance, Excel-first reporting",
};

export default function LandingPage() {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
        {/* CRT scanline + vignette overlay */}
        <style>{`
          body::after {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            background: 
              radial-gradient(at 50% 0%, rgba(242,163,60,0.03) 0%, transparent 50%),
              radial-gradient(at 0% 100%, rgba(242,163,60,0.02) 0%, transparent 50%),
              radial-gradient(at 100% 100%, rgba(242,163,60,0.02) 0%, transparent 50%);
            z-index: 100;
            mask-image: linear-gradient(to bottom, black, transparent);
          }

          /* Animated scanline */
          @keyframes scanline {
            0% { top: -1px; }
            100% { top: 101%; }
          }
          body::before {
            content: "";
            position: fixed;
            left: 0; right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(242,163,60,0.15), transparent);
            top: 0;
            z-index: 101;
            animation: scanline 8s linear infinite;
          }
        `}</style>

        {/* Hero-shapes back - blurred circles */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-10">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-[var(--accent)]/10 rounded-full blur-3xl animate-floatA"></div>
          <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-[var(--accent)]/5 rounded-full blur-3xl animate-floatB"></div>
          <div className="absolute top-1/2 right-1/2 w-32 h-32 bg-[var(--accent)]/5 rounded-full blur-sm animate-floatC"></div>
        </div>

        {/* Main content - with amber glow effect on focus */}
        <main className="relative z-20 min-h-screen">

          {/* Topbar - amber underglow seam */}
          <header className="topbar border-b border-[var(--border-strong)] backdrop-blur-sm bg-[var(--surface)]/80 sticky top-0 z-30">
            <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[var(--accent)] text-lg font-mono uppercase tracking-wider">SYNAPSE</span>
                <h1 className="text-xl font-medium">Reliability Dashboard</h1>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[var(--text-muted)] text-sm">Project: Kestrel-9 Flight Control</span>
                <a
                  href="/login"
                  className="btn-primary px-4 py-2 text-sm"
                >
                  Open Dashboard
                </a>
              </div>
            </div>
          </header>

          {/* Hero Section */}
          <section className="hero min-h-[60vh] relative flex items-center justify-center position-relative">
            <div className="max-w-[1600px] mx-auto px-4 py-12 flex flex-col items-center text-center">
              
              {/* Eyebrow */}
              <p className="eyebrow mb-6">Reliability Analysis</p>
              
              <h1 className="hero-h1 text-7xl md:text-9xl lg:text-[clamp(48px,35vw,82px)] font-extrabold text-[var(--on-dark)] mb-6 leading-tight">
                Real-time<br/>
                <span className="text-[var(--accent)]">Critical Metrics</span>
              </h1>
              
              <p className="hero-subtitle text-[var(--text-muted)] text-base md:text-lg max-w-xl mx-auto mb-8">
                Monitor failure rates, criticality rankings, and hazard registers across all nine modules with per-value provenance. Every metric keeps a record of the revision it was computed from.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="/pbs"
                  className="btn-primary px-6 py-3 text-lg font-medium"
                >
                  Open PBS Module
                </a>
                <a
                  href="/settings"
                  className="btn-secondary px-6 py-3 text-lg font-medium"
                >
                  Settings
                </a>
              </div>
            </div>

            {/* Mouse parallax container */}
            <div className="hero-container absolute inset-0 overflow-hidden">
              <div className="hero-shapes-back absolute inset-0">
                <div className="shape absolute top-1/3 left-1/4 w-64 h-64 bg-[var(--accent)]/5 rounded-full blur-2xl opacity-30 animate-floatA"></div>
                <div className="shape absolute bottom-1/4 right-1/4 w-48 h-48 bg-[var(--accent)]/3 rounded-full blur-2xl opacity-20 animate-floatB"></div>
                <div className="shape absolute top-1/2 right-1/2 w-32 h-32 bg-[var(--accent)]/3 rounded-full blur-sm opacity-15 animate-floatC"></div>
              </div>
              <div className="hero-shapes-mid absolute inset-0 grid grid-cols-2 gap-2 place-items-center pointer-events-none">
                <div className="shape w-8 h-8 bg-[var(--accent)] rounded-full opacity-40 animate-floatA"></div>
                <div className="shape w-8 h-8 bg-[var(--accent)] rounded-full opacity-30 animate-floatB"></div>
                <div className="shape w-8 h-8 bg-[var(--accent)] rounded-full opacity-20"></div>
                <div className="shape w-8 h-8 bg-[var(--accent)] rounded-full opacity-10"></div>
              </div>
            </div>
          </section>

          {/* Features Section - 9 modules grid */}
          <section className="py-24 md:py-32 bg-[var(--surface-2)]">
            <div className="max-w-[1600px] mx-auto px-4">
              <div className="text-center mb-16">
                <h2 className="section-h2 text-3xl md:text-4xl font-extrabold text-[var(--on-dark)] mb-4">
                  Nine Reliability Modules
                </h2>
                <p className="text-[var(--text-muted)] text-sm">
                  Hierarchy, part numbers, quantities — failure rate entered once propagates into
                  criticality, hazards, cut sets, spares, maintenance and the report pack
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-6">
                {/* PBS Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                      <polyline points="9 3 9 9 15 9"/>
                      <line points="12 3 12 12"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">PBS</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Hierarchy, part numbers, quantities — quantity-weighted λ roll-up
                  </p>
                </article>

                {/* FMECA Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M12 2L4 7l8 5 8-5-5.3-3.5a7 7 0 0 0-1.3-3.3L12 2z"/>
                      <circle cx="12" cy="7" r="3"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">FMECA</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Failure modes and criticality ranking — MIL-STD-1629A: Cm = β·α·λ·t
                  </p>
                </article>

                {/* RBD Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <line x1="3" y1="21" x2="21" y2="21"/>
                      <line x1="3" y1="3" x2="3.01" y2="21"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">RBD</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Series / parallel / k-of-n blocks — Rsys = Π stage reliability
                  </p>
                </article>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-6">
                {/* PM Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">PM</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Maintenance tasks and intervals — next due = last done + interval
                  </p>
                </article>

                {/* Spares Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M12 2L4 7l8 5 8-5-5.3-3.5a7 7 0 0 0-1.3-3.3L12 2z"/>
                      <circle cx="19" cy="19" r="1.5"/>
                      <circle cx="5" cy="5" r="1.5"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">Spares</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Demand, reorder point, recommended buy — Poisson lead-time demand at target service level
                  </p>
                </article>

                {/* Safety Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      <line x1="15" y1="15" x2="3" y2="3"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">Safety</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Hazard register, residual risk, ALARP — risk = severity × likelihood
                  </p>
                </article>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-6">
                {/* FTA Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M18.5 2.5L15.5 1.6l-4.5 5.5L15 7l4.5 3.5 1.5-4.5L12 3l-2.5 4.5L7.5 1l4.5-3.5L3.5 5.5l6 3.5L3.5 12.5l6 3.5L12 15l4.5-3.5L18.5 8.5l-4.5 5.5z"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">FTA</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Fault tree, minimal cut sets — IEC 61025 gate probability + MOCUS cut sets
                  </p>
                </article>

                {/* Reports Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <rect x="9" y="9" width="6" height="6"/>
                      <rect x="3" y="3" width="6" height="6"/>
                      <rect x="15" y="15" width="6" height="6"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">Reports</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Frozen snapshot packs — report = snapshot(revision, modules)
                  </p>
                </article>

                {/* Import Module Card */}
                <article
                  className="feature-card hover:translate-y-2 hover:border-[var(--accent)] transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] flex items-center justify-center mb-4 group-hover:border-[var(--accent-hi)] transition-colors">
                    <svg className="w-6 h-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <h3 className="section-h3 text-xl font-semibold text-[var(--text)] mb-2">Import</h3>
                  <p className="text-[var(--text-muted)] text-sm">
                    Excel/CSV hierarchy import with a downloadable template
                  </p>
                </article>
              </div>
            </div>
          </section>

          {/* Closing CTA */}
          <section className="closing-cta py-24 md:py-32 bg-[var(--navy-mid)]">
            <div className="max-w-[1600px] mx-auto px-4 text-center">
              <h2 className="closing-h2 text-5xl md:text-6xl lg:text-[clamp(52px,38vw,62px)] font-extrabold text-[var(--on-dark)] mb-6">
                Ready to analyze?
              </h2>
              <p className="closing-subtitle text-[var(--text-muted)] text-lg mb-8 max-w-2xl mx-auto">
                Join thousands of reliability engineers who trust Synapse for critical decision-making.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href="/login"
                  className="btn-primary px-8 py-4 text-lg font-medium"
                >
                  Start Free Analysis
                </a>
                <a
                  href="/settings"
                  className="btn-secondary px-8 py-4 text-lg font-medium"
                >
                  View Pricing
                </a>
              </div>
            </div>
          </section>

        </main>

        {/* Scroll-down indicator */}
        <div className="scroll-down fixed bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[var(--text-muted)]">
          <span className="text-xs uppercase tracking-widest">Scroll</span>
          <div className="w-6 h-6 border-2 border-[var(--accent)] rounded-full animate-bounce"></div>
        </div>

        {/* GSAP Scripts */}
        <script
          src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"
        ></script>
        <script
          src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"
        ></script>

        <script>{`
        // Prevent FOUC - set initial states first
        gsap.set([".eyebrow", "h1", ".subtitle", ".btn-primary", ".btn-secondary", ".scroll-down"], {
          opacity: 0,
          y: 30
        });

        // Hero entrance timeline
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.to(".eyebrow", { opacity: 1, y: 0, duration: 0.6 })
          .to("h1", { opacity: 1, y: 0, duration: 0.8 }, "-=0.3")
          .to(".subtitle", { opacity: 1, y: 0, duration: 0.6 }, "-=0.5")
          .to(".btn-primary, .btn-secondary", { opacity: 1, y: 0, duration: 0.5 }, "-=0.3")
          .to(".scroll-down", { opacity: 1, y: 0, duration: 0.4 }, "-=0.2");

        // Mouse parallax
        const hero = document.querySelector(".hero");
        if (hero) {
          hero.addEventListener("mousemove", (e) => {
            const x = (e.clientX / window.innerWidth - 0.5) * 2;
            const y = (e.clientY / window.innerHeight - 0.5) * 2;
            gsap.to(".hero-shapes-back", { x: x * 45, y: y * 22, duration: 0.8 });
            gsap.to(".hero-shapes-mid", { x: x * 22, y: y * 11, duration: 0.8 });
            gsap.to(".hero-container", { x: x * 8, y: y * 5, duration: 0.8 });
          });
        }

        // Feature cards scroll reveal
        gsap.set(".feature-card", { opacity: 0, y: 55, rotateX: 18 });

        ScrollTrigger.batch(".feature-card", {
          start: "top 80%",
          onEnter: batch => gsap.to(batch, {
            opacity: 1, y: 0, rotateX: 0,
            duration: 0.8,
            stagger: 0.11,
            ease: "power2.out"
          })
        });

        // Floating decorative shapes (CSS keyframes)
        // Already defined in CSS: animate-floatA, animate-floatB, animate-floatC

        `}</script>

      </body>
    </html>
  );
}