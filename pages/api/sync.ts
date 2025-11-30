import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- CONFIGURATION ---
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 
  // ---------------------

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get & Refresh Token
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) return res.status(500).json({ error: "Auth token missing." });

    const refreshRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: yahooClientId,
        client_secret: yahooClientSecret,
        redirect_uri: 'oob',
        refresh_token: authData.value.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    
    const newTokens = await refreshRes.json();
    if (newTokens.error) return res.status(500).json({ error: "Refresh Failed", details: newTokens });

    // Save token
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token }
    }).eq('key', 'yahoo_auth');

    // 2. THE X-RAY FETCH
    // We fetch just 1 player to keep the output small and readable
    const yahooRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=0;count=1/stats?format=json`, 
      { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
    );
    
    const yahooData = await yahooRes.json();

    // 3. DUMP THE RAW DATA
    // This will print the exact structure to your browser window
    return res.status(200).json({ 
        debug_mode: true,
        yahoo_response: yahooData 
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}