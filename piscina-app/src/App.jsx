IyRKeb0HGsb*2PiT2E#&*&VIimport React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase.js";

// Preferenze personali del dispositivo (durata slot, preset corsie) → restano locali.
// Le PRENOTAZIONI invece vivono nel database condiviso Supabase.
const storage = {
  async get(key) {
    try { const v = localStorage.getItem(key); return v == null ? null : { value: v }; }
    catch (_) { return null; }
  },
  async set(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  },
};

// Password dei due livelli di accesso
const PWD_ADMIN = "Cappuccinimaster";
const PWD_STAFF = "Cappuccinislave";

// ─────────────────────────────────────────────────────────────
// Piscina Cappuccini — gestione corsie
// 8 corsie · 09:00–21:00 · durata slot regolabile (10'→60')
// viste giorno / settimana / mese
// ─────────────────────────────────────────────────────────────

const CORSIE = [1, 2, 3, 4, 5, 6, 7, 8];

const APERTURA = 9 * 60;   // 09:00 in minuti
const CHIUSURA = 21 * 60;  // 21:00 in minuti

// Durate selezionabili (minuti)
const DURATE = [10, 15, 20, 30, 60, 90, 100, 110];

// Etichetta leggibile per una durata in minuti
function durataLabel(min) {
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + " ora" + (h > 1 ? "e" : "") : h + "h" + String(m).padStart(2, "0");
}

// Genera le fasce da APERTURA a CHIUSURA con passo = durata
function generaFasce(durata) {
  const out = [];
  for (let m = APERTURA; m < CHIUSURA; m += durata) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    out.push(h + ":" + mm);
  }
  return out;
}

// "hh:mm" -> minuti dalla mezzanotte
function hhmmToMin(s) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
// Restituisce le fasce (della griglia data) coperte da [inizio, fine)
// Una fascia è coperta se il suo intervallo [start, start+durata) si sovrappone a [inizio, fine)
function fasceCoperte(inizioMin, fineMin, durata, fasce) {
  return fasce.filter((f) => {
    const s = hhmmToMin(f);
    const e = s + durata;
    return s < fineMin && e > inizioMin;   // sovrapposizione
  });
}

const TIPI = {
  libero:   { label: "Nuoto libero",  bg: "#1E6E8C", ink: "#EAF6FA" },
  corso:    { label: "Corso",         bg: "#C7511F", ink: "#FCEDE4" },
  agonismo: { label: "Agonismo",      bg: "#3B5E22", ink: "#EDF4E4" },
  paralimp: { label: "Paralimpico",   bg: "#0F5C63", ink: "#E4F3F4" },
  pallanuoto: { label: "Pallanuoto",  bg: "#A8322D", ink: "#F9E7E5" },
  scuola:   { label: "Scuola nuoto",  bg: "#8A5A00", ink: "#F9EFDD" },
  acquagym: { label: "Acquagym",      bg: "#6A3D9A", ink: "#F0E9F7" },
  evento:   { label: "Evento",        bg: "#B8860B", ink: "#FBF3DC" },
  privato:  { label: "Cliente privato", bg: "#1D6F42", ink: "#E5F3EB" },
  convenzione: { label: "Convenzione", bg: "#2A5D8F", ink: "#E4EFF8" },
  manutenz: { label: "Manutenzione",  bg: "#4A4A55", ink: "#E8E8EE" },
};

const GIORNI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

const PREF_KEY  = "preferenze:v1";       // durata slot scelta (locale)
const PRESET_KEY = "presetCorsie:v1";    // combinazioni di corsie salvate

