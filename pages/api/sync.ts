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
       value: { ...authData.value, access_token: newTokens.access_token }
    }).eq('key', 'yahoo_auth');

    // 3. THE LOOP: Fetch 300 Players
    let start = 0;
    const maxPlayers = 300; 
    let totalSynced = 0;

    while (start < maxPlayers) {
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        
        // --- STEP 3.1: FIND THE LEAGUE DATA ---
        const leagueNode = yahooData.fantasy_content?.league;
        let playersObj: any = null;
        
        if (Array.isArray(leagueNode)) {
            const nodeWithPlayers = leagueNode.find((n: any) => n.players);
            if (nodeWithPlayers) playersObj = nodeWithPlayers.players;
        } else if (leagueNode?.players) {
            playersObj = leagueNode.players;
        }

        if (!playersObj || Object.keys(playersObj).length === 0) break;

        const updates: any[] = [];

        for (const key in playersObj) {
            if (key === 'count') continue;
            
            const p = playersObj[key].player;
            
            // --- STEP 3.2: DEEP NESTED PARSING (The Fix) ---
            // Data structure: [ [Metadata Objects...], {Stats Object} ]
            
            // 1. Grab the Metadata Array (Index 0)
            const metaArray = Array.isArray(p[0]) ? p[0] : null;
            // 2. Grab the Stats Object (Index 1)
            const statsPayload = p[1];

            if (!metaArray) continue; // Skip if structure is weird

            // Find details inside the Metadata Array
            const nameNode = metaArray.find((i: any) => i.name);
            const teamNode = metaArray.find((i: any) => i.editorial_team_abbr);
            const positionNode = metaArray.find((i: any) => i.display_position);
            const ownershipNode = metaArray.find((i: any) => i.ownership);
            const idNode = metaArray.find((i: any) => i.player_id);

            if (!nameNode) continue; // Must have a name

            // Parse Stats
            const statMap: any = {};
            if (statsPayload?.player_stats?.stats) {
                statsPayload.player_stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);
            }

            // Stat IDs: 4=G, 5=A, 31=HIT, 32=BLK
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            // Determine Status
            const ownershipType = ownershipNode?.ownership?.ownership_type || 'freeagents';
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