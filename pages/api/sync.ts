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
    let debugInfo = "";

    while (start < maxPlayers) {
        
        // Fetch from Yahoo
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();

        // --- THE "BLOODHOUND" SEARCH ---
        // We look for the 'league' object first
        const leagueNode = yahooData.fantasy_content?.league;
        
        // If leagueNode is an array (sometimes it is), find the one with 'players'
        let playersContainer = null;
        
        if (Array.isArray(leagueNode)) {
            const nodeWithPlayers = leagueNode.find((n: any) => n.players);
            if (nodeWithPlayers) playersContainer = nodeWithPlayers.players;
        } else if (leagueNode?.players) {
            playersContainer = leagueNode.players;
        }

        // If we found the container, we need to extract the actual list
        // Yahoo returns: { "0": {...}, "1": {...}, "count": 25 }
        if (!playersContainer || Object.keys(playersContainer).length === 0) {
             if (start === 0) {
                 // Save the structure to debugInfo so we can see what went wrong
                 debugInfo = JSON.stringify(leagueNode, null, 2); 
                 break; 
             }
             break; // Just stop if we run out of pages
        }

        const updates: any[] = [];

        // Iterate over the numbered keys ("0", "1", "2"...)
        for (const key in playersContainer) {
            if (key === 'count') continue; // Skip the count property
            
            const pData = playersContainer[key].player;
            if (!Array.isArray(pData)) continue; // Safety check

            // --- SMART PARSING ---
            // We search the array for the specific chunks of data we need
            
            // 1. Metadata (Name, Team, ID) -> Look for 'player_key'
            const meta = pData.find((x: any) => x.player_key !== undefined);
            
            // 2. Stats -> Look for 'player_stats'
            const statsContainer = pData.find((x: any) => x.player_stats !== undefined);
            
            // 3. Ownership -> Look for 'ownership'
            const ownerContainer = pData.find((x: any) => x.ownership !== undefined);

            // If we lack basic data, skip this player
            if (!meta || !meta.name) continue;

            // Extract Stats
            const statMap: any = {};
            if (statsContainer?.player_stats?.stats) {
                statsContainer.player_stats.stats.forEach((s: any) => statMap[s.stat_id] = s.value);
            }

            // Stat IDs (Standard Yahoo): 4=G, 5=A, 31=HIT, 32=BLK
            const goals = parseInt(statMap['4'] || '0');
            const assists = parseInt(statMap['5'] || '0');
            const hits = parseInt(statMap['31'] || '0');
            const blks = parseInt(statMap['32'] || '0');

            // Extract Ownership
            const ownershipType = ownerContainer?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            updates.push({
                nhl_id: parseInt(meta.player_id),
                full_name: meta.name.full,
                team: meta.editorial_team_abbr || 'UNK',
                position: meta.display_position || 'F',
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
        // Pause to be kind to Yahoo API
        await new Promise(r => setTimeout(r, 500)); 
    }

    if (totalSynced === 0) {
        return res.status(200).json({ 
            success: false, 
            message: "Connected to Yahoo but found 0 players.",
            debug_structure: debugInfo ? JSON.parse(debugInfo) : "No league node found"
        });
    }

    res.status(200).json({ success: true, message: `Synced ${totalSynced} players successfully!` });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}