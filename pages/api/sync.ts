import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- HARDCODED CONFIGURATION ---
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
  
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 
  // ------------------------------

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get Token from DB
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing! Run the SQL script first.");

    // 2. Refresh Yahoo Token
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
    if (newTokens.error) {
       // Log the specific error from Yahoo to help debug
       throw new Error(`Yahoo Refresh Failed: ${JSON.stringify(newTokens)}`);
    }

    // Save new token
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token, expires_at: Date.now() + 3600 * 1000 }
    }).eq('key', 'yahoo_auth');

    // 3. Fetch Yahoo "Taken" Players
    // We wrap this in a try/catch so if Yahoo fails, we still get the NHL stats
    const takenNames = new Set();
    try {
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;status=T;start=0;count=100?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        const yahooData = await yahooRes.json();
        const players = yahooData.fantasy_content?.league?.[1]?.players;
        
        if (players) {
            for (const key in players) {
                if (players[key].player) takenNames.add(players[key].player[0][2].name.full);
            }
        }
    } catch (e) { 
        console.warn("Yahoo roster fetch partial error (ignoring):", e); 
    }

    // 4. Fetch Official NHL Stats (FIXED: Using 'current' endpoint)
    const nhlRes = await fetch('https://api-web.nhle.com/v1/skater-stats-leaders/current?categories=goals&limit=200');
    
    if (!nhlRes.ok) throw new Error(`NHL API Error: ${nhlRes.status}`);
    
    const nhlData = await nhlRes.json();

    // SAFETY CHECK: Did we actually get skaters?
    if (!nhlData.skaters) {
        throw new Error("NHL API returned valid JSON but no 'skaters' list. Season might be inactive.");
    }

    // 5. Merge & Upsert
    const updates = nhlData.skaters.map((p: any) => {
       const fullName = `${p.firstName.default} ${p.lastName.default}`;
       const isTaken = takenNames.has(fullName);

       return {
         nhl_id: p.id,
         full_name: fullName,
         team: p.teamAbbrev,
         position: p.positionCode,
         goals: p.goals,
         assists: p.assists,
         points: p.points,
         plus_minus: p.plusMinus,
         hits: p.hits || 0,
         blocks: p.blockedShots || 0,
         status: isTaken ? 'TAKEN' : 'FA',
         fantasy_score: (p.goals * 3) + (p.assists * 2) + (p.hits * 0.5) + (p.blockedShots * 0.5),
         last_updated: new Date().toISOString()
       };
    });

    const { error } = await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
    if (error) throw error;

    res.status(200).json({ 
        success: true, 
        message: `Synced ${updates.length} players. Found ${takenNames.size} taken in Yahoo.` 
    });

  } catch (error: any) {
    // Return the actual error message to the screen so we can see it
    res.status(500).json({ error: error.message });
  }
}