import { createClient } from "@supabase/supabase-js";

// Connessione al database condiviso Piscina Cappuccini.
// Realtime disabilitato: la sincronizzazione avviene tramite ricaricamento
// periodico (ogni 15s), più affidabile su reti che bloccano i WebSocket.
const SUPABASE_URL = "https://xxazvlkxwjpdkjbkcmwm.supabase.co";
const SUPABASE_KEY = "sb_publishable_S9GUEr1Unb5c4lK4xbI8tQ_y9w1bvz1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 0 } },
  auth: { persistSession: false },
});

