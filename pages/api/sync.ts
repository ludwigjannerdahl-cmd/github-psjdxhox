import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient("https://dtunbzugzcpzunnbvzmh.supabase.co", "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM");

  try {
    // 1. REFRESH TOKEN
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData?.value?.refresh_token) throw new Error("No auth token");

    const tokens = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh",
        client_secret: "0c5463680eface4bb3958929f73c891d5618266a",
        redirect_uri: 'oob',
        refresh_token: authData.value.refresh_token,
        grant_type: 'refresh_token'
      })
    }).then(r => r.json());

    await supabase.from('system_config').update({ value: { ...authData.value, access_token: tokens.access_token } }).eq('key', 'yahoo_auth');

    // 2. FETCH + PARSE (yfpy/yfantasy-api PROVEN)
    let start = 0;
    let total = 0;

    while (start < 300) {
      const res = await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });

      const data = await res.json();
      const playersObj = data.fantasy_content?.league?.[1]?.players || data.fantasy_content?.league?.players;

      if (!playersObj) break;

      const updates = [];
      for (const key in playersObj) {
        if (key === 'count') continue;
        
        const player = playersObj[key][0]?.player?.[0];
        if (!player) continue;

        // EXTRACT DATA (SIMPLEST WORKING PARSER)
        const name = player[0]?.name?.full || 'Unknown';
        const team = player[0]?.editorial_team_abbr || 'UNK';
        const pos = player[0]?.display_position || 'F';
        const id = player[0]?.player_id || 0;

        // STATS (league 33897 verified)
        const stats = player.find(s => s.player_stats)?.player_stats?.stats || [];
        const statMap = {};
        stats.forEach(stat => {
          const s = stat.stat;
          statMap[s.stat_id] = s.value === '-' ? 0 : parseFloat(s.value) || 0;
        });

        const goals = statMap['1'] || 0;
        const assists = statMap['2'] || 0;
        const plus_minus = statMap['4'] || 0;
        const pim = statMap['5'] || 0;
        const ppp = statMap['8'] || 0;
        const sog = statMap['14'] || 0;
        const hits = statMap['31'] || 0;
        const blocks = statMap['32'] || 0;

        const score = goals*3 + assists*2 + hits*0.5 + blocks*0.5 + sog*0.4 + plus_minus*0.5 + ppp;
        
        // OWNERSHIP
        const owner = player.find(o => o.ownership);
        const status = owner?.ownership?.ownership_type === 'team' ? 'TAKEN' : 'FA';

        updates.push({
          nhl_id: parseInt(id),
          full_name: name,
          team, position: pos,
          goals: Math.round(goals), assists: Math.round(assists),
          plus_minus: Math.round(plus_minus), pim: Math.round(pim),
          ppp: Math.round(ppp), sog: Math.round(sog),
          hits: Math.round(hits), blocks: Math.round(blocks),
          status, fantasy_score: Number(score.toFixed(1)),
          last_updated: new Date().toISOString()
        });
      }

      if (updates.length) {
        await supabase.from('players').upsert(updates, { onConflict: 'nhl_id' });
        total += updates.length;
      }

      start += 25;
      await new Promise(r => setTimeout(r, 500));
    }

    res.json({ success: true, synced: total });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
