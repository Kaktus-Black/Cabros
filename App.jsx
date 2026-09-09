import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ---------------------------------------------------------------
   CABRO YARD — Production & Inventory Management
   Design language: site / concrete-yard industrial.
   Palette:
     concrete  #EAE6DD   (app background)
     surface   #FFFFFF   (cards)
     ink       #221F1B   (primary text)
     inkSoft   #6B655A   (secondary text)
     line      #DAD4C6   (hairlines)
     safety    #D9480F   (accent — safety-orange, primary actions)
     safetyDk  #B23B0C
     steel     #35506B   (secondary accent — structure, headers)
     good      #3E7A3E
     bad       #B3261E
   Type: system sans, heavy weights for numbers/headers (numbers are
   the hero of this app — pieces & m² need to read at a glance
   outdoors), regular weight for body/labels.
------------------------------------------------------------------*/

const COLORS = {
  concrete: "#EAE6DD",
  surface: "#FFFFFF",
  ink: "#221F1B",
  inkSoft: "#6B655A",
  inkFaint: "#9A9384",
  line: "#DDD7C8",
  safety: "#D9480F",
  safetyDk: "#B23B0C",
  safetyTint: "#FBE7DB",
  steel: "#35506B",
  steelTint: "#E4E9EE",
  good: "#3E7A3E",
  goodTint: "#E5EFDF",
  bad: "#B3261E",
  badTint: "#F8E4E1",
};

const MOVES = {
  produced: { label: "Produced", sign: 1, group: "in", icon: "▲" },
  returned: { label: "Returned", sign: 1, group: "in", icon: "↩" },
  sold: { label: "Sold", sign: -1, group: "out", icon: "▼" },
  broken: { label: "Broken", sign: -1, group: "out", icon: "✕" },
  lost: { label: "Lost", sign: -1, group: "out", icon: "?" },
  adjustment: { label: "Adjustment", sign: 1, group: "adj", icon: "≈" },
};

