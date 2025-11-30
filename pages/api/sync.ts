import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- HARDCODED CONFIGURATION ---
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
  
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 
  // ---------------------

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
       throw new Error(`Yahoo Refresh Failed: ${JSON.stringify(newTokens)}`);
    }

    // Save new token
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token, expires_at: Date.now() + 3600 * 1000 }
    }).eq('key', 'yahoo_auth');

    // 3. Fetch Players Directly from Yahoo
    // We fetch "Top 25 Taken Players" to start. Yahoo limits us to 25 at a time.
    // 'status=A' means All players. 'sort=AR' means Actual Rank (Best players first).
    const yahooRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=0;count=25/stats?format=json`, 
      { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
    );
    
    const yahooData = await yahooRes.json();
    const playersObj = yahooData.fantasy_content?.league?.[1]?.players;

    if (!playersObj) throw new Error("Yahoo returned no players. Check League ID.");

    const updates: any[] = [];

    // Parse the complex Yahoo JSON structure
    for (const key in playersObj) {
        if (key === 'count') continue;
        
        const p = playersObj[key].player;
        const meta = p[0]; // Name, Team, Position
        const stats = p[1].player_stats; // The numbers
        const ownership = p[0].find((i: any) => i.ownership)?.ownership; // FA vs Team

        // Safely extract stats (Stat ID 4=Goals, 5=Assists, etc. - mapping varies by league)
        // For simplicity, we grab the raw stats array
        const statMap: any = {};
        stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);

        // Standard Yahoo Stat IDs: 4=G, 5=A, 14=PIM, 31=HIT, 32=BLK (Check your league settings!)
        // Assuming standard mapping for now:
        const goals = parseInt(statMap['4'] || '0');
        const assists = parseInt(statMap['5'] || '0');
        const hits = parseInt(statMap['31'] || '0');
        const blks = parseInt(statMap['32'] || '0');

        updates.push({
            nhl_id: parseInt(meta[1].player_id), // Use Yahoo ID as primary
            full_name: meta[2].name.full,
            team: meta[6].editorial_team_abbr,
            position: meta[10].display_position,
            goals: goals,
            assists: assists,
            hits: hits,
            blocks: blks,
            status: ownership?.ownership_type === 'freeagents' ? 'FA' : 'TAKEN',
            fantasy_score: (goals * 3) + (assists * 2) + (hits * 0.5) + (blks * 0.5),
            last_updated: new Date().toISOString()
        });
    }

    const { error } = await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
    if (error) throw error;

    res.status(200).json({ 
        success: true, 
        message: `Synced ${updates.length} players purely from Yahoo!`,
        sample_player: updates[0].full_name
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}