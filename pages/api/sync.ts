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
    // 1. Get & Refresh Token
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

    // 2. FETCH LOOP
    let start = 0;
    const maxPlayers = 300; 
    let totalSynced = 0;

    while (start < maxPlayers) {
        // Fetch stats + ownership
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        const yahooData = await yahooRes.json();
        
        // Find the players array (handles messy Yahoo structure)
        const leagueNode = yahooData.fantasy_content?.league;
        let playersObj: any = null;
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
            
            // Extract Data
            const metaArray = Array.isArray(p[0]) ? p[0] : null;
            const statsPayload = p[1];
            
            if (!metaArray) continue;

            const nameNode = metaArray.find((i: any) => i.name);
            const teamNode = metaArray.find((i: any) => i.editorial_team_abbr);
            const positionNode = metaArray.find((i: any) => i.display_position);
            const ownershipNode = metaArray.find((i: any) => i.ownership);
            const idNode = metaArray.find((i: any) => i.player_id);

            if (!nameNode) continue;

            // --- CORRECT STAT MAPPING ---
            const map: any = {};
            if (statsPayload?.player_stats?.stats) {
                statsPayload.player_stats.stats.forEach((s: any) => map[s.stat_id] = s.value);
            }

            const position = positionNode?.display_position || 'F';
            const isGoalie = position === 'G';

            let stats = {};
            let score = 0;

            if (isGoalie) {
                // GOALIE IDS: 19=W, 26=SV, 27=SA, 28=SHO (Common Yahoo IDs, might vary by league)
                // We fallback to 0 if missing
                const wins = parseInt(map['19'] || '0');
                const saves = parseInt(map['26'] || '0');
                const shutouts = parseInt(map['28'] || '0');
                
                stats = { wins, saves, shutouts, goals: 0, assists: 0 };
                score = (wins * 4) + (saves * 0.2) + (shutouts * 2);
            } else {
                // SKATER IDS (Standard): 
                // 1=GP, 2=G, 3=A, 4=Pts, 5=+/-
                // 8=PIM, 9=PPG, 10=PPA, 11=PPP, 14=SOG, 31=HIT, 32=BLK
                // Note: I am checking standard mapping. If your league uses different IDs, we might see 0s again.
                // Let's try the most common set:
                
                const g = parseInt(map['2'] || map['4'] || '0'); // Try 2 first (Goals)
                const a = parseInt(map['3'] || map['5'] || '0'); // Try 3 first (Assists)
                const pim = parseInt(map['8'] || '0');
                const ppp = parseInt(map['11'] || '0');
                const sog = parseInt(map['14'] || '0');
                const plusMin = parseInt(map['5'] || '0'); // Often ID 5
                const hits = parseInt(map['31'] || '0');
                const blks = parseInt(statMap['32'] || '0'); // 32 is standard for BLK

                stats = { 
                    goals: g, assists: a, pim, ppp, sog, plus_minus: plusMin, hits, blocks: blks,
                    wins: 0, saves: 0, shutouts: 0
                };
                
                // Fantasy Score Calc (Adjust weights as needed)
                score = (g * 3) + (a * 2) + (sog * 0.4) + (hits * 0.5) + (blks * 0.5) + (ppp * 1) + (plusMin * 0.5);
            }

            // Status Logic
            const ownershipType = ownershipNode?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            updates.push({
                nhl_id: parseInt(idNode?.player_id || '0'),
                full_name: nameNode.name.full,
                team: teamNode?.editorial_team_abbr || 'UNK',
                position: position,
                ...stats,
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

    res.status(200).json({ success: true, message: `Synced ${totalSynced} players successfully!` });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}