const EMOJI_CHOICES = ["🧱", "◆", "▲", "◼", "▬", "⬛", "⧫", "⬡", "▨", "▧"];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtM2(n) {
  if (n === null || n === undefined || isNaN(n)) return "0.00";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pcsToM2(pcs, ratio) {
  if (!ratio) return 0;
  return pcs / ratio;
}
function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function nowISO() {
  return new Date().toISOString();
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const DEFAULT_TYPES = [
  { id: "t_arrow", name: "Arrow", notes: "" },
  { id: "t_zigzag", name: "Zigzag", notes: "" },
  { id: "t_ishape", name: "I-Shape", notes: "" },
  { id: "t_square", name: "Square", notes: "" },
  { id: "t_rect", name: "Rectangular", notes: "" },
];
const DEFAULT_VARIANTS = [
  { id: "v1", typeId: "t_arrow", colorName: "Grey", colorHex: "#8A8578", piecesPerM2: 23, dims: "", unit: "pcs", notes: "", emoji: "🧱", photo: null },
  { id: "v2", typeId: "t_arrow", colorName: "Red", colorHex: "#A6493A", piecesPerM2: 23, dims: "", unit: "pcs", notes: "", emoji: "🧱", photo: null },
  { id: "v3", typeId: "t_zigzag", colorName: "Grey", colorHex: "#8A8578", piecesPerM2: 40, dims: "", unit: "pcs", notes: "", emoji: "◆", photo: null },
  { id: "v4", typeId: "t_square", colorName: "Charcoal", colorHex: "#3E3A34", piecesPerM2: 25, dims: "", unit: "pcs", notes: "", emoji: "◼", photo: null },
];

/* ---------------- storage helpers ----------------
   Standalone build: persists to the browser's localStorage, so data
   lives on the device/browser the app is opened in. The `shared`
   flag is kept as a no-op parameter for API compatibility with the
   Claude-artifact version (where it meant "visible to all users").
   To make stock genuinely shared across everyone on the site, swap
   these two functions for calls to a small backend (Supabase,
   Firebase, a simple REST API, etc.) — everything else in this file
   is unaffected since it only calls loadJSON/saveJSON. */
const STORAGE_PREFIX = "cabro-yard:";
async function loadJSON(key, shared, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
async function saveJSON(key, shared, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

/* ================================================================ */

export default function App() {
  const [ready, setReady] = useState(false);
  const [types, setTypes] = useState(DEFAULT_TYPES);
  const [variants, setVariants] = useState(DEFAULT_VARIANTS);
  const [txns, setTxns] = useState([]);
  const [counts, setCounts] = useState([]);
  const [session, setSession] = useState({ name: "", role: "worker" });
  const [screen, setScreen] = useState("dashboard");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      const [catalog, tx, cnts, sess] = await Promise.all([
        loadJSON("catalog", true, null),
        loadJSON("transactions", true, []),
        loadJSON("counts", true, []),
        loadJSON("session", false, null),
      ]);
      if (catalog) {
        setTypes(catalog.types || DEFAULT_TYPES);
        setVariants(catalog.variants || DEFAULT_VARIANTS);
      } else {
        await saveJSON("catalog", true, { types: DEFAULT_TYPES, variants: DEFAULT_VARIANTS });
      }
      setTxns(tx || []);
      setCounts(cnts || []);
      if (sess && sess.name) setSession(sess);
      setReady(true);
    })();
  }, []);

  const persistCatalog = useCallback(async (nextTypes, nextVariants) => {
    setTypes(nextTypes);
    setVariants(nextVariants);
    await saveJSON("catalog", true, { types: nextTypes, variants: nextVariants });
  }, []);

  const persistTxns = useCallback(async (next) => {
    setTxns(next);
    await saveJSON("transactions", true, next);
  }, []);

  const persistCounts = useCallback(async (next) => {
    setCounts(next);
    await saveJSON("counts", true, next);
  }, []);

  const persistSession = useCallback(async (next) => {
    setSession(next);
    await saveJSON("session", false, next);
  }, []);

  const showToast = useCallback((msg, tone = "good") => {
    setToast({ msg, tone, id: uid() });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2200);
  }, []);

  // ---- derived stock ----
  const stockByVariant = useMemo(() => {
    const map = {};
    for (const v of variants) map[v.id] = 0;
    for (const t of txns) {
      if (map[t.variantId] === undefined) map[t.variantId] = 0;
      map[t.variantId] += t.qty;
    }
    return map;
  }, [variants, txns]);

  const todayTotals = useMemo(() => {
    const key = todayKey();
    const t = { produced: 0, sold: 0, returned: 0, broken: 0, lost: 0 };
    for (const tx of txns) {
      if (tx.date.slice(0, 10) !== key) continue;
      if (t[tx.move] !== undefined) t[tx.move] += Math.abs(tx.qty);
    }
    return t;
  }, [txns]);

  const totalPieces = useMemo(() => Object.values(stockByVariant).reduce((a, b) => a + b, 0), [stockByVariant]);
  const totalM2 = useMemo(() => variants.reduce((sum, v) => sum + pcsToM2(stockByVariant[v.id] || 0, v.piecesPerM2), 0), [variants, stockByVariant]);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.concrete, fontFamily: FONT }}>
        <div style={{ color: COLORS.inkSoft, fontSize: 14, letterSpacing: 0.3 }}>Loading yard data…</div>
      </div>
    );
  }

  if (!session.name) {
    return <NameGate onSet={(s) => persistSession(s)} />;
  }

  const ctx = {
    types, variants, txns, counts, session, stockByVariant, todayTotals, totalPieces, totalM2,
    persistCatalog, persistTxns, persistCounts, persistSession, showToast,
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.concrete, fontFamily: FONT, color: COLORS.ink, paddingBottom: 84 }}>
      <TopBar session={session} onSwitchUser={() => persistSession({ name: "", role: "worker" })} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 14px" }}>
        {screen === "dashboard" && <Dashboard ctx={ctx} goTo={setScreen} />}
        {screen === "quick" && <QuickUpdate ctx={ctx} goTo={setScreen} />}
        {screen === "inventory" && <Inventory ctx={ctx} goTo={setScreen} />}
        {screen === "count" && <PhysicalCount ctx={ctx} />}
        {screen === "history" && <History ctx={ctx} />}
        {screen === "reports" && <Reports ctx={ctx} />}
        {screen === "settings" && <Settings ctx={ctx} />}
      </div>
      <BottomNav screen={screen} setScreen={setScreen} role={session.role} />
      {toast && <Toast toast={toast} />}
    </div>
  );
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/* ---------------- Name gate ---------------- */
function NameGate({ onSet }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("worker");
  return (
    <div style={{ minHeight: "100vh", background: COLORS.steel, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, padding: 20 }}>
      <div style={{ background: COLORS.surface, borderRadius: 18, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 13, letterSpacing: 1, color: COLORS.safety, fontWeight: 700, marginBottom: 4 }}>CABRO YARD</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.ink, marginBottom: 18 }}>Who's working the yard today?</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{ width: "100%", boxSizing: "border-box", padding: "14px 14px", fontSize: 17, borderRadius: 12, border: `2px solid ${COLORS.line}`, marginBottom: 14, fontFamily: FONT }}
        />
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[["worker", "Site Worker"], ["admin", "Admin"]].map(([val, label]) => (
            <button key={val} onClick={() => setRole(val)}
              style={{
                flex: 1, padding: "12px 8px", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer",
                border: role === val ? `2px solid ${COLORS.safety}` : `2px solid ${COLORS.line}`,
                background: role === val ? COLORS.safetyTint : "#fff", color: role === val ? COLORS.safetyDk : COLORS.inkSoft,
              }}>{label}</button>
          ))}
        </div>
        <button
          disabled={!name.trim()}
          onClick={() => onSet({ name: name.trim(), role })}
          style={{
            width: "100%", padding: "15px", borderRadius: 12, border: "none", fontSize: 16, fontWeight: 800,
            background: name.trim() ? COLORS.safety : COLORS.line, color: "#fff", cursor: name.trim() ? "pointer" : "default",
          }}>Enter yard</button>
      </div>
    </div>
  );
}

