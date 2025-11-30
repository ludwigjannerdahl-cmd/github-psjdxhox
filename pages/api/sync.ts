import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

// --- CONFIGURATION ---
const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
const leagueId = "33897"; 

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: Calculate Percentile Rank
function getPercentileRank(array: number[], value: number) {
  if (array.length === 0) return 0;
  const smallerCount = array.filter(v => v < value).length;
  return (smallerCount / array.length) * 100;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1. Get & Refresh Token (Same as before)
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
    const tokens = await refreshRes.json();
    if (tokens.error) throw new Error("Yahoo Refresh Failed");

    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: tokens.access_token }
    }).eq('key', 'yahoo_auth');

    // 2. Fetch ALL Players (Looping to get ~200-300 relevant players)
    // We fetch a larger batch to build a proper statistical population
    const yahooRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=0;count=100/stats?format=json`, 
      { headers: { 'Authorization': `Bearer ${tokens.access_token}` } }
    );
    const yahooData = await yahooRes.json();
    const playersObj = yahooData.fantasy_content?.league?.[1]?.players;

    if (!playersObj) throw new Error("Yahoo returned no players.");

    let rawPlayers: any[] = [];

    // 3. Parse Raw Data
    for (const key in playersObj) {
        if (key === 'count') continue;
        const p = playersObj[key].player;
        const meta = p[0];
        const stats = p[1].player_stats;
        const ownership = p[0].find((i: any) => i.ownership)?.ownership;

        const statMap: any = {};
        stats.stats.forEach((s: any) => statMap[s.stat_id] = parseFloat(s.value) || 0);

        rawPlayers.push({
            nhl_id: parseInt(meta[1].player_id),
            full_name: meta[2].name.full,
            team: meta[6].editorial_team_abbr,
            position: meta[10].display_position,
            status: ownership?.ownership_type === 'freeagents' ? 'FA' : 'TAKEN',
            // Raw Stats
            goals: statMap['4'] || 0,
            assists: statMap['5'] || 0,
            plus_minus: statMap['9'] || 0, // Check your league ID for +/-
            pim: statMap['14'] || 0,
            ppp: statMap['25'] || 0, // Check league ID
            sog: statMap['31'] || 0,
            hits: statMap['32'] || 0, // ID might vary
            blocks: statMap['33'] || 0, // ID might vary
            last_updated: new Date().toISOString()
        });
    }

    // 4. THE NORDIC ENGINE: Calculate Percentiles
    // Extract arrays for every category to compare against
    const goalsArr = rawPlayers.map(p => p.goals);
    const assistsArr = rawPlayers.map(p => p.assists);
    const hitsArr = rawPlayers.map(p => p.hits);
    const blocksArr = rawPlayers.map(p => p.blocks);
    const sogArr = rawPlayers.map(p => p.sog);
    const pppArr = rawPlayers.map(p => p.ppp);

    const finalPlayers = rawPlayers.map(p => {
        // Calculate Percentile (0-100) for each category
        const p_goals = getPercentileRank(goalsArr, p.goals);
        const p_assists = getPercentileRank(assistsArr, p.assists);
        const p_hits = getPercentileRank(hitsArr, p.hits);
        const p_blocks = getPercentileRank(blocksArr, p.blocks);
        const p_sog = getPercentileRank(sogArr, p.sog);
        const p_ppp = getPercentileRank(pppArr, p.ppp);

        // The "Overall Score" (Average of percentiles)
        // You can weight this! (e.g. Goals * 1.2)
        const overall = (p_goals + p_assists + p_hits + p_blocks + p_sog + p_ppp) / 6;

        return {
            ...p,
            fantasy_score: parseFloat(overall.toFixed(1)), // 0-100 Score
            x_score: parseFloat((overall * 1.1).toFixed(1)) // Mock xScore for now
        };
    });

    // 5. Upsert to DB
    const { error } = await supabase.from('players').upsert(finalPlayers, { onConflict: 'nhl_id' });
    if (error) throw error;

    res.status(200).json({ success: true, count: finalPlayers.length });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}