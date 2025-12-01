import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- CONFIGURATION ---
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
  
  // Credentials
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 
  // ---------------------

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get & Refresh Token
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
    if (newTokens.error) throw new Error(`Yahoo Refresh Failed: ${JSON.stringify(newTokens)}`);

    // Save token
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token }
    }).eq('key', 'yahoo_auth');

    // 2. FETCH & PARSE LOOP
    let start = 0;
    const maxPlayers = 300; // Fetch top 300 owned players
    let totalSynced = 0;

    // We fetch in batches of 25 (Yahoo limit)
    while (start < maxPlayers) {
        
        // Critical: Request 'stats' AND 'ownership' explicitly
        const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`;
        
        const yahooRes = await fetch(url, { 
            headers: { 'Authorization': `Bearer ${newTokens.access_token}` } 
        });
        
        const yahooData = await yahooRes.json();
        
        // --- SENIOR DEV FIX: NORMALIZE THE DATA ---
        // 1. Drill down to the league node safely
        const leagueNode = yahooData.fantasy_content?.league;
        let rawPlayersNode = null;

        // 2. Find the 'players' node (it moves depending on response type)
        if (Array.isArray(leagueNode)) {
            rawPlayersNode = leagueNode.find((n: any) => n.players)?.players;
        } else {
            rawPlayersNode = leagueNode?.players;
        }

        // 3. Normalize the "Fake Array" (Object with numeric keys)
        const normalizedPlayers = normalizeYahooCollection(rawPlayersNode);

        if (normalizedPlayers.length === 0) {
            console.log(`No more players found at start index ${start}. Stopping.`);
            break;
        }

        const updates: any[] = [];

        for (const playerWrapper of normalizedPlayers) {
            // playerWrapper is the [ [metadata], {stats}, {ownership} ] structure
            const p = playerWrapper.player;
            if (!p) continue;

            // --- DEEP PARSING ---
            // We flat-map the nested structure to find the bits we need
            // The Yahoo player object is an array of disparate objects.
            const flatData = p.flat(); 
            
            const meta = flatData.find((i: any) => i.player_id !== undefined); // Has Name & Team
            const statsContainer = flatData.find((i: any) => i.player_stats);
            const ownerContainer = flatData.find((i: any) => i.ownership);

            if (!meta) continue;

            // Stats Parsing
            const statMap: any = {};
            if (statsContainer?.player_stats?.stats) {
                statsContainer.player_stats.stats.forEach((s: any) => {
                    statMap[s.stat_id] = s.value;
                });
            }

            // MAPPING (Standard Yahoo NHL IDs)
            // 4=Goals, 5=Assists, 31=Hits, 32=Blocks
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            // Status Logic
            const ownershipType = ownerContainer?.ownership?.ownership_type || 'freeagents';
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
        // Pause to respect rate limits
        await new Promise(r => setTimeout(r, 500)); 
    }

    res.status(200).json({ success: true, message: `Synced ${totalSynced} players successfully!` });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}

// --- HELPER: Turn Yahoo's "Fake Arrays" into Real Arrays ---
function normalizeYahooCollection(collection: any): any[] {
    if (!collection) return [];
    
    // If it's already an array, great (rare with Yahoo)
    if (Array.isArray(collection)) return collection;

    // Yahoo returns objects like { "0": {...}, "1": {...}, "count": 2 }
    // We filter out the "count" and just keep the numeric keys
    return Object.keys(collection)
        .filter(key => key !== 'count' && !isNaN(parseInt(key))) // Keep only numeric keys
        .map(key => collection[key]); // Extract the value
}