/* ---------------- Top bar ---------------- */
function TopBar({ session, onSwitchUser }) {
  return (
    <div style={{ background: COLORS.steel, color: "#fff", padding: "14px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.7, fontWeight: 700 }}>CABRO YARD</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Production & Inventory</div>
        </div>
        <button onClick={onSwitchUser} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", borderRadius: 20, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: session.role === "admin" ? COLORS.safety : "#7FB88F", display: "inline-block" }} />
          {session.name}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Bottom nav ---------------- */
function BottomNav({ screen, setScreen, role }) {
  const items = [
    ["dashboard", "Overview", "⌂"],
    ["quick", "Update", "+"],
    ["inventory", "Stock", "▦"],
    ["history", "History", "≡"],
    ["reports", "Reports", "▤"],
  ];
  if (role === "admin") items.push(["settings", "Settings", "⚙"]);
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: COLORS.surface, borderTop: `1px solid ${COLORS.line}`, boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex" }}>
        {items.map(([key, label, icon]) => (
          <button key={key} onClick={() => setScreen(key)}
            style={{
              flex: 1, background: "none", border: "none", padding: "9px 2px 10px", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
              color: screen === key ? COLORS.safety : COLORS.inkFaint,
            }}>
            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: screen === key ? 800 : 600 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Toast({ toast }) {
  const bg = toast.tone === "bad" ? COLORS.bad : toast.tone === "steel" ? COLORS.steel : COLORS.good;
  return (
    <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", background: bg, color: "#fff", padding: "11px 20px", borderRadius: 30, fontSize: 13.5, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 50, whiteSpace: "nowrap" }}>
      {toast.msg}
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function Photo({ variant, size = 34 }) {
  const style = { width: size, height: size, borderRadius: size * 0.28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.52, background: variant.colorHex ? variant.colorHex + "22" : COLORS.steelTint, border: `1px solid ${COLORS.line}`, overflow: "hidden" };
  if (variant.photo) {
    return <div style={style}><img src={variant.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
  }
  return <div style={style}>{variant.emoji || "🧱"}</div>;
}

function typeName(types, id) {
  return types.find((t) => t.id === id)?.name || "—";
}

function Section({ title, sub, children, action }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginTop: 1 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: COLORS.surface, borderRadius: 16, border: `1px solid ${COLORS.line}`, padding: 14, ...style }}>{children}</div>;
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ ctx, goTo }) {
  const { types, variants, stockByVariant, todayTotals, totalPieces, totalM2 } = ctx;
  const rows = variants.map((v) => ({ v, pcs: stockByVariant[v.id] || 0, m2: pcsToM2(stockByVariant[v.id] || 0, v.piecesPerM2) }))
    .sort((a, b) => b.pcs - a.pcs);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <HeroStat label="Total pieces in stock" value={fmt(totalPieces)} unit="pcs" tone="safety" />
        <HeroStat label="Total area available" value={fmtM2(totalM2)} unit="m²" tone="steel" />
      </div>

      <Section title="Today at the yard">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <MiniStat label="Produced" value={todayTotals.produced} tone="good" />
          <MiniStat label="Sold" value={todayTotals.sold} tone="steel" />
          <MiniStat label="Returned" value={todayTotals.returned} tone="steel" />
          <MiniStat label="Broken" value={todayTotals.broken} tone="bad" />
          <MiniStat label="Lost" value={todayTotals.lost} tone="bad" />
          <button onClick={() => goTo("quick")} style={{ borderRadius: 12, border: `2px dashed ${COLORS.safety}`, background: COLORS.safetyTint, color: COLORS.safetyDk, fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>+ Record</button>
        </div>
      </Section>

      <Section title="Stock by cabro & colour" sub={`${rows.length} variants`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.slice(0, 8).map(({ v, pcs, m2 }) => (
            <Card key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
              <Photo variant={v} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{typeName(types, v.typeId)} — {v.colorName}</div>
                <div style={{ fontSize: 11.5, color: COLORS.inkSoft }}>{v.piecesPerM2} pcs/m²</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(pcs)} <span style={{ fontWeight: 600, fontSize: 11, color: COLORS.inkSoft }}>pcs</span></div>
                <div style={{ fontSize: 12, color: COLORS.inkSoft }}>{fmtM2(m2)} m²</div>
              </div>
            </Card>
          ))}
          {rows.length > 8 && (
            <button onClick={() => goTo("inventory")} style={{ background: "none", border: "none", color: COLORS.steel, fontWeight: 700, fontSize: 13, padding: 8, cursor: "pointer" }}>View all {rows.length} variants →</button>
          )}
        </div>
      </Section>
    </div>
  );
}

function HeroStat({ label, value, unit, tone }) {
  const bg = tone === "safety" ? COLORS.safety : COLORS.steel;
  return (
    <div style={{ background: bg, borderRadius: 18, padding: "16px 16px", color: "#fff" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.85, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3, fontWeight: 700 }}>{unit}</div>
    </div>
  );
}
function MiniStat({ label, value, tone }) {
  const map = { good: [COLORS.goodTint, COLORS.good], bad: [COLORS.badTint, COLORS.bad], steel: [COLORS.steelTint, COLORS.steel] };
  const [bg, fg] = map[tone];
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "10px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: fg }}>{fmt(value)}</div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: fg, opacity: 0.85, marginTop: 1 }}>{label}</div>
    </div>
  );
}

/* ---------------- Quick Update ---------------- */
function QuickUpdate({ ctx, goTo }) {
  const { types, variants, txns, persistTxns, stockByVariant, session, showToast } = ctx;
  const [typeId, setTypeId] = useState(variants[0]?.typeId || "");
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const [move, setMove] = useState("produced");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const variantsForType = variants.filter((v) => v.typeId === typeId);
  const variant = variants.find((v) => v.id === variantId);
  const stock = variant ? stockByVariant[variant.id] || 0 : 0;
  const qtyNum = Number(qty) || 0;
  const LARGE = 2000;

  useEffect(() => {
    const first = variants.find((v) => v.typeId === typeId);
    if (first && !variantsForType.find((v) => v.id === variantId)) setVariantId(first.id);
  }, [typeId]); // eslint-disable-line

  const doSave = async () => {
    if (!variant || qtyNum <= 0) return;
    const sign = MOVES[move].sign;
    const signedQty = sign * qtyNum;
    if (MOVES[move].group === "out" && stock + signedQty < 0) {
      showToast(`Not enough stock — only ${fmt(stock)} pcs available`, "bad");
      return;
    }
    const tx = { id: uid(), variantId: variant.id, move, qty: signedQty, date: nowISO(), user: session.name, note: note.trim() };
    await persistTxns([tx, ...txns]);
    showToast(`${MOVES[move].label}: ${sign > 0 ? "+" : "-"}${fmt(qtyNum)} pcs saved`, MOVES[move].group === "out" ? "steel" : "good");
    setQty("");
    setNote("");
    setConfirming(false);
  };

  const onRecord = () => {
    if (!variant || qtyNum <= 0) return;
    if (qtyNum >= LARGE) {
      setConfirming(true);
      return;
    }
    doSave();
  };

  return (
    <div>
      <Section title="Quick stock update" sub="Cabro → Colour → Movement → Quantity"
        action={<button onClick={() => goTo("count")} style={{ background: COLORS.steelTint, border: "none", color: COLORS.steel, borderRadius: 10, padding: "7px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Physical count →</button>}>
        <Card>
          <FieldLabel>Cabro type</FieldLabel>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
            {types.map((t) => (
              <Chip key={t.id} active={t.id === typeId} onClick={() => setTypeId(t.id)}>{t.name}</Chip>
            ))}
          </div>

          <FieldLabel>Colour</FieldLabel>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
            {variantsForType.map((v) => (
              <button key={v.id} onClick={() => setVariantId(v.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "7px 12px 7px 7px", borderRadius: 99, whiteSpace: "nowrap",
                  border: v.id === variantId ? `2px solid ${COLORS.safety}` : `2px solid ${COLORS.line}`,
                  background: v.id === variantId ? COLORS.safetyTint : "#fff", cursor: "pointer",
                }}>
                <Photo variant={v} size={24} />
                <span style={{ fontWeight: 700, fontSize: 13, color: v.id === variantId ? COLORS.safetyDk : COLORS.ink }}>{v.colorName}</span>
              </button>
            ))}
          </div>

          {variant && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.concrete, borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, color: COLORS.inkSoft, fontWeight: 600 }}>Current stock</div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(stock)} pcs <span style={{ color: COLORS.inkSoft, fontWeight: 600, fontSize: 12.5 }}>· {fmtM2(pcsToM2(stock, variant.piecesPerM2))} m²</span></div>
            </div>
          )}

          <FieldLabel>Movement</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
            {Object.entries(MOVES).filter(([k]) => k !== "adjustment").map(([key, m]) => (
              <button key={key} onClick={() => setMove(key)}
                style={{
                  padding: "10px 2px", borderRadius: 12, textAlign: "center", cursor: "pointer",
                  border: move === key ? `2px solid ${m.group === "out" ? COLORS.bad : COLORS.good}` : `2px solid ${COLORS.line}`,
                  background: move === key ? (m.group === "out" ? COLORS.badTint : COLORS.goodTint) : "#fff",
                  color: move === key ? (m.group === "out" ? COLORS.bad : COLORS.good) : COLORS.inkSoft,
                }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{m.icon}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 2 }}>{m.label}</div>
              </button>
            ))}
          </div>

          <FieldLabel>Quantity (pieces)</FieldLabel>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input
              type="number" inputMode="numeric" min="0" value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{ flex: 1, fontSize: 26, fontWeight: 800, padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.line}`, fontFamily: FONT, width: 0 }}
            />
            {[50, 100, 500].map((n) => (
              <button key={n} onClick={() => setQty(String((Number(qty) || 0) + n))}
                style={{ padding: "0 12px", borderRadius: 12, border: `2px solid ${COLORS.line}`, background: "#fff", fontWeight: 800, fontSize: 13, color: COLORS.steel, cursor: "pointer" }}>+{n}</button>
            ))}
          </div>
          {variant && qtyNum > 0 && (
            <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 14 }}>≈ {fmtM2(pcsToM2(qtyNum, variant.piecesPerM2))} m²</div>
          )}

          <FieldLabel>Note (optional)</FieldLabel>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer name, batch #"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${COLORS.line}`, fontSize: 13.5, fontFamily: FONT, marginBottom: 16 }} />

          {!confirming ? (
            <button onClick={onRecord} disabled={!variant || qtyNum <= 0}
              style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", fontSize: 16, fontWeight: 800, cursor: qtyNum > 0 ? "pointer" : "default", background: qtyNum > 0 ? COLORS.safety : COLORS.line, color: "#fff" }}>
              Save {MOVES[move].label.toLowerCase()}
            </button>
          ) : (
            <div style={{ background: COLORS.badTint, borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: COLORS.bad, marginBottom: 10 }}>Confirm large adjustment of {fmt(qtyNum)} pcs?</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setConfirming(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, background: "#fff", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                <button onClick={doSave} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: COLORS.bad, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Confirm</button>
              </div>
            </div>
          )}
        </Card>
      </Section>
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.inkSoft, marginBottom: 7 }}>{children}</div>;
}
function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 99, whiteSpace: "nowrap", fontWeight: 700, fontSize: 13, cursor: "pointer",
      border: active ? `2px solid ${COLORS.steel}` : `2px solid ${COLORS.line}`,
      background: active ? COLORS.steel : "#fff", color: active ? "#fff" : COLORS.inkSoft,
    }}>{children}</button>
  );
}

