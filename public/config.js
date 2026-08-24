// Public Supabase project config. The anon key is designed to be public —
// it ships in every Supabase frontend's JS bundle by design. Row Level
// Security (see supabase/schema.sql) is what actually controls what it can
// read and write, not secrecy of this key. Never put the service_role key
// here.
window.CIVIC_TWIN_CONFIG = {
  supabaseUrl: 'https://dgshrqqorukpujngzmzo.supabase.co',
  supabaseAnonKey: 'sb_publishable_tTTX_OCUuXr9qgmMCiBtiA_YsVLjN-J',
};
