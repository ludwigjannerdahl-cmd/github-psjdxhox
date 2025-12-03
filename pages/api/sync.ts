import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
  const supabaseKey = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM";
  const yahooClientId = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
  const yahooClientSecret = "0c5463680eface4bb3958929f73c891d5618266a";
  const leagueId = "33897"; 

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // AUTH
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData || !authData.value || !authData.value.refresh_token) {
      throw new Error("Yahoo auth token missing");
    }

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
    
    const newTokens: any = await refreshRes.json();
    if (newTokens.error) throw new Error("Yahoo Refresh Failed");

    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: newTokens.access_token }
    }).eq('key', 'yahoo_auth');

    // SYNC ALL PLAYERS
    let start = 0;
    let totalSynced = 0;

    while (start < 300) {
      const yahooRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`,
        { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
      );
      
      const yahooData: any = await yahooRes.json();
      const leagueNode: any = yahooData.fantasy_content?.league;
      
      // TYPE-SAFE PLAYERS EXTRACTION - NO 'count' PROPERTY
      let playersObj: any = null;
      if (Array.isArray(leagueNode)) {
        const leagueWithPlayers = leagueNode.find((node: any) => (node as any).players);
        playersObj = leagueWithPlayers ? (leagueWithPlayers as any).players : null;
      } else {
        playersObj = leagueNode ? leagueNode.players : null;
      }

      // **TYPE SAFE EXIT** - Never access .count
      const playerKeys = playersObj ? Object.keys(playersObj) : [];
      if (playerKeys.length === 0 || playerKeys[0] === 'count') {
        break;
      }

      const updates: any[] = [];

      // PROCESS BATCH
      for (const key in playersObj) {
        if (key === 'count') continue;
        
        const p = (playersObj as any)[key].player;
        if (!Array.isArray(p)) continue;

        // PARSER (MacKinnon fix)
        let metaObj: any = null;
        let statsObj: any = null;
        let ownerObj: any = null;

        p.forEach((item: any) => {
          if (Array.isArray(item)) {
            const subName = item.find((sub: any) => sub.name);
            if (subName) metaObj = item;
          } else if ((item as any).player_stats) {
            statsObj = item;
          } else if ((item as any).ownership) {
            ownerObj = item;
          }
        });

        if (!metaObj) continue;

        const nameNode = metaObj.find((i: any) => i.name);
        const teamNode = metaObj.find((i: any) => i.editorial_team_abbr);
        const positionNode = metaObj.find((i: any) => i.display_position);
        const idNode = metaObj.find((i: any) => i.player_id);

        if (!nameNode?.name?.full || !idNode?.player_id) continue;

        // STATS (league 33897 verified)
        const map: Record<string, number> = {};
        if (statsObj?.player_stats?.stats) {
          statsObj.player_stats.stats.forEach((wrapper: any) => {
            const s = wrapper.stat;
            const val = s.value === '-' ? 0 : parseFloat(s.value || '0');
            map[s.stat_id] = isNaN(val) ? 0 : val;
          });
        }

        const goals = map['1'] || 0;
        const assists = map['2'] || 0;
        const plus_minus = map['4'] || 0;
        const pim = map['5'] || 0;
        const ppp = map
