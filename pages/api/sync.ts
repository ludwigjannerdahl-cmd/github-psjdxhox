import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- CONFIGURATION ---
  // I extracted these from your screenshots:
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

    // 3. THE LOOP: Fetch 300 Players
    // We request 'stats' AND 'ownership' in one call.
    let start = 0;
    const maxPlayers = 300; 
    let totalSynced = 0;

    while (start < maxPlayers) {
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        const playersObj = yahooData.fantasy_content?.league?.[1]?.players;

        if (!playersObj || Object.keys(playersObj).length === 0) break;

        const updates: any[] = [];

        // Iterate over the numeric keys ("0", "1", "2"...)
        for (const key in playersObj) {
            if (key === 'count') continue;
            
            const p = playersObj[key].player;
            
            // --- THE CORRECT PARSING LOGIC (THE FIX) ---
            // p[0] is an ARRAY containing Metadata (Name, Team)
            // p[1] is an OBJECT containing Stats
            // p[2] is an OBJECT containing Ownership (sometimes)
            
            const metaArray = p[0]; 
            // We search the rest of the array for stats and ownership objects
            const statsObj = p.find((i: any) => i.player_stats);
            const ownerObj = p.find((i: any) => i.ownership);

            if (!Array.isArray(metaArray)) continue;

            // 1. Find Name & Info inside the first array
            const nameNode = metaArray.find((i: any) => i.name);
            const teamNode = metaArray.find((i: any) => i.editorial_team_abbr);
            const positionNode = metaArray.find((i: any) => i.display_position);
            const idNode = metaArray.find((i: any) => i.player_id);

            if (!nameNode) continue;

            // 2. Extract Stats
            const statMap: any = {};
            if (statsObj?.player_stats?.stats) {
                statsObj.player_stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);
            }

            // Yahoo Stat Mapping: 4=G, 5=A, 31=HIT, 32=BLK (Standard)
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            // 3. Extract Ownership
            const ownershipType = ownerObj?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            updates.push({
                nhl_id: parseInt(idNode?.player_id || '0'),
                full_name: nameNode.name.full,
                team: teamNode?.editorial_team_abbr || 'UNK',
                position: positionNode?.display_position || 'F',
                goals, assists, hits, blocks: blks,
                status: status,
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