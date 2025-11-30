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
    // 1. Auth & Refresh
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing! Run the SQL script first.");

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
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        
        // --- SENIOR DEV FIX: RECURSIVE FINDER ---
        // Instead of guessing the path (league[1].players), we hunt for it.
        const playersCollection = findKey(yahooData, 'players');

        // Check if we found valid data
        if (!playersCollection || Object.keys(playersCollection).length === 0 || (Object.keys(playersCollection).length === 1 && playersCollection.count)) {
             if (start === 0) {
                 // If we find NOTHING on the first try, dump the structure to debug
                 return res.status(200).json({ 
                    error: "Could not find 'players' data node.", 
                    debug_dump: JSON.stringify(yahooData).substring(0, 1000) 
                });
             }
             break; // Done fetching
        }

        const updates: any[] = [];

        for (const key in playersCollection) {
            if (key === 'count') continue; // Skip the metadata key
            
            const p = playersCollection[key].player;
            if (!p) continue; // Skip malformed entries

            // --- ROBUST PARSING ---
            // Find the components regardless of their array index
            const metaObj = p.find((i: any) => i.name);
            const statsObj = p.find((i: any) => i.player_stats);
            const ownerObj = p.find((i: any) => i.ownership);
            
            if (!metaObj || !statsObj) continue;

            const stats = statsObj.player_stats;
            const meta = metaObj;
            
            const statMap: any = {};
            if (stats && stats.stats) {
                stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);
            }

            // Stat IDs: 4=G, 5=A, 31=HIT, 32=BLK
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            // Status Logic
            const ownershipType = ownerObj?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            updates.push({
                nhl_id: parseInt(meta.player_id),
                full_name: meta.name.full,
                team: meta.editorial_team_abbr,
                position: meta.display_position,
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

// --- HELPER FUNCTION: THE HUNTER ---
// Recursively searches a JSON object to find a key named 'targetKey'
function findKey(obj: any, targetKey: string): any {
    if (!obj || typeof obj !== 'object') return null;
    if (obj[targetKey]) return obj[targetKey];

    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const result = findKey(obj[key], targetKey);
            if (result) return result;
        }
    }
    return null;
}