// ── Utility date ──────────────────────────────────────────────
const iso = (d) => {
  const x = new Date(d); x.setHours(12, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};
const oggi = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfWeek = (d) => { const x = new Date(d); const g = (x.getDay()+6)%7; return addDays(x, -g); };
const sameISO = (a, b) => iso(a) === iso(b);
const giornoLbl = (d) => GIORNI[(d.getDay()+6)%7];

function keyOf(dateIso, fascia, corsia) {
  return dateIso + "|" + fascia + "|" + corsia;
}

// Tipi che gestiscono una LISTA di nomi nella stessa cella
function isMultiplo(tipo) {
  return tipo === "privato" || tipo === "convenzione";
}
// Lista nomi di una cella (i nomi sono salvati separati da " || ")
function clientiDi(cell) {
  if (!cell || !isMultiplo(cell.tipo) || !cell.cliente) return [];
  return cell.cliente.split(" || ").filter((x) => x.trim());
}
// Etichetta compatta per la cella: "Rossi" (1) o "3 nomi" (molti)
function etichettaPrivati(cell) {
  const l = clientiDi(cell);
  const singolare = cell && cell.tipo === "convenzione" ? "Convenzione" : "Cliente privato";
  const plurale = cell && cell.tipo === "convenzione" ? " convenzioni" : " privati";
  if (l.length === 0) return singolare;
  if (l.length === 1) return l[0];
  return l.length + plurale;
}

// ── Schermata di accesso ──────────────────────────────────────
function Login({ onEntra }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState(false);
  const prova = () => {
    if (pwd === PWD_ADMIN) onEntra("admin");
    else if (pwd === PWD_STAFF) onEntra("staff");
    else setErr(true);
  };
  return (
    <div style={LS.wrap}>
      <div style={LS.card}>
        <div style={LS.eyebrow}>Gestione corsie</div>
        <h1 style={LS.h1}>Piscina Cappuccini</h1>
        <p style={LS.sub}>Inserisci la password per accedere.</p>
        <input type="password" value={pwd} autoFocus
          onChange={(e) => { setPwd(e.target.value); setErr(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") prova(); }}
          placeholder="Password" style={{ ...LS.input, borderColor: err ? "#C0392B" : "#D3DBDF" }} />
        {err && <div style={LS.err}>Password non valida.</div>}
        <button onClick={prova} style={LS.btn}>Entra</button>
        <p style={LS.hint}>Gli amministratori gestiscono le corsie; lo staff inserisce i clienti privati.</p>
      </div>
    </div>
  );
}

const LS = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Inter', system-ui, sans-serif" },
  card: { width: "min(420px, 94vw)", background: "#fff", border: "1px solid #E4E9EC", borderRadius: 18, boxShadow: "0 20px 50px rgba(11,26,34,0.12)", padding: 28 },
  eyebrow: { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1E6E8C", fontWeight: 700 },
  h1: { fontSize: 28, margin: "6px 0 2px", fontWeight: 800, letterSpacing: "-0.02em", color: "#0B1A22" },
  sub: { fontSize: 14, color: "#5B6970", margin: "0 0 18px" },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 14px", border: "1px solid #D3DBDF", borderRadius: 10, fontSize: 15, marginBottom: 10 },
  err: { color: "#C0392B", fontSize: 13, fontWeight: 600, marginBottom: 10 },
  btn: { width: "100%", padding: "12px", background: "#0B1A22", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 15 },
  hint: { fontSize: 12, color: "#8A959B", margin: "16px 0 0", lineHeight: 1.4 },
};

export default function App() {
  const [ruolo, setRuolo] = useState(null);          // "admin" | "staff" | null
  const [vista, setVista] = useState("giorno");
  const [cursore, setCursore] = useState(oggi());
  const [durata, setDurata] = useState(60);
  const [dati, setDati] = useState({});
  const [caricato, setCaricato] = useState(false);
  const [sincro, setSincro] = useState("…");         // stato sincronizzazione
  const [sel, setSel] = useState(null);
  const [tipo, setTipo] = useState("libero");
  const [nota, setNota] = useState("");
  const [cliente, setCliente] = useState("");        // nome cliente in digitazione
  const [clientiLista, setClientiLista] = useState([]); // lista clienti privati nella cella
  const [oraInizio, setOraInizio] = useState("");   // "hh:mm" della prenotazione
  const [oraFine, setOraFine] = useState("");       // "hh:mm" della prenotazione
  const [presets, setPresets] = useState([]);       // [{nome, corsie:[...]}]
  const [nuovoPreset, setNuovoPreset] = useState(""); // nome in digitazione
  const fileRef = useRef(null);                        // input file per importazione

  const isAdmin = ruolo === "admin";

  // Pannello programmazione ricorrente
  const [progOpen, setProgOpen] = useState(false);
  const [prog, setProg] = useState({
    tipo: "corso",
    corsie: [1],
    dal: iso(oggi()),
    al: iso(addDays(oggi(), 30)),
    oraDa: "17:00",
    oraA: "19:00",
    giorni: [0, 2, 4],       // indici GIORNI: Lun, Mer, Ven
    nota: "",
  });

  // Le fasce dipendono dalla durata scelta
  const FASCE = useMemo(() => generaFasce(durata), [durata]);
  const totGiorno = FASCE.length * CORSIE.length;

  // Converte una riga del DB nel formato interno { tipo, nota, oraInizio, oraFine, cliente }
  const rigaToCell = (r) => ({
    tipo: r.tipo, nota: r.nota || "", oraInizio: r.ora_inizio || "",
    oraFine: r.ora_fine || "", cliente: r.cliente || "",
  });

  // Carica preferenze locali (durata, preset) — personali del dispositivo
  useEffect(() => {
    (async () => {
      try {
        const p = await storage.get(PREF_KEY);
        if (p && p.value) { const d = JSON.parse(p.value).durata; if (DURATE.includes(d)) setDurata(d); }
      } catch (_) {}
      try {
        const pr = await storage.get(PRESET_KEY);
        if (pr && pr.value) { const arr = JSON.parse(pr.value); if (Array.isArray(arr)) setPresets(arr); }
      } catch (_) {}
    })();
  }, []);

  // Carica le prenotazioni dal database condiviso + sottoscrizione realtime
  useEffect(() => {
    if (!ruolo) return;   // carica solo dopo il login
    let attivo = true;

    const caricaTutto = async () => {
      setSincro("carico…");
      const { data, error } = await supabase
        .from("prenotazioni")
        .select("*")
        .order("data_iso", { ascending: true })
        .limit(100000);
      if (!attivo) return;
      if (error) { setSincro("errore di connessione"); setCaricato(true); return; }
      const map = {};
      (data || []).forEach((r) => { map[r.id] = rigaToCell(r); });
      setDati(map);
      setCaricato(true);
      setSincro("sincronizzato");
    };
    caricaTutto();

    // Sincronizzazione in tempo reale: ogni modifica di chiunque aggiorna la griglia
    const canale = supabase
      .channel("prenotazioni-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "prenotazioni" }, (payload) => {
        setDati((prev) => {
          const n = { ...prev };
          if (payload.eventType === "DELETE") { delete n[payload.old.id]; }
          else { const r = payload.new; n[r.id] = rigaToCell(r); }
          return n;
        });
      })
      .subscribe();

    return () => { attivo = false; supabase.removeChannel(canale); };
  }, [ruolo]);

  useEffect(() => {
    (async () => { try { await storage.set(PREF_KEY, JSON.stringify({ durata })); } catch (_) {} })();
  }, [durata]);

  useEffect(() => {
    (async () => { try { await storage.set(PRESET_KEY, JSON.stringify(presets)); } catch (_) {} })();
  }, [presets]);

  // ── Scrittura su Supabase ────────────────────────────────────
  // Salva/aggiorna un blocco di celle (upsert) e aggiorna subito la UI locale
  const scriviCelle = async (celle) => {
    // celle: [{ id, data_iso, fascia, corsia, tipo, nota, ora_inizio, ora_fine, cliente }]
    setDati((prev) => {
      const n = { ...prev };
      celle.forEach((r) => { n[r.id] = rigaToCell(r); });
      return n;
    });
    const payload = celle.map((r) => ({ ...r, creato_da: ruolo, aggiornato_il: new Date().toISOString() }));
    const { error } = await supabase.from("prenotazioni").upsert(payload);
    if (error) { setSincro("errore salvataggio"); alert("Salvataggio non riuscito. Controlla la connessione."); }
    else setSincro("sincronizzato");
  };
  // Elimina celle per id e aggiorna la UI
  const eliminaCelle = async (ids) => {
    setDati((prev) => { const n = { ...prev }; ids.forEach((id) => delete n[id]); return n; });
    const { error } = await supabase.from("prenotazioni").delete().in("id", ids);
    if (error) { setSincro("errore eliminazione"); alert("Eliminazione non riuscita. Controlla la connessione."); }
    else setSincro("sincronizzato");
  };

  const salvaPreset = () => {
    const nome = nuovoPreset.trim();
    if (!nome || !sel || !sel.corsie.length) return;
    setPresets((ps) => {
      const senza = ps.filter((p) => p.nome.toLowerCase() !== nome.toLowerCase());
      return [...senza, { nome, corsie: [...sel.corsie] }].sort((a,b) => a.nome.localeCompare(b.nome));
    });
    setNuovoPreset("");
  };
  const eliminaPreset = (nome) =>
    setPresets((ps) => ps.filter((p) => p.nome !== nome));

  // sel = { dateIso, fascia, corsie:[...] } — fascia = riga toccata
  const apri = (dateIso, fascia, corsia) => {
    const e = dati[keyOf(dateIso, fascia, corsia)];
    setSel({ dateIso, fascia, corsie: [corsia] });
    // Lo staff parte sempre dal tipo "privato" (l'unico che può usare)
    setTipo(e ? e.tipo : (isAdmin ? "libero" : "privato"));
    setNota(e ? e.nota || "" : "");
    // Lista clienti privati (i nomi sono salvati separati da " || ")
    if (e && isMultiplo(e.tipo) && e.cliente) {
      setClientiLista(e.cliente.split(" || ").filter((x) => x.trim()));
    } else {
      setClientiLista([]);
    }
    setCliente("");
    // precompilo inizio = fascia toccata, fine = fascia + una durata slot
    const iniz = e && e.oraInizio ? e.oraInizio : fascia;
    let fin;
    if (e && e.oraFine) fin = e.oraFine;
    else {
      const finMin = Math.min(hhmmToMin(fascia) + durata, CHIUSURA);
      fin = String(Math.floor(finMin/60)).padStart(2,"0") + ":" + String(finMin%60).padStart(2,"0");
    }
    setOraInizio(iniz);
    setOraFine(fin);
  };
  // aggiunge/toglie una corsia dalla selezione multipla
  const toggleCorsia = (c) => {
    setSel((s) => {
      if (!s) return s;
      const has = s.corsie.includes(c);
      const corsie = has ? s.corsie.filter((x) => x !== c) : [...s.corsie, c].sort((a,b)=>a-b);
      return { ...s, corsie: corsie.length ? corsie : [c] };
    });
  };
  const setCorsieSel = (arr) => setSel((s) => s ? { ...s, corsie: [...arr].sort((a,b)=>a-b) } : s);

  // Aggiunge il nome digitato alla lista clienti privati
  const aggiungiCliente = () => {
    const n = cliente.trim();
    if (!n) return;
    setClientiLista((l) => l.includes(n) ? l : [...l, n]);
    setCliente("");
  };
  const rimuoviCliente = (n) => setClientiLista((l) => l.filter((x) => x !== n));

  const salva = () => {
    if (!sel || !sel.corsie.length) return;
    // Permesso: lo staff può salvare solo clienti privati
    if (!isAdmin && tipo !== "privato") {
      alert("Come staff puoi inserire solo i clienti privati.\nSeleziona il tipo « Cliente privato ».");
      return;
    }
    // Per privato/convenzione: includo anche un eventuale nome ancora nella casella di testo
    let listaFinale = clientiLista;
    if (isMultiplo(tipo) && cliente.trim() && !listaFinale.includes(cliente.trim())) {
      listaFinale = [...listaFinale, cliente.trim()];
    }
    if (isMultiplo(tipo) && listaFinale.length === 0) {
      alert("Aggiungi almeno un nome."); return;
    }
    const iniMin = hhmmToMin(oraInizio);
    const finMin = hhmmToMin(oraFine);
    if (finMin <= iniMin) { alert("L'ora di fine deve essere dopo l'ora di inizio."); return; }
    const fasceDaRiempire = fasceCoperte(iniMin, finMin, durata, FASCE);
    if (!fasceDaRiempire.length) { alert("Nessuna fascia rientra nell'orario scelto."); return; }
    const celle = [];
    sel.corsie.forEach((c) => {
      fasceDaRiempire.forEach((f) => {
        celle.push({
          id: keyOf(sel.dateIso, f, c), data_iso: sel.dateIso, fascia: f, corsia: c,
          tipo, nota: nota.trim(), ora_inizio: oraInizio, ora_fine: oraFine,
          cliente: isMultiplo(tipo) ? listaFinale.join(" || ") : "",
        });
      });
    });
    scriviCelle(celle);
    setSel(null);
  };
  // Libera l'intero blocco (tutte le fasce coperte dall'orario) sulle corsie selezionate
  const libera = () => {
    if (!sel || !sel.corsie.length) return;
    // Permesso: lo staff può liberare solo celle di clienti privati
    if (!isAdmin) {
      const primaCella = dati[keyOf(sel.dateIso, sel.fascia, sel.corsie[0])];
      if (!primaCella || primaCella.tipo !== "privato") {
        alert("Come staff puoi rimuovere solo i clienti privati."); return;
      }
    }
    const iniMin = hhmmToMin(oraInizio);
    const finMin = hhmmToMin(oraFine);
    const fasceDaLiberare = finMin > iniMin
      ? fasceCoperte(iniMin, finMin, durata, FASCE)
      : [sel.fascia];
    const ids = [];
    sel.corsie.forEach((c) => {
      fasceDaLiberare.forEach((f) => { ids.push(keyOf(sel.dateIso, f, c)); });
    });
    eliminaCelle(ids);
    setSel(null);
  };

  const occInData = (dateIso) =>
    Object.keys(dati).filter((k) => k.startsWith(dateIso + "|")).length;

  const step = (dir) => {
    if (vista === "giorno") setCursore((c) => addDays(c, dir));
    else if (vista === "settimana") setCursore((c) => addDays(c, dir * 7));
    else setCursore((c) => { const x = new Date(c); x.setDate(1); x.setMonth(x.getMonth()+dir); return x; });
  };

  // ── Backup: esporta tutto in un file .json ──────────────────
  const esporta = () => {
    const backup = {
      app: "piscina-cappuccini",
      versione: 1,
      esportatoIl: new Date().toISOString(),
      prenotazioni: dati,
      preset: presets,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const oggiStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "piscina-cappuccini_backup_" + oggiStr + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Esporta pagina HTML di sola lettura (per i colleghi) ─────
  const esportaPagina = () => {
    const oggiStr = new Date().toISOString().slice(0, 10);
    const dataOra = new Date().toLocaleString("it-IT");
    const payload = {
      dati,
      tipi: TIPI,
      corsie: CORSIE,
      giorni: GIORNI,
      mesi: MESI,
      generatoIl: dataOra,
    };
    const html = generaHtmlSolaLettura(payload);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "piscina-cappuccini_calendario_" + oggiStr + ".html";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Importa da file: sostituisce prenotazioni e preset ──────
  const importa = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b = JSON.parse(reader.result);
        if (b.app && b.app !== "piscina-cappuccini") {
          alert("Il file non sembra un backup di questa app.");
          return;
        }
        const nPren = b.prenotazioni ? Object.keys(b.prenotazioni).length : 0;
        const ok = window.confirm(
          "Importare " + nPren + " prenotazioni" +
          (b.preset ? " e " + b.preset.length + " preset" : "") +
          "?\nI dati attuali verranno sostituiti."
        );
        if (!ok) return;
        // Carico le prenotazioni sul database condiviso
        if (b.prenotazioni && typeof b.prenotazioni === "object") {
          const celle = Object.entries(b.prenotazioni).map(([k, v]) => {
            const [data_iso, fascia, corsia] = k.split("|");
            return {
              id: k, data_iso, fascia, corsia: Number(corsia),
              tipo: v.tipo, nota: v.nota || "",
              ora_inizio: v.oraInizio || "", ora_fine: v.oraFine || "", cliente: v.cliente || "",
            };
          });
          if (celle.length) scriviCelle(celle);
        }
        if (Array.isArray(b.preset)) setPresets(b.preset);
      } catch (_) {
        alert("File non valido: impossibile leggere il backup.");
      }
    };
    reader.readAsText(file);
  };

  // ── Programmazione ricorrente ────────────────────────────────
  // Calcola le celle-target (date × fasce × corsie) secondo i criteri.
  const calcolaTargetProg = () => {
    const fasceDurata = generaFasce(durata);
    // fasce comprese nell'intervallo orario [oraDa, oraA)
    const fasceInRange = fasceDurata.filter((f) => f >= prog.oraDa && f < prog.oraA);
    const target = [];
    let d = new Date(prog.dal + "T12:00:00");
    const fine = new Date(prog.al + "T12:00:00");
    if (isNaN(d) || isNaN(fine) || d > fine) return { target: [], fasceInRange, giorniConteggio: 0 };
    let giorniConteggio = 0;
    while (d <= fine) {
      const idxGiorno = (d.getDay() + 6) % 7;   // 0 = Lun
      if (prog.giorni.includes(idxGiorno)) {
        giorniConteggio++;
        const dIso = iso(d);
        fasceInRange.forEach((f) => {
          prog.corsie.forEach((c) => target.push(keyOf(dIso, f, c)));
        });
      }
      d = addDays(d, 1);
    }
    return { target, fasceInRange, giorniConteggio };
  };

  const applicaProg = () => {
    if (!prog.corsie.length) { alert("Seleziona almeno una corsia."); return; }
    if (!prog.giorni.length) { alert("Seleziona almeno un giorno della settimana."); return; }
    if (prog.oraDa >= prog.oraA) { alert("L'ora di fine deve essere dopo l'ora di inizio."); return; }

    const { target, fasceInRange, giorniConteggio } = calcolaTargetProg();
    if (!target.length) {
      alert("Nessuna casella corrisponde ai criteri scelti.\nControlla date, giorni e orari.");
      return;
    }

    // quante caselle sono già occupate
    const occupate = target.filter((k) => dati[k]);
    let sovrascrivi = true;
    if (occupate.length > 0) {
      // "chiedimelo ogni volta"
      const scelta = window.confirm(
        occupate.length + " caselle su " + target.length + " sono già occupate.\n\n" +
        "OK = sovrascrivi anche quelle\n" +
        "Annulla = mantieni le esistenti e riempi solo le libere"
      );
      sovrascrivi = scelta;
    }

    const daScrivere = sovrascrivi ? target : target.filter((k) => !dati[k]);
    const conferma = window.confirm(
      "Applico « " + TIPI[prog.tipo].label + " »\n" +
      "su " + prog.corsie.length + " corsia/e, " +
      fasceInRange.length + " fasce, " +
      giorniConteggio + " giorni.\n\n" +
      "Totale: " + daScrivere.length + " caselle da compilare. Procedo?"
    );
    if (!conferma) return;

    // Ricostruisco i record dal loro id (data|fascia|corsia)
    const celle = daScrivere.map((k) => {
      const [data_iso, fascia, corsia] = k.split("|");
      return {
        id: k, data_iso, fascia, corsia: Number(corsia),
        tipo: prog.tipo, nota: prog.nota.trim(),
        ora_inizio: prog.oraDa, ora_fine: prog.oraA, cliente: "",
      };
    });
    scriviCelle(celle);
    setProgOpen(false);
  };

  const setProgCorsie = (arr) => setProg((p) => ({ ...p, corsie: [...arr].sort((a,b)=>a-b) }));
  const toggleProgCorsia = (c) => setProg((p) => {
    const has = p.corsie.includes(c);
    const corsie = has ? p.corsie.filter((x) => x !== c) : [...p.corsie, c];
    return { ...p, corsie: corsie.sort((a,b)=>a-b) };
  });
  const toggleProgGiorno = (i) => setProg((p) => {
    const has = p.giorni.includes(i);
    const giorni = has ? p.giorni.filter((x) => x !== i) : [...p.giorni, i];
    return { ...p, giorni: giorni.sort((a,b)=>a-b) };
  });

  const titolo = useMemo(() => {
    if (vista === "giorno")
      return giornoLbl(cursore) + " " + cursore.getDate() + " " + MESI[cursore.getMonth()];
    if (vista === "settimana") {
      const s = startOfWeek(cursore), e = addDays(s, 6);
      return s.getDate() + " " + MESI[s.getMonth()].slice(0,3) + " – " + e.getDate() + " " + MESI[e.getMonth()].slice(0,3);
    }
    return MESI[cursore.getMonth()] + " " + cursore.getFullYear();
  }, [vista, cursore]);

  // Schermata di accesso: finché non si sceglie un ruolo valido
  if (!ruolo) {
    return <Login onEntra={setRuolo} />;
  }

  return (
    <div style={S.page}>
      <style>{globalCss}</style>

      <header style={S.head}>
        <div>
          <div style={S.eyebrow}>
            Gestione corsie · {isAdmin ? "amministratore" : "staff"}
            {" · "}<span style={{ color: sincro==="sincronizzato" ? "#2C6B4F" : "#B8860B" }}>{sincro}</span>
          </div>
          <h1 style={S.h1}>Piscina Cappuccini</h1>
        </div>
        <div style={S.viste}>
          {["giorno","settimana","mese"].map((v) => (
            <button key={v} onClick={() => { setVista(v); setSel(null); }}
              style={{ ...S.vistaBtn, ...(v === vista ? S.vistaOn : {}) }}>
              {v[0].toUpperCase()+v.slice(1)}
            </button>
          ))}
          <button onClick={() => { setRuolo(null); setSel(null); }} style={S.logout} title="Esci">Esci</button>
        </div>
      </header>

      <div style={S.navRow}>
        <button onClick={() => step(-1)} style={S.nav} aria-label="Precedente">‹</button>
        <div style={S.titolo}>{titolo}</div>
        <button onClick={() => step(1)} style={S.nav} aria-label="Successivo">›</button>
        <button onClick={() => setCursore(oggi())} style={S.oggi}>Oggi</button>
        <div style={S.backupBtns}>
          {isAdmin && (
            <button onClick={() => setProgOpen(true)} style={S.progBtn}
              title="Assegna corsie su più giorni e orari in una volta">
              ⟳ Programma
            </button>
          )}
          {isAdmin && (
            <button onClick={esporta} style={S.backup} title="Salva un file di backup con tutte le prenotazioni">
              Esporta
            </button>
          )}
          <button onClick={esportaPagina} style={S.backup} title="Genera una pagina di sola lettura da inviare ai colleghi">
            Pagina
          </button>
          {isAdmin && (
            <button onClick={() => fileRef.current && fileRef.current.click()} style={S.backup}
              title="Ripristina le prenotazioni da un file di backup">
              Importa
            </button>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => { importa(e.target.files[0]); e.target.value = ""; }} />
        </div>
      </div>

      {/* Selettore durata slot */}
      <div style={S.durataRow}>
        <span style={S.durataLbl}>Durata slot</span>
        <div style={S.durataBtns}>
          {DURATE.map((d) => (
            <button key={d} onClick={() => { setDurata(d); setSel(null); }}
              style={{ ...S.durataBtn, ...(d === durata ? S.durataOn : {}) }}>
              {durataLabel(d)}
            </button>
          ))}
        </div>
        <span style={S.durataInfo}>{FASCE.length} fasce · 09:00–21:00</span>
      </div>

      {vista === "giorno" && (
        <VistaGiorno data={cursore} dati={dati} apri={apri} sel={sel} toggleCorsia={toggleCorsia}
          fasce={FASCE} occ={occInData(iso(cursore))} tot={totGiorno} durata={durata} />
      )}
      {vista === "settimana" && (
        <VistaSettimana cursore={cursore} dati={dati} occInData={occInData}
          fasce={FASCE} tot={totGiorno}
          vai={(d) => { setCursore(d); setVista("giorno"); }} />
      )}
      {vista === "mese" && (
        <VistaMese cursore={cursore} occInData={occInData} tot={totGiorno}
          vai={(d) => { setCursore(d); setVista("giorno"); }} />
      )}

      {/* ── Modale: Programmazione ricorrente ── */}
      {progOpen && (
        <div style={S.overlay} onClick={() => setProgOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHead}>
              <span>⟳ Programmazione ricorrente</span>
              <button onClick={() => setProgOpen(false)} style={S.modalX} aria-label="Chiudi">×</button>
            </div>
            <p style={S.modalHint}>
              Assegna un tipo d'uso su più giorni e orari in una volta sola.
            </p>

            {/* Tipo */}
            <div style={S.campo}>
              <label style={S.campoLbl}>Tipo d'uso</label>
              <div style={S.tipiRow}>
                {Object.entries(TIPI).map(([k, v]) => (
                  <button key={k} onClick={() => setProg((p) => ({ ...p, tipo: k }))}
                    style={{ ...S.tipoBtn, background: prog.tipo===k ? v.bg : "#F2F5F7",
                      color: prog.tipo===k ? v.ink : "#3A4750", borderColor: prog.tipo===k ? v.bg : "#DCE2E6" }}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Corsie */}
            <div style={S.campo}>
              <label style={S.campoLbl}>Corsie</label>
              <div style={S.corsieChips}>
                {CORSIE.map((c) => {
                  const on = prog.corsie.includes(c);
                  return (
                    <button key={c} onClick={() => toggleProgCorsia(c)}
                      style={{ ...S.corsiaChip, ...(on ? S.corsiaChipOn : {}) }}>{c}</button>
                  );
                })}
              </div>
              <div style={S.corsieQuick}>
                <button onClick={() => setProgCorsie(CORSIE)} style={S.quick}>Tutte</button>
                <button onClick={() => setProgCorsie([1,2,3,4])} style={S.quick}>1–4</button>
                <button onClick={() => setProgCorsie([5,6,7,8])} style={S.quick}>5–8</button>
                {presets.map((p) => (
                  <button key={p.nome} onClick={() => setProgCorsie(p.corsie)} style={S.quick}
                    title={"Corsie " + p.corsie.join(", ")}>{p.nome}</button>
                ))}
              </div>
            </div>

            {/* Orari */}
            <div style={S.campoRow}>
              <div style={{ flex: 1 }}>
                <label style={S.campoLbl}>Dalle ore</label>
                <input type="time" value={prog.oraDa} min="09:00" max="21:00"
                  onChange={(e) => setProg((p) => ({ ...p, oraDa: e.target.value }))} style={S.inputTime} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.campoLbl}>Alle ore</label>
                <input type="time" value={prog.oraA} min="09:00" max="21:00"
                  onChange={(e) => setProg((p) => ({ ...p, oraA: e.target.value }))} style={S.inputTime} />
              </div>
            </div>

            {/* Date */}
            <div style={S.campoRow}>
              <div style={{ flex: 1 }}>
                <label style={S.campoLbl}>Dal giorno</label>
                <input type="date" value={prog.dal}
                  onChange={(e) => setProg((p) => ({ ...p, dal: e.target.value }))} style={S.inputTime} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.campoLbl}>Al giorno</label>
                <input type="date" value={prog.al}
                  onChange={(e) => setProg((p) => ({ ...p, al: e.target.value }))} style={S.inputTime} />
              </div>
            </div>

            {/* Giorni della settimana */}
            <div style={S.campo}>
              <label style={S.campoLbl}>Giorni della settimana</label>
              <div style={S.corsieChips}>
                {GIORNI.map((g, i) => {
                  const on = prog.giorni.includes(i);
                  return (
                    <button key={g} onClick={() => toggleProgGiorno(i)}
                      style={{ ...S.giornoChip, ...(on ? S.giornoChipOn : {}) }}>{g}</button>
                  );
                })}
              </div>
              <div style={S.corsieQuick}>
                <button onClick={() => setProg((p) => ({ ...p, giorni: [0,1,2,3,4] }))} style={S.quick}>Lun–Ven</button>
                <button onClick={() => setProg((p) => ({ ...p, giorni: [5,6] }))} style={S.quick}>Weekend</button>
                <button onClick={() => setProg((p) => ({ ...p, giorni: [0,1,2,3,4,5,6] }))} style={S.quick}>Tutti</button>
              </div>
            </div>

            {/* Nota */}
            <div style={S.campo}>
              <label style={S.campoLbl}>Nota (opzionale)</label>
              <input value={prog.nota} onChange={(e) => setProg((p) => ({ ...p, nota: e.target.value }))}
                placeholder="Istruttore, gruppo…" style={S.input} />
            </div>

            {/* Anteprima */}
            <ProgAnteprima calcola={calcolaTargetProg} />

            <div style={S.panelBtns}>
              <button onClick={applicaProg} style={S.save}>Applica programmazione</button>
              <button onClick={() => setProgOpen(false)} style={S.cancel}>Annulla</button>
            </div>
          </div>
        </div>
      )}

      {sel && (
        <div style={S.panel}>
          <div style={S.panelHead}>
            {sel.fascia} · {sel.dateIso.split("-").reverse().join("/")}
            <span style={S.panelSub}>
              {sel.corsie.length === 1
                ? "Corsia " + sel.corsie[0]
                : sel.corsie.length + " corsie · " + sel.corsie.join(", ")}
            </span>
          </div>

          {/* Selettore corsie */}
          <div style={S.corsieBlock}>
            <div style={S.corsieChips}>
              {CORSIE.map((c) => {
                const on = sel.corsie.includes(c);
                return (
                  <button key={c} onClick={() => toggleCorsia(c)}
                    style={{ ...S.corsiaChip, ...(on ? S.corsiaChipOn : {}) }}>
                    {c}
                  </button>
                );
              })}
            </div>
            <div style={S.corsieQuick}>
              <button onClick={() => setCorsieSel(CORSIE)} style={S.quick}>Tutta la vasca</button>
              <button onClick={() => setCorsieSel([1,2,3,4])} style={S.quick}>Corsie 1–4</button>
              <button onClick={() => setCorsieSel([5,6,7,8])} style={S.quick}>Corsie 5–8</button>
              <button onClick={() => setCorsieSel(CORSIE.filter((c)=>c%2!==0))} style={S.quick}>Dispari</button>
              <button onClick={() => setCorsieSel(CORSIE.filter((c)=>c%2===0))} style={S.quick}>Pari</button>
              <button onClick={() => setCorsieSel(CORSIE.filter((c)=>!sel.corsie.includes(c)))} style={S.quickAlt}>Inverti</button>
            </div>

            {/* Preset personalizzati */}
            {presets.length > 0 && (
              <div style={S.presetRow}>
                {presets.map((p) => (
                  <span key={p.nome} style={S.presetChip}>
                    <button onClick={() => setCorsieSel(p.corsie)} style={S.presetUse}
                      title={"Corsie " + p.corsie.join(", ")}>
                      {p.nome} <span style={S.presetNums}>{p.corsie.join("·")}</span>
                    </button>
                    <button onClick={() => eliminaPreset(p.nome)} style={S.presetDel}
                      aria-label={"Elimina " + p.nome}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Salva la selezione corrente come preset */}
            <div style={S.presetSave}>
              <input value={nuovoPreset} onChange={(e) => setNuovoPreset(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") salvaPreset(); }}
                placeholder="Nome preset (es. Pallanuoto centro)" style={S.presetInput} />
              <button onClick={salvaPreset}
                disabled={!nuovoPreset.trim() || !sel.corsie.length}
                style={{ ...S.presetAdd, ...((nuovoPreset.trim() && sel.corsie.length) ? {} : S.btnOff) }}>
                Salva preset
              </button>
            </div>
          </div>

          <div style={S.tipiRow}>
            {Object.entries(TIPI)
              .filter(([k]) => isAdmin || k === "privato")   // staff: solo clienti privati
              .map(([k, v]) => (
              <button key={k} onClick={() => setTipo(k)}
                style={{ ...S.tipoBtn, background: tipo===k ? v.bg : "#F2F5F7",
                  color: tipo===k ? v.ink : "#3A4750", borderColor: tipo===k ? v.bg : "#DCE2E6" }}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Lista nomi (per Cliente privato e Convenzione) */}
          {isMultiplo(tipo) && (
            <div style={S.clientiBlock}>
              <label style={S.orarioLbl}>
                {tipo === "convenzione" ? "Con chi (convenzioni) in questa corsia" : "Clienti privati in questa corsia"}
              </label>
              {clientiLista.length > 0 && (
                <div style={S.clientiChips}>
                  {clientiLista.map((n) => (
                    <span key={n} style={S.clienteChip}>
                      {n}
                      <button onClick={() => rimuoviCliente(n)} style={S.clienteDel} aria-label={"Togli " + n}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={S.clienteAdd}>
                <input value={cliente} onChange={(e) => setCliente(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") aggiungiCliente(); }}
                  placeholder={tipo === "convenzione" ? "Nome convenzione + Invio" : "Nome cliente + Invio"}
                  style={{ ...S.input, marginBottom: 0, borderColor: "#1D6F42" }} />
                <button onClick={aggiungiCliente} style={S.clienteAddBtn}>+ Aggiungi</button>
              </div>
            </div>
          )}

          {/* Orario della prenotazione */}
          <div style={S.orarioRow}>
            <div style={{ flex: 1 }}>
              <label style={S.orarioLbl}>Dalle</label>
              <input type="time" value={oraInizio} min="09:00" max="21:00"
                onChange={(e) => setOraInizio(e.target.value)} style={S.inputTime} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.orarioLbl}>Alle</label>
              <input type="time" value={oraFine} min="09:00" max="21:00"
                onChange={(e) => setOraFine(e.target.value)} style={S.inputTime} />
            </div>
          </div>
          {oraInizio && oraFine && hhmmToMin(oraFine) > hhmmToMin(oraInizio) && (
            <div style={S.orarioInfo}>
              Occuperà {fasceCoperte(hhmmToMin(oraInizio), hhmmToMin(oraFine), durata, FASCE).length} fasce
              {sel.corsie.length > 1 ? " × " + sel.corsie.length + " corsie" : ""}
            </div>
          )}

          <input value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (istruttore, gruppo, note…)" style={S.input} />
          <div style={S.panelBtns}>
            <button onClick={salva} disabled={!sel.corsie.length}
              style={{ ...S.save, ...(sel.corsie.length ? {} : S.btnOff) }}>
              {!sel.corsie.length ? "Seleziona una corsia"
                : sel.corsie.length > 1 ? "Salva " + sel.corsie.length + " corsie" : "Salva"}
            </button>
            <button onClick={libera} disabled={!sel.corsie.length}
              style={{ ...S.clear, ...(sel.corsie.length ? {} : S.btnOff) }}>Libera</button>
            <button onClick={() => setSel(null)} style={S.cancel}>Chiudi</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista GIORNO ──────────────────────────────────────────────
function VistaGiorno({ data, dati, apri, sel, toggleCorsia, fasce, occ, tot, durata }) {
  const dIso = iso(data);
  const perc = Math.round((occ / tot) * 100);
  // slot più fitti (durate brevi) → celle più basse
  const slotH = durata <= 15 ? 34 : durata <= 30 ? 44 : 52;
  return (
    <>
      <div style={S.legenda}>
        <span style={{ ...S.legItem, fontWeight: 700, color: "#0B1A22" }}>
          Occupazione {perc}% · {occ}/{tot}
        </span>
        {Object.entries(TIPI).map(([k, v]) => (
          <span key={k} style={S.legItem}>
            <span style={{ ...S.legDot, background: v.bg }} />{v.label}
          </span>
        ))}
      </div>
      <div style={S.gridWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, ...S.thCorner }}>Orario</th>
              {CORSIE.map((c) => <th key={c} style={S.th}>Corsia {c}</th>)}
            </tr>
          </thead>
          <tbody>
            {fasce.map((f) => (
              <tr key={f}>
                <td style={S.oraCell}>{f}</td>
                {CORSIE.map((c) => {
                  const cell = dati[keyOf(dIso, f, c)];
                  const t = cell ? TIPI[cell.tipo] : null;
                  // pannello aperto sulla stessa fascia? il tap aggiunge/toglie la corsia
                  const stessaFascia = sel && sel.dateIso===dIso && sel.fascia===f;
                  const isSel = stessaFascia && sel.corsie.includes(c);
                  const onTap = stessaFascia ? () => toggleCorsia(c) : () => apri(dIso, f, c);
                  return (
                    <td key={c} style={S.td}>
                      <button onClick={onTap}
                        title={cell ? (
                          (cell.oraInizio ? cell.oraInizio + "–" + cell.oraFine + " · " : "") +
                          t.label +
                          (isMultiplo(cell.tipo) ? " · " + clientiDi(cell).join(", ") : "") +
                          (!isMultiplo(cell.tipo) && cell.nota ? " · " + cell.nota : "")
                        ) : "Libera"}
                        style={{ ...S.slot, height: slotH,
                          background: t ? t.bg : "transparent",
                          color: t ? t.ink : "#9AA4AD",
                          borderColor: isSel ? "#0B1A22" : (t ? t.bg : "#D9DEE2"),
                          boxShadow: isSel ? "0 0 0 2px #0B1A22" : "none" }}>
                        {t ? (
                          <>
                            <span style={S.slotTop}>{isMultiplo(cell.tipo) ? etichettaPrivati(cell) : t.label}</span>
                            {cell.oraInizio && slotH >= 44 && (
                              <span style={S.slotOra}>{cell.oraInizio}–{cell.oraFine}</span>
                            )}
                            {isMultiplo(cell.tipo) && clientiDi(cell).length > 1 && slotH >= 52 && (
                              <span style={S.slotNota}>{clientiDi(cell).length} {cell.tipo === "convenzione" ? "conv." : "clienti"}</span>
                            )}
                            {!isMultiplo(cell.tipo) && cell.nota && slotH >= 52 && <span style={S.slotNota}>{cell.nota}</span>}
                          </>
                        ) : <span style={S.slotFree}>+</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Vista SETTIMANA ───────────────────────────────────────────
function VistaSettimana({ cursore, dati, occInData, fasce, tot, vai }) {
  const s = startOfWeek(cursore);
  const giorni = Array.from({ length: 7 }, (_, i) => addDays(s, i));
  return (
    <>
      <div style={S.legenda}>
        <span style={{ ...S.legItem, fontWeight: 700, color: "#0B1A22" }}>Occupazione per fascia</span>
        <span style={S.legItem}><span style={{ ...S.legDot, background: "#DCEBF1" }} />bassa</span>
        <span style={S.legItem}><span style={{ ...S.legDot, background: "#9CC7D8" }} />media</span>
        <span style={S.legItem}><span style={{ ...S.legDot, background: "#1E6E8C" }} />alta</span>
      </div>
      <div style={S.gridWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, ...S.thCorner }}>Orario</th>
              {giorni.map((d) => {
                const o = occInData(iso(d));
                return (
                  <th key={iso(d)} style={{ ...S.th, cursor: "pointer" }} onClick={() => vai(d)}>
                    <div style={{ fontWeight: 800, color: "#0B1A22" }}>{giornoLbl(d)}</div>
                    <div style={{ fontSize: 11, color: "#5B6970" }}>{d.getDate()}/{d.getMonth()+1}</div>
                    <div style={{ fontSize: 10.5, color: o ? "#1E6E8C" : "#B7C0C6", fontWeight: 700 }}>{o}/{tot}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {fasce.map((f) => (
              <tr key={f}>
                <td style={S.oraCell}>{f}</td>
                {giorni.map((d) => {
                  const dIso = iso(d);
                  const occ = CORSIE.filter((c) => dati[keyOf(dIso, f, c)]).length;
                  return (
                    <td key={dIso} style={S.td} onClick={() => vai(d)}>
                      <div style={{ ...S.weekCell, ...heat(occ) }}>{occ > 0 ? occ + "/8" : ""}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Vista MESE ────────────────────────────────────────────────
function VistaMese({ cursore, occInData, tot, vai }) {
  const y = cursore.getFullYear(), m = cursore.getMonth();
  const primo = new Date(y, m, 1);
  const offset = (primo.getDay()+6)%7;
  const giorniMese = new Date(y, m+1, 0).getDate();
  const celle = [];
  for (let i = 0; i < offset; i++) celle.push(null);
  for (let g = 1; g <= giorniMese; g++) celle.push(new Date(y, m, g));
  while (celle.length % 7 !== 0) celle.push(null);

  return (
    <div style={S.meseWrap}>
      <div style={S.meseHead}>
        {GIORNI.map((g) => <div key={g} style={S.meseDow}>{g}</div>)}
      </div>
      <div style={S.meseGrid}>
        {celle.map((d, i) => {
          if (!d) return <div key={i} style={{ ...S.meseCell, ...S.meseVuota }} />;
          const o = occInData(iso(d));
          const perc = o / tot;
          const isToday = sameISO(d, oggi());
          return (
            <button key={i} onClick={() => vai(d)}
              style={{ ...S.meseCell, ...(isToday ? S.meseToday : {}) }}>
              <div style={S.meseNum}>{d.getDate()}</div>
              <div style={{ ...S.meseBar, background: barColor(perc), width: Math.max(perc*100, o?8:0) + "%" }} />
              <div style={S.meseOcc}>{o ? o + " slot" : ""}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Anteprima live del conteggio caselle nella programmazione
function ProgAnteprima({ calcola }) {
  const { target, fasceInRange, giorniConteggio } = calcola();
  return (
    <div style={S.anteprima}>
      {target.length === 0 ? (
        <span style={{ color: "#A8322D", fontWeight: 600 }}>
          Nessuna casella corrisponde ai criteri scelti.
        </span>
      ) : (
        <span>
          Verranno interessate <b>{target.length}</b> caselle
          {" "}({fasceInRange.length} fasce × {giorniConteggio} giorni).
        </span>
      )}
    </div>
  );
}

function heat(occ) {
  if (occ === 0) return { background: "transparent", color: "#C2CBD1" };
  const t = occ / 8;
  const bg = t < .34 ? "#DCEBF1" : t < .67 ? "#9CC7D8" : "#1E6E8C";
  return { background: bg, color: t >= .67 ? "#fff" : "#0B1A22" };
}
function barColor(p) { return p < .34 ? "#9CC7D8" : p < .67 ? "#4E9BB5" : "#1E6E8C"; }

// ── Genera un file HTML autonomo di sola lettura ───────────────
function generaHtmlSolaLettura(payload) {
  // I dati vengono incorporati come JSON. Il visualizzatore è JS puro,
  // ricalcola le fasce dalla durata scelta dall'utente nella pagina.
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Piscina Cappuccini — Calendario corsie</title>
<style>
  :root { --ink:#0B1A22; --sea:#1E6E8C; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); background:#FBFDFE; padding:24px 16px 60px; }
  .wrap { max-width:1100px; margin:0 auto; }
  .eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--sea); font-weight:700; }
  h1 { font-size:30px; margin:4px 0 2px; font-weight:800; letter-spacing:-.02em; }
  .sub { font-size:12px; color:#5B6970; margin-bottom:16px; }
  .ro-badge { display:inline-block; background:#EAF4F7; color:#0B4A5E; border:1px solid #CFE4EC; border-radius:999px; padding:3px 10px; font-size:11px; font-weight:700; margin-left:8px; }
  .bar { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
  button { font-family:inherit; }
  .tab { padding:8px 16px; border:1px solid #DCE2E6; border-radius:999px; background:#fff; cursor:pointer; font-size:14px; font-weight:600; color:#3A4750; }
  .tab.on { background:var(--ink); color:#fff; border-color:var(--ink); }
  .nav { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .nav .arrow { width:38px; height:38px; border-radius:10px; border:1px solid #DCE2E6; background:#fff; cursor:pointer; font-size:20px; color:var(--ink); }
  .nav .titolo { font-size:18px; font-weight:800; min-width:200px; }
  .dur { display:flex; gap:5px; flex-wrap:wrap; align-items:center; margin-bottom:14px; padding:10px 14px; background:#F4F8FA; border:1px solid #E1EBEF; border-radius:12px; }
  .dur b { font-size:12.5px; }
  .durb { padding:6px 12px; border:1px solid #CFDDE3; border-radius:8px; background:#fff; cursor:pointer; font-size:12.5px; font-weight:600; color:#3A4750; }
  .durb.on { background:var(--sea); color:#fff; border-color:var(--sea); }
  .legenda { display:flex; gap:14px; flex-wrap:wrap; font-size:12.5px; color:#3A4750; margin-bottom:12px; }
  .leg { display:inline-flex; align-items:center; gap:6px; }
  .dot { width:11px; height:11px; border-radius:3px; display:inline-block; }
  .gridWrap { overflow:auto; max-height:70vh; border:1px solid #E4E9EC; border-radius:14px; background:#fff; }
  table { border-collapse:separate; border-spacing:0; width:100%; min-width:780px; }
  th { font-size:11.5px; font-weight:700; color:#5B6970; padding:10px 8px; text-align:center; border-bottom:1px solid #E4E9EC; white-space:nowrap; position:sticky; top:0; background:#fff; z-index:3; }
  th.corner { text-align:left; padding-left:14px; left:0; z-index:4; }
  td.ora { font-size:12.5px; font-weight:700; padding:4px 14px; border-bottom:1px solid #F0F3F5; position:sticky; left:0; background:#fff; white-space:nowrap; z-index:1; }
  td.cell { padding:4px; border-bottom:1px solid #F0F3F5; }
  .slot { width:100%; min-width:84px; border:1px solid; border-radius:9px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:2px 4px; }
  .slot .lbl { font-size:11px; font-weight:700; line-height:1.1; text-align:center; }
  .slot .ora2 { font-size:9.5px; font-weight:600; opacity:.95; }
  .slot .nota { font-size:9.5px; opacity:.9; max-width:76px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .free { color:#C7D0D6; font-size:12px; }
  .wk { height:40px; min-width:60px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  .mese { border:1px solid #E4E9EC; border-radius:14px; background:#fff; padding:12px; }
  .mHead,.mGrid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
  .mHead { margin-bottom:6px; }
  .dow { text-align:center; font-size:11.5px; font-weight:700; color:#5B6970; padding:4px 0; }
  .mCell { aspect-ratio:1/.82; border:1px solid #EAEEF0; border-radius:10px; padding:6px 8px; display:flex; flex-direction:column; align-items:flex-start; overflow:hidden; }
  .mCell.empty { background:#FAFBFC; border-color:#F2F5F7; }
  .mNum { font-size:13px; font-weight:700; }
  .mBar { height:5px; border-radius:3px; margin-top:auto; }
  .mOcc { font-size:10.5px; color:#5B6970; font-weight:600; margin-top:3px; }
  .foot { margin-top:16px; font-size:11.5px; color:#8A959B; }
  @media print { .bar,.dur,.nav .arrow,.tabs { display:none !important; } .gridWrap{ max-height:none; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">Gestione corsie · sola lettura</div>
  <h1>Piscina Cappuccini <span class="ro-badge">SOLA LETTURA</span></h1>
  <div class="sub" id="sub"></div>

  <div class="bar tabs">
    <button class="tab on" data-v="giorno">Giorno</button>
    <button class="tab" data-v="settimana">Settimana</button>
    <button class="tab" data-v="mese">Mese</button>
  </div>

  <div class="nav">
    <button class="arrow" id="prev">‹</button>
    <div class="titolo" id="titolo"></div>
    <button class="arrow" id="next">›</button>
  </div>

  <div class="dur" id="durBar" style="display:none">
    <b>Durata slot</b>
    <span id="durBtns"></span>
    <span style="margin-left:auto;font-size:12px;color:#5B6970" id="durInfo"></span>
  </div>

  <div id="legenda" class="legenda"></div>
  <div id="view"></div>

  <div class="foot" id="foot"></div>
</div>

<script>
const P = ${dataJson};
const DATI = P.dati || {};
const TIPI = P.tipi; const CORSIE = P.corsie; const GIORNI = P.giorni; const MESI = P.mesi;
const APERTURA=9*60, CHIUSURA=21*60;
const DURATE=[10,15,20,30,60,90,100,110];
let durata=60, vista="giorno", cur=new Date(); cur.setHours(0,0,0,0);

function pad(n){return String(n).padStart(2,"0");}
function durataLabel(m){if(m<60)return m+" min";const h=Math.floor(m/60),mm=m%60;return mm===0?h+" ora"+(h>1?"e":""):h+"h"+pad(mm);}
function generaFasce(d){const o=[];for(let m=APERTURA;m<CHIUSURA;m+=d)o.push(pad(Math.floor(m/60))+":"+pad(m%60));return o;}
function iso(d){const x=new Date(d);x.setHours(12,0,0,0);return x.toISOString().slice(0,10);}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function startOfWeek(d){const x=new Date(d),g=(x.getDay()+6)%7;return addDays(x,-g);}
function giornoLbl(d){return GIORNI[(d.getDay()+6)%7];}
function keyOf(di,f,c){return di+"|"+f+"|"+c;}
function heat(o){if(o===0)return"background:transparent;color:#C2CBD1";const t=o/8;const bg=t<.34?"#DCEBF1":t<.67?"#9CC7D8":"#1E6E8C";return"background:"+bg+";color:"+(t>=.67?"#fff":"#0B1A22");}
function barColor(p){return p<.34?"#9CC7D8":p<.67?"#4E9BB5":"#1E6E8C";}
function occInData(di){return Object.keys(DATI).filter(k=>k.indexOf(di+"|")===0).length;}

function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function isMult(t){return t==="privato"||t==="convenzione";}
function etichettaPriv(cell){const sing=cell.tipo==="convenzione"?"Convenzione":"Cliente privato";if(!cell.cliente)return sing;const l=cell.cliente.split(" || ").filter(x=>x.trim());return l.length<=1?(l[0]||sing):l.length+(cell.tipo==="convenzione"?" convenzioni":" privati");}

function render(){
  document.getElementById("sub").textContent="Calendario generato il "+P.generatoIl+" · aggiornamento statico";
  document.getElementById("foot").textContent="File di sola lettura — per modifiche usare l'app gestionale. Generato il "+P.generatoIl+".";
  // legenda
  document.getElementById("legenda").innerHTML=Object.keys(TIPI).map(k=>'<span class="leg"><span class="dot" style="background:'+TIPI[k].bg+'"></span>'+esc(TIPI[k].label)+'</span>').join("");
  // durata bar solo per giorno/settimana
  const durBar=document.getElementById("durBar");
  durBar.style.display=(vista==="mese")?"none":"flex";
  document.getElementById("durBtns").innerHTML=DURATE.map(d=>'<button class="durb'+(d===durata?" on":"")+'" data-d="'+d+'">'+durataLabel(d)+'</button>').join(" ");
  const F=generaFasce(durata);
  document.getElementById("durInfo").textContent=F.length+" fasce · 09:00–21:00";
  // titolo
  let tit="";
  if(vista==="giorno")tit=giornoLbl(cur)+" "+cur.getDate()+" "+MESI[cur.getMonth()];
  else if(vista==="settimana"){const s=startOfWeek(cur),e=addDays(s,6);tit=s.getDate()+" "+MESI[s.getMonth()].slice(0,3)+" – "+e.getDate()+" "+MESI[e.getMonth()].slice(0,3);}
  else tit=MESI[cur.getMonth()]+" "+cur.getFullYear();
  document.getElementById("titolo").textContent=tit;
  // view
  const v=document.getElementById("view");
  if(vista==="giorno")v.innerHTML=viewGiorno(F);
  else if(vista==="settimana")v.innerHTML=viewSettimana(F);
  else v.innerHTML=viewMese();
  // bind durata
  durBar.querySelectorAll(".durb").forEach(b=>b.onclick=()=>{durata=+b.dataset.d;render();});
}

function viewGiorno(F){
  const di=iso(cur);
  const slotH=durata<=15?34:durata<=30?44:52;
  let h='<div class="gridWrap"><table><thead><tr><th class="corner">Orario</th>';
  CORSIE.forEach(c=>h+='<th>Corsia '+c+'</th>');
  h+='</tr></thead><tbody>';
  F.forEach(f=>{
    h+='<tr><td class="ora">'+f+'</td>';
    CORSIE.forEach(c=>{
      const cell=DATI[keyOf(di,f,c)];
      if(cell){const t=TIPI[cell.tipo];
        h+='<td class="cell"><div class="slot" style="height:'+slotH+'px;background:'+t.bg+';color:'+t.ink+';border-color:'+t.bg+'">'
          +'<span class="lbl">'+esc(isMult(cell.tipo)?etichettaPriv(cell):t.label)+'</span>'
          +(cell.oraInizio&&slotH>=44?'<span class="ora2">'+esc(cell.oraInizio)+'–'+esc(cell.oraFine)+'</span>':'')
          +(cell.nota&&slotH>=52?'<span class="nota">'+esc(cell.nota)+'</span>':'')
          +'</div></td>';
      } else {
        h+='<td class="cell"><div class="slot" style="height:'+slotH+'px;border-color:#D9DEE2"><span class="free">·</span></div></td>';
      }
    });
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  return h;
}

function viewSettimana(F){
  const s=startOfWeek(cur);
  const gg=Array.from({length:7},(_,i)=>addDays(s,i));
  let h='<div class="gridWrap"><table><thead><tr><th class="corner">Orario</th>';
  gg.forEach(d=>{const o=occInData(iso(d));h+='<th><div style="font-weight:800;color:#0B1A22">'+giornoLbl(d)+'</div><div style="font-size:11px;color:#5B6970">'+d.getDate()+"/"+(d.getMonth()+1)+'</div><div style="font-size:10.5px;color:'+(o?"#1E6E8C":"#B7C0C6")+';font-weight:700">'+o+'</div></th>';});
  h+='</tr></thead><tbody>';
  F.forEach(f=>{
    h+='<tr><td class="ora">'+f+'</td>';
    gg.forEach(d=>{const di=iso(d);const occ=CORSIE.filter(c=>DATI[keyOf(di,f,c)]).length;
      h+='<td class="cell"><div class="wk" style="'+heat(occ)+'">'+(occ>0?occ+"/8":"")+'</div></td>';});
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  return h;
}

function viewMese(){
  const y=cur.getFullYear(),m=cur.getMonth();
  const off=(new Date(y,m,1).getDay()+6)%7;
  const gm=new Date(y,m+1,0).getDate();
  const tot=generaFasce(durata).length*CORSIE.length;
  let cells=[];
  for(let i=0;i<off;i++)cells.push(null);
  for(let g=1;g<=gm;g++)cells.push(new Date(y,m,g));
  while(cells.length%7!==0)cells.push(null);
  let h='<div class="mese"><div class="mHead">'+GIORNI.map(g=>'<div class="dow">'+g+'</div>').join("")+'</div><div class="mGrid">';
  cells.forEach(d=>{
    if(!d){h+='<div class="mCell empty"></div>';return;}
    const o=occInData(iso(d));const perc=o/tot;
    h+='<div class="mCell"><div class="mNum">'+d.getDate()+'</div>'
      +'<div class="mBar" style="background:'+barColor(perc)+';width:'+Math.max(perc*100,o?8:0)+'%"></div>'
      +'<div class="mOcc">'+(o?o+" slot":"")+'</div></div>';
  });
  h+='</div></div>';
  return h;
}

// navigazione
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
  t.classList.add("on"); vista=t.dataset.v; render();
});
document.getElementById("prev").onclick=()=>{step(-1);};
document.getElementById("next").onclick=()=>{step(1);};
function step(dir){
  if(vista==="giorno")cur=addDays(cur,dir);
  else if(vista==="settimana")cur=addDays(cur,dir*7);
  else {cur=new Date(cur);cur.setDate(1);cur.setMonth(cur.getMonth()+dir);}
  render();
}
render();
</script>
</body>
</html>`;
}

// ── Stili ─────────────────────────────────────────────────────
const S = {
  page: { maxWidth: 1100, margin: "0 auto", padding: "28px 20px 120px", fontFamily: "'Inter', system-ui, sans-serif", color: "#0B1A22" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 18 },
  eyebrow: { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1E6E8C", fontWeight: 700 },
  h1: { fontSize: 34, margin: "4px 0 0", fontWeight: 800, letterSpacing: "-0.02em" },
  viste: { display: "flex", gap: 6 },
  vistaBtn: { padding: "8px 16px", border: "1px solid #DCE2E6", borderRadius: 999, background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#3A4750" },
  vistaOn: { background: "#0B1A22", color: "#fff", borderColor: "#0B1A22" },
  logout: { padding: "8px 14px", border: "1px solid #E7C3B4", borderRadius: 999, background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#C7511F" },
  navRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 },
  nav: { width: 38, height: 38, borderRadius: 10, border: "1px solid #DCE2E6", background: "#fff", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "#0B1A22" },
  titolo: { fontSize: 18, fontWeight: 800, minWidth: 200 },
  oggi: { padding: "8px 16px", border: "1px solid #DCE2E6", borderRadius: 999, background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1E6E8C" },
  backupBtns: { display: "flex", gap: 6, marginLeft: "auto" },
  backup: { padding: "8px 14px", border: "1px solid #CFE0D8", borderRadius: 999, background: "#F1F8F4", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#2C6B4F" },
  progBtn: { padding: "8px 14px", border: "1px solid #C9D8E6", borderRadius: 999, background: "#0B1A22", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#fff" },
  durataRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16, padding: "10px 14px", background: "#F4F8FA", border: "1px solid #E1EBEF", borderRadius: 12 },
  durataLbl: { fontSize: 12.5, fontWeight: 700, color: "#0B1A22" },
  durataBtns: { display: "flex", gap: 5, flexWrap: "wrap" },
  durataBtn: { padding: "6px 12px", border: "1px solid #CFDDE3", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#3A4750" },
  durataOn: { background: "#1E6E8C", color: "#fff", borderColor: "#1E6E8C" },
  durataInfo: { fontSize: 12, color: "#5B6970", marginLeft: "auto" },
  legenda: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14, fontSize: 12.5, color: "#3A4750" },
  legItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  legDot: { width: 11, height: 11, borderRadius: 3, display: "inline-block" },
  gridWrap: { overflowX: "auto", maxHeight: "68vh", overflowY: "auto", border: "1px solid #E4E9EC", borderRadius: 14, background: "#fff" },
  table: { borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 780 },
  th: { fontSize: 11.5, fontWeight: 700, color: "#5B6970", padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #E4E9EC", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 3 },
  thCorner: { textAlign: "left", paddingLeft: 14, left: 0, zIndex: 4 },
  oraCell: { fontSize: 12.5, fontWeight: 700, color: "#0B1A22", padding: "4px 14px", borderBottom: "1px solid #F0F3F5", position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap", zIndex: 1 },
  td: { padding: 4, borderBottom: "1px solid #F0F3F5" },
  slot: { width: "100%", minWidth: 84, border: "1px solid", borderRadius: 9, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "2px 4px" },
  slotTop: { fontSize: 11, fontWeight: 700, lineHeight: 1.1, textAlign: "center" },
  slotOra: { fontSize: 9.5, fontWeight: 600, opacity: 0.95, lineHeight: 1, textAlign: "center" },
  slotNota: { fontSize: 9.5, opacity: 0.9, lineHeight: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 76, whiteSpace: "nowrap" },
  slotFree: { fontSize: 18, color: "#C2CBD1", fontWeight: 300 },
  weekCell: { height: 40, minWidth: 60, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  meseWrap: { border: "1px solid #E4E9EC", borderRadius: 14, background: "#fff", padding: 12 },
  meseHead: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 },
  meseDow: { textAlign: "center", fontSize: 11.5, fontWeight: 700, color: "#5B6970", padding: "4px 0" },
  meseGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 },
  meseCell: { aspectRatio: "1 / 0.82", border: "1px solid #EAEEF0", borderRadius: 10, background: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "6px 8px", position: "relative", overflow: "hidden" },
  meseVuota: { background: "#FAFBFC", border: "1px solid #F2F5F7", cursor: "default" },
  meseToday: { border: "2px solid #0B1A22" },
  meseNum: { fontSize: 13, fontWeight: 700, color: "#0B1A22" },
  meseBar: { height: 5, borderRadius: 3, marginTop: "auto", minWidth: 0 },
  meseOcc: { fontSize: 10.5, color: "#5B6970", fontWeight: 600, marginTop: 3 },
  panel: { position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", width: "min(560px, 92vw)", background: "#fff", border: "1px solid #D3DBDF", borderRadius: 16, boxShadow: "0 12px 40px rgba(11,26,34,0.22)", padding: 18, zIndex: 50 },
  panelHead: { fontSize: 15, fontWeight: 800, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  panelSub: { fontSize: 12.5, fontWeight: 600, color: "#1E6E8C" },
  corsieBlock: { marginBottom: 12, padding: "10px 12px", background: "#F4F8FA", border: "1px solid #E1EBEF", borderRadius: 10 },
  corsieChips: { display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 },
  corsiaChip: { width: 34, height: 34, borderRadius: 8, border: "1px solid #CFDDE3", background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#3A4750" },
  corsiaChipOn: { background: "#1E6E8C", color: "#fff", borderColor: "#1E6E8C" },
  corsieQuick: { display: "flex", gap: 6, flexWrap: "wrap" },
  quick: { padding: "5px 10px", borderRadius: 999, border: "1px solid #CFDDE3", background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#1E6E8C" },
  quickAlt: { padding: "5px 10px", borderRadius: 999, border: "1px solid #D6CFE3", background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#6A3D9A" },
  presetRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px dashed #D5E1E6" },
  presetChip: { display: "inline-flex", alignItems: "stretch", border: "1px solid #1E6E8C", borderRadius: 999, overflow: "hidden" },
  presetUse: { padding: "5px 10px", background: "#EAF4F7", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#0B4A5E" },
  presetNums: { fontWeight: 500, opacity: 0.7, marginLeft: 3 },
  presetDel: { padding: "0 8px", background: "#1E6E8C", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, fontWeight: 700 },
  presetSave: { display: "flex", gap: 6, marginTop: 10 },
  presetInput: { flex: 1, minWidth: 0, boxSizing: "border-box", padding: "8px 10px", border: "1px solid #D3DBDF", borderRadius: 8, fontSize: 12.5 },
  presetAdd: { padding: "8px 12px", background: "#0B1A22", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 },
  tipiRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 },
  tipoBtn: { padding: "7px 12px", border: "1px solid", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #D3DBDF", borderRadius: 10, fontSize: 14, marginBottom: 12 },
  orarioRow: { display: "flex", gap: 10, marginBottom: 8 },
  orarioLbl: { display: "block", fontSize: 11, fontWeight: 700, color: "#0B1A22", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" },
  orarioInfo: { fontSize: 12, color: "#0B4A5E", background: "#EAF4F7", border: "1px solid #CFE4EC", borderRadius: 8, padding: "6px 10px", marginBottom: 12, fontWeight: 600 },
  clientiBlock: { marginBottom: 10, padding: "10px 12px", background: "#EEF7F1", border: "1px solid #CDE7D8", borderRadius: 10 },
  clientiChips: { display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" },
  clienteChip: { display: "inline-flex", alignItems: "center", gap: 4, background: "#1D6F42", color: "#fff", borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 12.5, fontWeight: 600 },
  clienteDel: { width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.25)", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1 },
  clienteAdd: { display: "flex", gap: 6, alignItems: "stretch" },
  clienteAddBtn: { padding: "8px 12px", background: "#1D6F42", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12.5, whiteSpace: "nowrap" },
  panelBtns: { display: "flex", gap: 8 },
  save: { flex: 1, padding: "11px", background: "#0B1A22", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14 },
  clear: { padding: "11px 16px", background: "#fff", color: "#C7511F", border: "1px solid #E7C3B4", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14 },
  cancel: { padding: "11px 16px", background: "#F2F5F7", color: "#3A4750", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnOff: { opacity: 0.45, cursor: "not-allowed" },
  overlay: { position: "fixed", inset: 0, background: "rgba(11,26,34,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto", zIndex: 100 },
  modal: { width: "min(560px, 96vw)", background: "#fff", borderRadius: 18, boxShadow: "0 20px 60px rgba(11,26,34,0.3)", padding: 22, marginBottom: 40 },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 18, fontWeight: 800, marginBottom: 4 },
  modalX: { width: 32, height: 32, borderRadius: 8, border: "none", background: "#F2F5F7", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "#3A4750" },
  modalHint: { fontSize: 13, color: "#5B6970", margin: "0 0 16px" },
  campo: { marginBottom: 14 },
  campoRow: { display: "flex", gap: 10, marginBottom: 14 },
  campoLbl: { display: "block", fontSize: 12, fontWeight: 700, color: "#0B1A22", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" },
  inputTime: { width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid #D3DBDF", borderRadius: 9, fontSize: 14, fontFamily: "inherit" },
  giornoChip: { minWidth: 42, height: 34, padding: "0 8px", borderRadius: 8, border: "1px solid #CFDDE3", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#3A4750" },
  giornoChipOn: { background: "#1E6E8C", color: "#fff", borderColor: "#1E6E8C" },
  anteprima: { padding: "10px 12px", background: "#F4F8FA", border: "1px solid #E1EBEF", borderRadius: 10, fontSize: 13, color: "#0B4A5E", marginBottom: 14 },
};

const globalCss = "\
  * { -webkit-tap-highlight-color: transparent; }\
  button:hover { filter: brightness(0.97); }\
  button:active { transform: scale(0.98); }\
  button:focus-visible { outline: 2px solid #1E6E8C; outline-offset: 2px; }\
";
