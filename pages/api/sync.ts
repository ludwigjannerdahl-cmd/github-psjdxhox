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
        
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
        );
        
        const yahooData = await yahooRes.json();
        
        // --- PARSER ---
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
            
            const p = playersObj[key].player; // This is the Array [ {Meta}, {Stats}, {Owner?} ]
            
            // --- THE FINAL FIX: SMART LOOP ---
            // Don't guess indexes. Find the objects by their keys.
            let metaObj: any = null;
            let statsObj: any = null;
            let ownerObj: any = null;

            if (Array.isArray(p)) {
                p.forEach((item: any) => {
                    if (Array.isArray(item)) {
                        // Metadata is often wrapped in another array inside the main array
                        const subName = item.find((sub: any) => sub.name);
                        if (subName) metaObj = item;
                    } else if (item.player_stats) {
                        statsObj = item;
                    } else if (item.ownership) {
                        ownerObj = item;
                    } else if (item.name) {
                        // Sometimes metadata is just a raw object
                        metaObj = [item]; 
                    }
                });
            }

            // Fallback: If looping failed, try the find method on the flat array
            if (!metaObj) metaObj = p.find((i: any) => Array.isArray(i) && i.find((sub:any) => sub.name));
            if (!statsObj) statsObj = p.find((i: any) => i.player_stats);
            if (!ownerObj) ownerObj = p.find((i: any) => i.ownership);

            // Need at least name and stats
            if (!metaObj) continue;

            // Extract Meta Details
            const nameNode = metaObj.find((i: any) => i.name);
            const teamNode = metaObj.find((i: any) => i.editorial_team_abbr);
            const positionNode = metaObj.find((i: any) => i.display_position);
            const idNode = metaObj.find((i: any) => i.player_id);

            // Extract Stats
            const map: any = {};
            if (statsObj?.player_stats?.stats) {
                statsObj.player_stats.stats.forEach((wrapper: any) => {
                    const s = wrapper.stat; 
                    const val = s.value === '-' ? 0 : parseFloat(s.value);
                    map[s.stat_id] = isNaN(val) ? 0 : val;
                });
            }

            // --- STAT MAPPING (Adrian Kempe Verified) ---
            const position = positionNode?.display_position || 'F';
            const isGoalie = position === 'G';

            let stats = {};
            let score = 0;

            if (isGoalie) {
                const wins = map['19'] || 0;
                const saves = map['26'] || 0;
                const shutouts = map['28'] || 0;
                const ga = map['22'] || 0;
                score = (wins * 4) + (saves * 0.2) + (shutouts * 2) - (ga * 1);
                stats = { wins, saves, shutouts, goals_against: ga, goals: 0, assists: 0, hits: 0, blocks: 0 };
            } else {
                const goals = map['1'] || 0;      
                const assists = map['2'] || 0;    
                const plus_minus = map['4'] || 0; 
                const pim = map['5'] || 0;        
                const ppp = map['8'] || 0;        
                const sog = map['14'] || 0;       
                const hits = map['31'] || 0;      
                const blks = map['32'] || 0;      

                score = (goals * 3) + (assists * 2) + (hits * 0.5) + (blks * 0.5) + (sog * 0.4) + (plus_minus * 0.5) + (ppp * 1);
                stats = { goals, assists, plus_minus, pim, ppp, sog, hits, blocks: blks };
            }

            // Status Logic
            const ownershipType = ownerObj?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            updates.push({
                nhl_id: parseInt(idNode?.player_id), 
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

    res.status(200).json({ 
        success: true, 
        message: `Synced ${totalSynced} players with SMART PARSING!`
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}