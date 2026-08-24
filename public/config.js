// Public Supabase project config. The anon key is designed to be public —
// it ships in every Supabase frontend's JS bundle by design. Row Level
// Security (see supabase/schema.sql) is what actually controls what it can
// read and write, not secrecy of this key. Never put the service_role key
// here.
window.CIVIC_TWIN_CONFIG = {
  supabaseUrl: 'https://dgshrqqorukpujngzmzo.supabase.co',
  supabaseAnonKey: 'sb_publishable_tTTX_OCUuXr9qgmMCiBtiA_YsVLjN-J',
  // TomTom Traffic Flow API — free-tier key, meant for client-side use
  // (same model as Google Maps keys). Restrict it by domain in the TomTom
  // developer dashboard so nobody else can burn the free 2,500 req/day
  // quota. Real per-road congestion; falls back to a time-of-day pattern
  // if this ever fails or the quota runs out.
  tomtomApiKey: 'fc64X9Ua16mrcRX9xPiSfT9MtbbVmP4B',
};