/* ---------------- Inventory ---------------- */
function Inventory({ ctx, goTo }) {
  const { types, variants, stockByVariant } = ctx;
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");

  const rows = variants.map((v) => ({ v, pcs: stockByVariant[v.id] || 0, m2: pcsToM2(stockByVariant[v.id] || 0, v.piecesPerM2) }))
    .filter(({ v }) => typeFilter === "all" || v.typeId === typeFilter)
    .filter(({ v, pcs }) => {
      if (!q.trim()) return true;
      const hay = `${typeName(types, v.typeId)} ${v.colorName}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    })
    .filter(({ pcs }) => {
      if (levelFilter === "low") return pcs > 0 && pcs < 200;
      if (levelFilter === "out") return pcs <= 0;
      if (levelFilter === "instock") return pcs > 0;
      return true;
    })
    .sort((a, b) => typeName(types, a.v.typeId).localeCompare(typeName(types, b.v.typeId)) || a.v.colorName.localeCompare(b.v.colorName));

  return (
    <div>
      <Section title="Cabro inventory" sub={`${rows.length} of ${variants.length} variants`}
        action={<button onClick={() => goTo("count")} style={{ background: COLORS.steelTint, border: "none", color: COLORS.steel, borderRadius: 10, padding: "7px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Count →</button>}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. \"Arrow Grey\""
          style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.line}`, fontSize: 14.5, fontFamily: FONT, marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 6 }}>
          <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>All types</Chip>
          {types.map((t) => <Chip key={t.id} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)}>{t.name}</Chip>)}
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
          {[["all", "Any level"], ["instock", "In stock"], ["low", "Low (<200)"], ["out", "Out of stock"]].map(([k, l]) => (
            <Chip key={k} active={levelFilter === k} onClick={() => setLevelFilter(k)}>{l}</Chip>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(({ v, pcs, m2 }) => (
            <Card key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
              <Photo variant={v} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{typeName(types, v.typeId)}</div>
                <div style={{ fontSize: 12.5, color: COLORS.inkSoft, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: v.colorHex, display: "inline-block", border: `1px solid ${COLORS.line}` }} />
                  {v.colorName} · {v.piecesPerM2} pcs/m²
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: pcs <= 0 ? COLORS.bad : pcs < 200 ? COLORS.safetyDk : COLORS.ink }}>{fmt(pcs)}</div>
                <div style={{ fontSize: 11.5, color: COLORS.inkSoft }}>{fmtM2(m2)} m²</div>
              </div>
            </Card>
          ))}
          {rows.length === 0 && <EmptyState text="No variants match your filters." />}
        </div>
      </Section>
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={{ textAlign: "center", color: COLORS.inkFaint, fontSize: 13.5, padding: "26px 10px" }}>{text}</div>;
}

