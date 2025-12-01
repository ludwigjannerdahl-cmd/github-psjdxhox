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
    // 1. Auth
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing.");

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

    // 2. FETCH LOOP (Top 100 players for speed test)
    // We fetch 'stats' to get the numbers
    let start = 0;
    const maxPlayers = 100; 
    let totalSynced = 0;
    let sampleStats = {}; // To debug what IDs we are getting

    while (start < maxPlayers) {
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        
        // --- PARSER ---
        const leagueNode = yahooData.fantasy_content?.league;
        let playersObj: any = null;
        
        // Smart Find
        if (Array.isArray(leagueNode)) {
            playersObj = leagueNode.find((n: any) => n.players)?.players;
        } else {
            playersObj = leagueNode?.players;
        }

        if (!playersObj || Object.keys(playersObj).length === 0) break;

        const updates: any[] = [];

        for (const key in playersObj) {
            if (key === 'count') continue;
            
            const p = playersObj[key].player;
            
            // Yahoo Structure: [ [Metadata...], {Stats} ]
            const metaArray = Array.isArray(p[0]) ? p[0] : null;
            const statsPayload = p[1];

            if (!metaArray) continue;

            const nameNode = metaArray.find((i: any) => i.name);
            const teamNode = metaArray.find((i: any) => i.editorial_team_abbr);
            const positionNode = metaArray.find((i: any) => i.display_position);
            const ownershipNode = metaArray.find((i: any) => i.ownership);
            const idNode = metaArray.find((i: any) => i.player_id);

            if (!nameNode) continue;

            // --- STATS PARSING ---
            const map: any = {};
            if (statsPayload?.player_stats?.stats) {
                statsPayload.player_stats.stats.forEach((s: any) => {
                    // Convert value to number immediately, handle '-' as 0
                    const val = s.value === '-' ? 0 : parseFloat(s.value);
                    map[s.stat_id] = isNaN(val) ? 0 : val;
                });
            }

            // Capture first player's stats for debugging
            if (totalSynced === 0) sampleStats = map;

            // MAPPING (Standard Yahoo)
            // If these are 0, your league uses different IDs. We will see in the debug output.
            const goals = map['4'] || 0;
            const assists = map['5'] || 0;
            const plus_minus = map['1'] || 0; // Check debug output for correct ID
            const pim = map['9'] || 0;
            const ppp = map['12'] || 0;
            const sog = map['14'] || 0;
            const hits = map['31'] || 0;
            const blks = map['32'] || 0;

            // Status Logic
            const ownershipType = ownershipNode?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            // Z-Score (Simplified for now)
            const score = (goals * 3) + (assists * 2) + (hits * 0.5) + (blks * 0.5) + (sog * 0.4);

            updates.push({
                nhl_id: parseInt(idNode?.player_id), // Storing Yahoo ID here
                full_name: nameNode.name.full,
                team: teamNode?.editorial_team_abbr || 'UNK',
                position: positionNode?.display_position || 'F',
                goals, assists, hits, blocks: blks,
                pim, ppp, sog, plus_minus,
                status: status,
                fantasy_score: score,
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

    res.status(200).json({ 
        success: true, 
        message: `Synced ${totalSynced} players.`,
        debug_stat_map: sampleStats // THIS WILL TELL US THE REAL IDs
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}