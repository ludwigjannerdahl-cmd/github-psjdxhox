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
    // 1. AUTH
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

    // 2. SYNC LOOP - TYPE SAFE
    let start = 0;
    let totalSynced = 0;

    while (start < 300) {
      const yahooRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`,
        { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
      );
      
      const yahooData: any = await yahooRes.json();
      const leagueNode: any = yahooData.fantasy_content?.league;
      
      let playersObj: any = null;
      if (Array.isArray(leagueNode)) {
        const playerNode = leagueNode.find((n: any) => n.players);
        playersObj = playerNode ? playerNode.players : null;
      } else {
        playersObj = leagueNode?.players;
      }

      // TYPE SAFE EXIT - NO 'count' PROPERTY ACCESS
      if (!playersObj || Object.keys(playersObj).length === 0) {
        break;
      }

      const updates: any[] = [];

      for (const key in playersObj) {
        if (key === 'count') continue;
        
        const p: any = playersObj[key].player;
        
        let metaObj: any = null;
        let statsObj: any = null;
        let ownerObj: any = null;

        if (Array.isArray(p)) {
          p.forEach((item: any) => {
            if (Array.isArray(item)) {
              const subName = item.find((sub: any) => sub.name);
              if (subName) metaObj = item;
            } else if (item.player_stats) {
              statsObj = item;
            } else if (item.ownership) {
              ownerObj = item;
            }
          });
        }

        if (!metaObj) continue;

        const nameNode = metaObj.find((i: any) => i.name);
        const teamNode = metaObj.find((i: any) => i.editorial_team_abbr);
        const positionNode = metaObj.find((i: any) => i.display_position);
        const idNode = metaObj.find((i: any) => i.player_id);

        const
