import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient("https://dtunbzugzcpzunnbvzmh.supabase.co", "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM");

  try {
    // 1. TOKEN REFRESH (NO AbortSignal)
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

    await supabase.from('system_config').update({ 
      value: { ...authData.value, access_token: tokens.access_token } 
    }).eq('key', 'yahoo_auth');

    // 2. SYNC LOOP - NO AbortSignal, NO .count PROPERTY
    let start = 0;
    let totalSynced = 0;

    while (start < 350) {
      const yahooRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`,
        { headers: { 'Authorization': `Bearer ${tokens.access_token}` } }
      );

      const yahooData = await yahooRes.json();
      const leagueNode = yahooData.fantasy_content?.league;
      
      let playersObj = null;
      if (Array.isArray(leagueNode)) {
        playersObj = leagueNode.find((n: any) => n.players)?.players;
      } else {
        playersObj = leagueNode?.players;
      }

      // **NO .count PROPERTY - TYPE SAFE**
      if (!playersObj || Object.keys(playersObj).length === 0) break;

      const updates = [];
      
      for (const key in playersObj) {
        if (key === 'count') continue;
        
        const playerData = playersObj[key].player;
        if (!Array.isArray(playerData)) continue;

        let metaObj = null, statsObj = null, ownerObj = null;
        
        playerData.forEach((item: any) => {
          if (Array.isArray(item) && item.find((sub: any) => sub.name)) {
            metaObj = item;
          } else if (item.player_stats) {
            statsObj = item;
          } else if (item.ownership) {
            ownerObj = item;
          }
        });

        if (!metaObj) continue;

        const nameNode = metaObj.find((i: any) => i.name);
        const teamNode = metaObj.find((i: any) => i.editorial_team_abbr);
        const posNode = metaObj.find((i: any) => i.display_position);
        const idNode = metaObj.find((i: any) => i.player_id);

        if (!nameNode?.name?.full || !idNode?.player_id) continue;

        // HARD CODED STAT IDs (league 33897 verified)
        const stats: Record<string, number> = {};
        if (statsObj?.player_stats?.stats) {
          statsObj.player_stats.stats.forEach((wrapper: any) => {
            const s = wrapper.stat;
            stats[s.stat_id] = s.value === '-' ? 0 : parseFloat(s.value) || 0;
          });
        }

        const goals = stats['1'] || 0;
        const assists = stats['2'] || 0;
        const plus_minus = stats['4'] || 0;
        const pim = stats['5'] || 0;
        const ppp = stats['8'] || 0;
        const sog = stats['14'] || 0;
        const hits = stats['31'] || 0;
        const blocks = stats['32'] || 0;

        const score = goals*3 + assists*2 + hits*0.5 + blocks*0.5 + sog*0.4 + plus_minus*0.5 + ppp*1;
        const status = ownerObj?.ownership?.ownership_type === 'team' ? 'TAKEN' : 'FA';

        updates.push({
          nhl_id: parseInt(idNode.player_id),
          full
