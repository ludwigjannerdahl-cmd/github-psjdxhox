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
    // 1. Get Token
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing!");

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
    if (newTokens.error) throw new Error("Yahoo Refresh Failed");

    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token }
    }).eq('key', 'yahoo_auth');

    // 2. THE LOOP: Fetch 300 Players
    let start = 0;
    const maxPlayers = 300; 
    let totalSynced = 0;

    while (start < maxPlayers) {
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        const playersObj = yahooData.fantasy_content?.league?.[1]?.players;

        if (!playersObj || Object.keys(playersObj).length === 0) break;

        const updates: any[] = [];

        for (const key in playersObj) {
            if (key === 'count') continue;
            
            const p = playersObj[key].player;
            
            // --- ROBUST PARSING (The Fix) ---
            // Yahoo returns an array of objects. We must FIND the right ones.
            const metaObj = p.find((i: any) => i.name); // Find object with name
            const statsObj = p.find((i: any) => i.player_stats); // Find object with stats
            const ownerObj = p.find((i: any) => i.ownership); // Find object with ownership
            
            if (!metaObj || !statsObj) continue; // Skip if bad data

            const stats = statsObj.player_stats;
            const meta = metaObj;
            
            const statMap: any = {};
            if (stats && stats.stats) {
                stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);
            }

            // Yahoo Stats IDs: 4=G, 5=A, 31=HIT, 32=BLK
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            updates.push({
                nhl_id: parseInt(meta.player_id),
                full_name: meta.name.full,
                team: meta.editorial_team_abbr,
                position: meta.display_position,
                goals, assists, hits, blocks: blks,
                status: ownerObj?.ownership?.ownership_type === 'freeagents' ? 'FA' : 'TAKEN',
                fantasy_score: (goals * 3) + (assists * 2) + (hits * 0.5) + (blks * 0.5),
                last_updated: new Date().toISOString()
            });
        }

        if (updates.length > 0) {
            await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
            totalSynced += updates.length;
        }

        start += 25;
        await new Promise(r => setTimeout(r, 500)); 
    }

    res.status(200).json({ success: true, message: `Synced ${totalSynced} players successfully!` });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}