/* ---------------- Physical Count ---------------- */
function PhysicalCount({ ctx }) {
  const { types, variants, stockByVariant, txns, persistTxns, counts, persistCounts, session, showToast } = ctx;
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const [physical, setPhysical] = useState("");
  const [note, setNote] = useState("");
  const variant = variants.find((v) => v.id === variantId);
  const system = variant ? stockByVariant[variant.id] || 0 : 0;
  const physNum = physical === "" ? null : Number(physical);
  const diff = physNum === null ? null : physNum - system;

  const save = async () => {
    if (!variant || physNum === null || physNum < 0) return;
    const rec = { id: uid(), variantId: variant.id, date: nowISO(), systemCount: system, physicalCount: physNum, difference: diff, user: session.name, note: note.trim() };
    await persistCounts([rec, ...counts]);
    if (diff !== 0) {
      const tx = { id: uid(), variantId: variant.id, move: "adjustment", qty: diff, date: nowISO(), user: session.name, note: `Physical count adjustment${note ? ": " + note.trim() : ""}` };
      await persistTxns([tx, ...txns]);
    }
    showToast(diff === 0 ? "Count matches system — no adjustment needed" : `Adjustment of ${diff > 0 ? "+" : ""}${fmt(diff)} pcs recorded`, "steel");
    setPhysical("");
    setNote("");
  };

  const recentForVariant = counts.filter((c) => c.variantId === variantId).slice(0, 6);

  return (
    <div>
      <Section title="Update physical count" sub="Reconcile the yard's physical stock against the system">
        <Card>
          <FieldLabel>Cabro & colour</FieldLabel>
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.line}`, fontSize: 14.5, fontFamily: FONT, marginBottom: 14, background: "#fff" }}>
            {variants.map((v) => <option key={v.id} value={v.id}>{typeName(types, v.typeId)} — {v.colorName}</option>)}
          </select>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: COLORS.concrete, borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: COLORS.inkSoft, fontWeight: 600 }}>System stock</div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(system)} pcs</div>
          </div>

          <FieldLabel>Physical count (counted on site)</FieldLabel>
          <input type="number" inputMode="numeric" min="0" value={physical} onChange={(e) => setPhysical(e.target.value)} placeholder="0"
            style={{ width: "100%", boxSizing: "border-box", fontSize: 26, fontWeight: 800, padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.line}`, fontFamily: FONT, marginBottom: 14 }} />

          {physNum !== null && variant && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <div style={{ background: diff === 0 ? COLORS.goodTint : diff > 0 ? COLORS.steelTint : COLORS.badTint, borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.inkSoft }}>Difference</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: diff === 0 ? COLORS.good : diff > 0 ? COLORS.steel : COLORS.bad }}>{diff > 0 ? "+" : ""}{fmt(diff)} pcs</div>
              </div>
              <div style={{ background: COLORS.concrete, borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.inkSoft }}>In m²</div>
                <div style={{ fontSize: 19, fontWeight: 800 }}>{diff > 0 ? "+" : ""}{fmtM2(pcsToM2(diff, variant.piecesPerM2))}</div>
              </div>
            </div>
          )}

          <FieldLabel>Note (optional)</FieldLabel>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. reason for shortfall"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${COLORS.line}`, fontSize: 13.5, fontFamily: FONT, marginBottom: 16 }} />

          <button onClick={save} disabled={physNum === null || physNum < 0}
            style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", fontSize: 16, fontWeight: 800, cursor: physNum !== null ? "pointer" : "default", background: physNum !== null ? COLORS.steel : COLORS.line, color: "#fff" }}>
            Save physical count
          </button>
        </Card>
      </Section>

      <Section title="Recent counts for this variant">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recentForVariant.map((c) => (
            <Card key={c.id} style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 4 }}>
                <span>{fmtDateTime(c.date)}</span><span>{c.user}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 700 }}>
                <span>Sys {fmt(c.systemCount)} → Phys {fmt(c.physicalCount)}</span>
                <span style={{ color: c.difference === 0 ? COLORS.good : c.difference > 0 ? COLORS.steel : COLORS.bad }}>{c.difference > 0 ? "+" : ""}{fmt(c.difference)}</span>
              </div>
              {c.note && <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 4 }}>{c.note}</div>}
            </Card>
          ))}
          {recentForVariant.length === 0 && <EmptyState text="No physical counts recorded yet for this variant." />}
        </div>
      </Section>
    </div>
  );
}

