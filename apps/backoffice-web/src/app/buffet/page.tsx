import {
  BUFFET_PRODUCT_PROFILE,
  BUFFET_RESERVED_FIRST_STORE_CODE,
  BUFFET_STORE_CODE_PREFIX
} from "@/lib/buffet-profile";

const cards = [
  ["Product profile", BUFFET_PRODUCT_PROFILE],
  ["Store prefix", BUFFET_STORE_CODE_PREFIX],
  ["First reserved code", BUFFET_RESERVED_FIRST_STORE_CODE],
  ["Provisioning", "NOT ACTIVE"]
] as const;

export default function BuffetFoundationPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", padding: "48px 20px", color: "#0f172a" }}>
      <section style={{ width: "min(920px, 100%)", margin: "0 auto" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: 1.4, color: "#475569" }}>
          CPIPOS PRODUCT LINE
        </p>
        <h1 style={{ margin: "10px 0 8px", fontSize: 40, lineHeight: 1.1 }}>Buffet / FF0001 Foundation</h1>
        <p style={{ margin: 0, maxWidth: 720, fontSize: 17, lineHeight: 1.7, color: "#475569" }}>
          Isolated Buffet deployment foundation. This page confirms source separation only; FF0001 is not provisioned and no production store data is activated from this route.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 30 }}>
          {cards.map(([label, value]) => (
            <article key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: 18 }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>{label}</div>
              <div style={{ marginTop: 7, fontSize: 20, fontWeight: 800 }}>{value}</div>
            </article>
          ))}
        </div>

        <section style={{ marginTop: 26, border: "1px solid #e2e8f0", borderRadius: 18, background: "white", padding: 22 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Buffet domain baseline</h2>
          <p style={{ margin: "10px 0 0", lineHeight: 1.7, color: "#475569" }}>
            Guest count, package pricing, session timer, ordering rounds, last-order cutoff and extra-charge rules are the Buffet-specific domain boundary. Login, POS session, shifts, payment, printer, MDM and dual-screen runtime remain shared platform capabilities.
          </p>
        </section>
      </section>
    </main>
  );
}
