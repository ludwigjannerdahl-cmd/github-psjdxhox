import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- HARDCODED KEYS ---
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
    if (newTokens.error) throw new Error(`Yahoo Refresh Failed: ${JSON.stringify(newTokens)}`);

    // Save new token
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token, expires_at: Date.now() + 3600 * 1000 }
    }).eq('key', 'yahoo_auth');

    // 3. Fetch Top 100 Players from Yahoo (Looping 25 at a time)
    // We fetch "Actual Rank" (sort=AR) to get the best players first.
    let allPlayers: any[] = [];
    const batchSize = 25;
    
    // Fetch 4 batches (100 players total)
    for (let start = 0; start < 100; start += batchSize) {
        console.log(`Fetching Yahoo batch starting at ${start}...`);
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=${batchSize}/stats?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        const playersObj = yahooData.fantasy_content?.league?.[1]?.players;

        if (playersObj) {
            // Yahoo returns an object with keys "0", "1", ... "count". We need to parse it.
            Object.values(playersObj).forEach((p: any) => {
                if (p.player) allPlayers.push(p.player);
            });
        }
    }

    // 4. Transform Data for Database
    const updates = allPlayers.map((data) => {
        // Yahoo Data Structure is messy: [ [Metadata], {Stats} ]
        const meta = data[0]; 
        const statsObj = data[1]?.player_stats?.stats;

        // Helper to find stat value by ID
        const getStat = (id: string) => {
            const s = statsObj.find((x: any) => x.stat.stat_id === id);
            return s ? parseFloat(s.stat.value) || 0 : 0;
        };

        // Yahoo NHL Stat IDs: 
        // 1=G, 2=A, 3=Pts, 4=+/-, 5=PIM, 8=PPP, 14=SOG, 31=HIT, 32=BLK
        const goals = getStat("1");
        const assists = getStat("2");
        const hits = getStat("31");
        const blocks = getStat("32");

        // Calculate simple fantasy score
        const fantasyScore = (goals * 3) + (assists * 2) + (hits * 0.5) + (blocks * 0.5);

        return {
            nhl_id: parseInt(meta[1].player_id), // Yahoo uses the same ID as NHL usually
            full_name: meta[2].name.full,
            team: meta[6].editorial_team_abbr,
            position: meta[4].display_position,
            status: meta[3].ownership.ownership_type === 'team' ? 'TAKEN' : 'FA', // "team" means owned, "freeagents" means FA
            goals: goals,
            assists: assists,
            points: getStat("3"),
            plus_minus: getStat("4"),
            pim: getStat("5"),
            ppp: getStat("8"),
            sog: getStat("14"),
            hits: hits,
            blocks: blocks,
            fantasy_score: fantasyScore,
            last_updated: new Date().toISOString()
        };
    });

    // 5. Upsert to Supabase
    const { error } = await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
    if (error) throw error;

    res.status(200).json({ 
        success: true, 
        message: `Synced ${updates.length} players directly from Yahoo!`,
        sample_player: updates[0].full_name
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}