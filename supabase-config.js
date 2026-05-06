// supabase-config.js
const SUPABASE_URL = 'https://mcjpyefvxurclodylynk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1janB5ZWZ2eHVyY2xvZHlseW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTU2MTQsImV4cCI6MjA5MzU3MTYxNH0.2gsKjxu2ncynTzYa1fC9wAr8HUguuaLbgsUYGFjCNfo';

if (SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE') {
  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn("Supabase is not configured yet. Running in local test mode.");
}
