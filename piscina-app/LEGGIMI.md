# Piscina Cappuccini — versione ONLINE condivisa (v2)

App collegata a un database condiviso (Supabase): tutte le modifiche si
sincronizzano in tempo reale tra tutti i dispositivi collegati.

## Due livelli di accesso

All'apertura viene chiesta una password:
- Password AMMINISTRATORE: gestisce tutto (corsie, programmazione, backup, import).
- Password STAFF: può inserire e modificare SOLO i clienti privati; vede il resto.

Le password si trovano/cambiano nel file `src/App.jsx` (righe PWD_ADMIN e PWD_STAFF).

## Provare in locale (sul tuo computer)

1. Apri il Prompt nella cartella del progetto (barra indirizzi -> cmd -> Invio)
2. Solo la prima volta:  npm install
3. Ogni volta:           npm run dev
   L'app si apre su http://localhost:5173

## Pubblicazione online (per l'accesso dei colleghi)

La pubblicazione su internet si fa con Vercel (passo guidato separato).
Una volta pubblicata, avrai un link da aprire su qualsiasi telefono/PC,
senza installare nulla.

## Dati

I dati vivono nel database Supabase del progetto "piscina-cappuccini".
Il file src/supabase.js contiene l'indirizzo e la chiave pubblica di collegamento.

## Clienti privati

Il tipo "Cliente privato" (verde) ha un campo per il nome. Lo staff sceglie
corsia + orario + nome, come per le altre attività. Nella griglia compare
il nome del cliente.
