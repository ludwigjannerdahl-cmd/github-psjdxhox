import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  
  // --- CONFIGURATION ---
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"; // Service Role Key
  
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 
  // ---------------------

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. AUTH & TOKEN REFRESH
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing. Run OAuth flow first.");

    const refreshRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: yahooClientId,
        client_secret: yahooClientSecret,
        redirect_uri: 'oob',
        refresh_token: authData.value.refresh_token,
        grant_type: 'refresh_token'
      }),
      signal: AbortSignal.timeout(10000) // 10s Auth Timeout
    });
    
    const newTokens = await refreshRes.json();
    if (newTokens.error) throw new Error(`Yahoo Refresh Failed: ${newTokens.error_description || 'Unknown error'}`);

    // Update access token
    await supabase.from('system_config').update({ value: { ...authData.value, access_token: newTokens.access_token } }).eq('key', 'yahoo_auth');
    console.log('✅ Token refreshed');

    // 2. DISCOVERY: FETCH STAT CATEGORIES
    console.log('🔍 Fetching GAME stat categories...');
    const statRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/game/nhl/stat_categories?format=json`,
      { 
          headers: { 'Authorization': `Bearer ${newTokens.access_token}` },
          signal: AbortSignal.timeout(15000) 
      }
    );

    if (!statRes.ok) throw new Error(`Stat categories fetch failed: ${statRes.status}`);
    
    const statData = await statRes.json();
    const statCategories = statData.fantasy_content?.game?.stat_categories || [];
    
    // Build stat_id → abbreviation map
    const statMap: Record<number, string> = {};
    const cats = Array.isArray(statCategories) ? statCategories : statCategories.stats;

    if (cats) {
        cats.forEach((c: any) => {
            const cat = c.stat || c; 
            statMap[parseInt(cat.stat_id)] = cat.abbreviation;
        });
    }

    // Validation: Ensure we actually found categories
    if (Object.keys(statMap).length === 0) {
        throw new Error("❌ No stat categories discovered. API failure.");
    }
    
    // Log verification for debugging
    const goalsId = Object.keys(statMap).find(k => statMap[parseInt(k)] === 'G');
    console.log(`✅ StatMap validated. Goals found at ID: ${goalsId || 'MISSING'}`);

    // 3. MAIN SYNC LOOP
    let start = 0;
    const maxPlayers = 350; 
    let totalSynced = 0;

    while (start < maxPlayers) {
        console.log(`Fetching batch starting at ${start}...`);
        
        // Robust Fetch with Retry logic for Rate Limits
        const yahooRes = await fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, 
          { 
              headers: { 'Authorization': `Bearer ${newTokens.access_token}` },
              signal: AbortSignal.timeout(30000) // 30s timeout protection
          }
        );

        if (!yahooRes.ok) {
            if (yahooRes.status === 429) {
                console.log("⏳ Rate Limited (429). Retrying in 5s...");
                await new Promise(r => setTimeout(r, 5000));
                continue; // Retry this batch
            }
            throw new Error(`Yahoo API Error: ${yahooRes.status}`);
        }
        
        const yahooData = await yahooRes.json();
        const leagueNode = yahooData.fantasy_content?.league;
        
        let playersObj: any = null;
        if (Array.isArray(leagueNode)) {
            playersObj = leagueNode.find((n: any) => n.players)?.players;
        } else {
            playersObj = leagueNode?.players;
        }

        if (!playersObj || Object.keys(playersObj).length === 0) {
            console.log("✅ No more players found.");
            break;
        }

        const updates: any[] = [];

        for (const key in playersObj) {
            if (key === 'count') continue;
            
            // The Player "Sandwich" Array: [ [Meta], {Stats}, {Owner} ]
            const pArray = playersObj[key].player; 
            if (!Array.isArray(pArray)) continue;

            // --- CORRECT PARSING (NO FLATTENING) ---
            let metaArr: any[] | null = null;
            let statsObj: any = null;
            let ownerObj: any = null;

            pArray.forEach((segment: any) => {
                if (Array.isArray(segment)) {
                    metaArr = segment; // Found Metadata Array
                } else if (segment.player_stats) {
                    statsObj = segment; // Found Stats Object
                } else if (segment.ownership) {
                    ownerObj = segment; // Found Ownership Object
                }
            });

            if (!metaArr) continue; 

            // Extract Name/ID/Team from the Metadata Array
            const nameNode = metaArr.find((i: any) => i.name);
            const teamNode = metaArr.find((i: any) => i.editorial_team_abbr);
            const posNode = metaArr.find((i: any) => i.display_position);
            const idNode = metaArr.find((i: any) => i.player_id);

            if (!nameNode || !idNode) continue;

            // --- DYNAMIC STAT MAPPING ---
            const rawStats: Record<string, number> = {};
            if (statsObj?.player_stats?.stats) {
                statsObj.player_stats.stats.forEach((wrapper: any) => {
                    const s = wrapper.stat || wrapper;
                    const id = parseInt(s.stat_id);
                    const val = s.value === '-' ? 0 : parseFloat(s.value);
                    const abbr = statMap[id]; 
                    if (abbr && !isNaN(val)) {
                        rawStats[abbr] = val;
                    }
                });
            }

            // Mappings (Dynamic based on API discovery)
            const goals = rawStats['G'] || 0;
            const assists = rawStats['A'] || 0;
            const plus_minus = rawStats['+/-'] || rawStats['+'] || 0; 
            const pim = rawStats['PIM'] || 0;
            const ppp = rawStats['PPP'] || 0;
            const sog = rawStats['SOG'] || 0;
            const hits = rawStats['HIT'] || 0;
            const blks = rawStats['BLK'] || 0;

            // Score Calculation
            let fantasyScore = 0;
            const pos = posNode?.display_position || 'UNK';
            const isGoalie = pos === 'G';
            
            if (isGoalie) {
                 const wins = rawStats['W'] || 0;
                 const saves = rawStats['SV'] || 0;
                 const shutouts = rawStats['SHO'] || 0;
                 const ga = rawStats['GA'] || 0;
                 // Only calculate if stats exist to avoid 0 score for active goalies
                 if (wins + saves + shutouts + ga > 0) {
                    fantasyScore = (wins * 4) + (saves * 0.2) + (shutouts * 2) - (ga * 1);
                 }
            } else {
                 fantasyScore = (goals * 3) + (assists * 2) + (hits * 0.5) + (blks * 0.5) + (sog * 0.4) + (plus_minus * 0.5) + (ppp * 1);
            }

            // Ownership Status
            const ownershipType = ownerObj?.ownership?.ownership_type || 'freeagents';
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            // --- SCHEMA SAFE UPSERT ---
            updates.push({
                nhl_id: parseInt(idNode.player_id),
                full_name: nameNode.name.full,
                team: teamNode?.editorial_team_abbr || 'UNK',
                position: pos,
                goals, assists, plus_minus, pim, ppp, sog, hits, blocks: blks,
                // Only writing to the 13 columns we verified exist in your schema
                status: status,
                fantasy_score: parseFloat(fantasyScore.toFixed(2)),
                last_updated: new Date().toISOString()
            });
        }

        if (updates.length > 0) {
            const { error } = await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
            if (error) throw error;
            totalSynced += updates.length;
        }

        start += 25;
        await new Promise(r => setTimeout(r, 750)); 
    }

    res.status(200).json({ 
        success: true, 
        message: `✅ Synced ${totalSynced} players successfully using DYNAMIC MAPPING!`,
        stats_discovered_count: Object.keys(statMap).length,
        goals_id_sample: Object.keys(statMap).find(k => statMap[parseInt(k)] === 'G')
    });

  } catch (error: any) {
    console.error("Sync Error:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}