/* ---------------- History ---------------- */
function History({ ctx }) {
  const { types, variants, txns } = ctx;
  const [q, setQ] = useState("");
  const [moveFilter, setMoveFilter] = useState("all");

  const rows = txns
    .filter((t) => moveFilter === "all" || t.move === moveFilter)
    .filter((t) => {
      if (!q.trim()) return true;
      const v = variants.find((v) => v.id === t.variantId);
      const hay = `${v ? typeName(types, v.typeId) : ""} ${v?.colorName || ""} ${t.user} ${t.note || ""}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });

  return (
    <div>
      <Section title="Transaction history" sub={`${rows.length} records`}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by cabro, colour, user, note"
          style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12, border: `2px solid ${COLORS.line}`, fontSize: 14.5, fontFamily: FONT, marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
          <Chip active={moveFilter === "all"} onClick={() => setMoveFilter("all")}>All</Chip>
          {Object.entries(MOVES).map(([k, m]) => <Chip key={k} active={moveFilter === k} onClick={() => setMoveFilter(k)}>{m.label}</Chip>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.slice(0, 150).map((t) => {
            const v = variants.find((vv) => vv.id === t.variantId);
            const m = MOVES[t.move];
            return (
              <Card key={t.id} style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {v && <Photo variant={v} size={30} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{v ? `${typeName(types, v.typeId)} — ${v.colorName}` : "Unknown variant"}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.inkSoft }}>{fmtDateTime(t.date)} · {t.user}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: t.qty > 0 ? COLORS.good : COLORS.bad }}>{t.qty > 0 ? "+" : ""}{fmt(t.qty)}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.inkSoft }}>{m?.label || t.move}</div>
                  </div>
                </div>
                {t.note && <div style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 6, paddingLeft: 40 }}>{t.note}</div>}
              </Card>
            );
          })}
          {rows.length === 0 && <EmptyState text="No transactions match." />}
        </div>
      </Section>
    </div>
  );
}

/* ---------------- Reports ---------------- */
function rangeFor(period) {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);
  if (period === "today") { start.setHours(0, 0, 0, 0); }
  else if (period === "yesterday") { start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999); }
  else if (period === "week") { start.setDate(start.getDate() - 7); }
  else if (period === "month") { start.setDate(start.getDate() - 30); }
  return { start, end };
}

function Reports({ ctx }) {
  const { types, variants, txns, counts } = ctx;
  const [period, setPeriod] = useState("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { start, end } = useMemo(() => {
    if (period === "custom" && customStart && customEnd) {
      return { start: new Date(customStart + "T00:00:00"), end: new Date(customEnd + "T23:59:59") };
    }
    return rangeFor(period);
  }, [period, customStart, customEnd]);

  const inRange = txns.filter((t) => { const d = new Date(t.date); return d >= start && d <= end; });
  const totals = { produced: 0, returned: 0, sold: 0, broken: 0, lost: 0, adjustment: 0 };
  for (const t of inRange) totals[t.move] = (totals[t.move] || 0) + Math.abs(t.qty);

  const byType = {};
  for (const v of variants) {
    const typeLabel = typeName(types, v.typeId);
    if (!byType[typeLabel]) byType[typeLabel] = 0;
  }
  for (const t of inRange) {
    const v = variants.find((vv) => vv.id === t.variantId);
    if (!v) continue;
    const label = typeName(types, v.typeId);
    byType[label] = (byType[label] || 0) + t.qty;
  }

  const countsInRange = counts.filter((c) => { const d = new Date(c.date); return d >= start && d <= end; });

  const exportCSV = () => {
    const lines = ["Date,Time,Cabro Type,Colour,Movement,Quantity,Equivalent m2,User,Note"];
    inRange.forEach((t) => {
      const v = variants.find((vv) => vv.id === t.variantId);
      const d = new Date(t.date);
      lines.push([
        d.toLocaleDateString(), d.toLocaleTimeString(),
        v ? typeName(types, v.typeId) : "", v ? v.colorName : "",
        MOVES[t.move]?.label || t.move, t.qty,
        v ? pcsToM2(t.qty, v.piecesPerM2).toFixed(2) : "",
        t.user, (t.note || "").replace(/,/g, ";"),
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cabro-report-${todayKey()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Section title="Reports">
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 10 }}>
          {[["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"], ["custom", "Custom"]].map(([k, l]) => (
            <Chip key={k} active={period === k} onClick={() => setPeriod(k)}>{l}</Chip>
          ))}
        </div>
        {period === "custom" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, fontFamily: FONT }} />
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, fontFamily: FONT }} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
          <MiniStat label="Produced" value={totals.produced} tone="good" />
          <MiniStat label="Sold" value={totals.sold} tone="steel" />
          <MiniStat label="Returned" value={totals.returned} tone="steel" />
          <MiniStat label="Broken" value={totals.broken} tone="bad" />
          <MiniStat label="Lost" value={totals.lost} tone="bad" />
          <MiniStat label="Adjustments" value={totals.adjustment} tone="steel" />
        </div>

        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>Net change by cabro type</div>
          {Object.entries(byType).map(([label, val]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${COLORS.line}`, fontSize: 13.5 }}>
              <span>{label}</span>
              <span style={{ fontWeight: 800, color: val >= 0 ? COLORS.good : COLORS.bad }}>{val >= 0 ? "+" : ""}{fmt(val)} pcs</span>
            </div>
          ))}
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>Physical count differences</div>
          {countsInRange.length === 0 && <div style={{ fontSize: 13, color: COLORS.inkFaint }}>No counts in this period.</div>}
          {countsInRange.map((c) => {
            const v = variants.find((vv) => vv.id === c.variantId);
            return (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${COLORS.line}`, fontSize: 13 }}>
                <span>{v ? `${typeName(types, v.typeId)} — ${v.colorName}` : "—"}</span>
                <span style={{ fontWeight: 700, color: c.difference === 0 ? COLORS.good : c.difference > 0 ? COLORS.steel : COLORS.bad }}>{c.difference > 0 ? "+" : ""}{fmt(c.difference)}</span>
              </div>
            );
          })}
        </Card>

        <button onClick={exportCSV} style={{ width: "100%", padding: 14, borderRadius: 12, border: `2px solid ${COLORS.steel}`, background: "#fff", color: COLORS.steel, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
          Export period as CSV
        </button>
      </Section>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function Settings({ ctx }) {
  const { types, variants, persistCatalog, showToast, session } = ctx;
  const [tab, setTab] = useState("types");

  if (session.role !== "admin") {
    return <div style={{ padding: "40px 10px", textAlign: "center", color: COLORS.inkSoft }}>Settings are restricted to admins.</div>;
  }

  return (
    <div>
      <Section title="Admin settings">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Chip active={tab === "types"} onClick={() => setTab("types")}>Cabro types & colours</Chip>
          <Chip active={tab === "users"} onClick={() => setTab("users")}>Users</Chip>
        </div>
        {tab === "types" && <TypesAdmin types={types} variants={variants} persistCatalog={persistCatalog} showToast={showToast} />}
        {tab === "users" && <UsersInfo />}
      </Section>
    </div>
  );
}

function UsersInfo() {
  return (
    <Card>
      <div style={{ fontSize: 13.5, color: COLORS.inkSoft, lineHeight: 1.6 }}>
        Anyone who enters the yard chooses a name and a role on their own device. <b>Admins</b> can manage cabro types, colours, and conversion ratios, and see everything workers see. <b>Site workers</b> can record production, returns, sales, breakages, losses, and physical counts, and view current stock and history — but cannot edit the catalog.
      </div>
    </Card>
  );
}

function TypesAdmin({ types, variants, persistCatalog, showToast }) {
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [editingVariant, setEditingVariant] = useState(null); // variant object or "new"
  const [newVariantTypeId, setNewVariantTypeId] = useState(types[0]?.id || "");

  const addType = async () => {
    if (!newTypeName.trim()) return;
    const t = { id: uid(), name: newTypeName.trim(), notes: "" };
    await persistCatalog([...types, t], variants);
    setNewTypeName(""); setAddingType(false);
    showToast(`Added cabro type "${t.name}"`, "good");
  };

  const deleteType = async (id) => {
    if (variants.some((v) => v.typeId === id)) {
      showToast("Remove its colour variants first", "bad");
      return;
    }
    await persistCatalog(types.filter((t) => t.id !== id), variants);
    showToast("Cabro type deleted", "steel");
  };

  const saveVariant = async (variant) => {
    const exists = variants.some((v) => v.id === variant.id);
    const next = exists ? variants.map((v) => (v.id === variant.id ? variant : v)) : [...variants, variant];
    await persistCatalog(types, next);
    setEditingVariant(null);
    showToast("Variant saved", "good");
  };

  const deleteVariant = async (id) => {
    await persistCatalog(types, variants.filter((v) => v.id !== id));
    showToast("Variant deleted", "steel");
  };

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {types.map((t) => (
          <Card key={t.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{t.name}</div>
              <button onClick={() => deleteType(t.id)} style={{ background: "none", border: "none", color: COLORS.bad, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete type</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {variants.filter((v) => v.typeId === t.id).map((v) => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, background: COLORS.concrete, borderRadius: 10, padding: "8px 10px" }}>
                  <Photo variant={v} size={30} />
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{v.colorName} <span style={{ fontWeight: 500, color: COLORS.inkSoft }}>· {v.piecesPerM2} pcs/m²</span></div>
                  <button onClick={() => setEditingVariant(v)} style={{ background: "none", border: "none", color: COLORS.steel, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => deleteVariant(v.id)} style={{ background: "none", border: "none", color: COLORS.bad, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✕</button>
                </div>
              ))}
              <button onClick={() => { setNewVariantTypeId(t.id); setEditingVariant("new"); }}
                style={{ padding: "9px", borderRadius: 10, border: `2px dashed ${COLORS.line}`, background: "none", color: COLORS.inkSoft, fontWeight: 700, fontSize: 12.5, cursor: "pointer", marginTop: 2 }}>
                + Add colour variant
              </button>
            </div>
          </Card>
        ))}
      </div>

      {!addingType ? (
        <button onClick={() => setAddingType(true)} style={{ width: "100%", padding: 13, borderRadius: 12, border: `2px dashed ${COLORS.safety}`, background: COLORS.safetyTint, color: COLORS.safetyDk, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>+ Add cabro type</button>
      ) : (
        <Card style={{ display: "flex", gap: 8 }}>
          <input autoFocus value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="e.g. Hexagon" style={{ flex: 1, padding: 10, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, fontFamily: FONT }} />
          <button onClick={addType} style={{ padding: "0 16px", borderRadius: 10, border: "none", background: COLORS.safety, color: "#fff", fontWeight: 800, cursor: "pointer" }}>Add</button>
        </Card>
      )}

      {editingVariant && (
        <VariantEditor
          variant={editingVariant === "new" ? { id: uid(), typeId: newVariantTypeId, colorName: "", colorHex: "#8A8578", piecesPerM2: 25, dims: "", unit: "pcs", notes: "", emoji: "🧱", photo: null } : editingVariant}
          types={types}
          onCancel={() => setEditingVariant(null)}
          onSave={saveVariant}
        />
      )}
    </div>
  );
}

function VariantEditor({ variant, types, onCancel, onSave }) {
  const [v, setV] = useState(variant);
  const fileRef = useRef(null);

  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setV({ ...v, photo: reader.result });
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,31,27,0.55)", display: "flex", alignItems: "flex-end", zIndex: 60 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxHeight: "88vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: 20, boxSizing: "border-box" }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>{variant.colorName ? "Edit variant" : "New colour variant"}</div>

        <FieldLabel>Cabro type</FieldLabel>
        <select value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 14, fontFamily: FONT }}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <Photo variant={v} size={54} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {EMOJI_CHOICES.map((em) => (
                <button key={em} onClick={() => setV({ ...v, emoji: em, photo: null })} style={{ width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${v.emoji === em && !v.photo ? COLORS.safety : COLORS.line}`, background: "#fff", cursor: "pointer" }}>{em}</button>
              ))}
            </div>
            <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.steel, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }}>Upload photo instead</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPhoto} style={{ display: "none" }} />
          </div>
        </div>

        <FieldLabel>Colour name</FieldLabel>
        <input value={v.colorName} onChange={(e) => setV({ ...v, colorName: e.target.value })} placeholder="e.g. Grey" style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 14, fontFamily: FONT }} />

        <FieldLabel>Swatch colour</FieldLabel>
        <input type="color" value={v.colorHex} onChange={(e) => setV({ ...v, colorHex: e.target.value })} style={{ width: "100%", height: 42, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 14, padding: 3 }} />

        <FieldLabel>Pieces per m² (conversion ratio)</FieldLabel>
        <input type="number" min="1" value={v.piecesPerM2} onChange={(e) => setV({ ...v, piecesPerM2: Number(e.target.value) })} style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 14, fontFamily: FONT, fontWeight: 800, fontSize: 16 }} />

        <FieldLabel>Dimensions (optional)</FieldLabel>
        <input value={v.dims} onChange={(e) => setV({ ...v, dims: e.target.value })} placeholder="e.g. 22 x 11 x 6 cm" style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 14, fontFamily: FONT }} />

        <FieldLabel>Notes (optional)</FieldLabel>
        <input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: `1.5px solid ${COLORS.line}`, marginBottom: 18, fontFamily: FONT }} />

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 14, borderRadius: 12, border: `1.5px solid ${COLORS.line}`, background: "#fff", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => v.colorName.trim() && v.piecesPerM2 > 0 && onSave(v)} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", background: COLORS.safety, color: "#fff", fontWeight: 800, cursor: "pointer" }}>Save variant</button>
        </div>
      </div>
    </div>
  );
}
