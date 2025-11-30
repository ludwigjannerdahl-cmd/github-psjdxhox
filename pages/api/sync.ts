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
    // 1. Get Token
    const { data: authData } = await supabase.from('system_config').select('value').eq('key', 'yahoo_auth').single();
    if (!authData) throw new Error("Auth token missing!");

    // 2. Refresh Token
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

    // 3. DEBUG FETCH
    // We try to fetch just 1 player to inspect the data structure
    const yahooRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;sort=AR;start=0;count=1/stats?format=json`, 
      { headers: { 'Authorization': `Bearer ${newTokens.access_token}` } }
    );
    
    const yahooData = await yahooRes.json();
    
    // --- DIAGNOSTIC DUMP ---
    // If we can't find players, we return the RAW data to see what's wrong
    const leagueNode = yahooData.fantasy_content?.league;
    
    // Check if league exists
    if (!leagueNode) {
        return res.status(200).json({ 
            error: "League Not Found", 
            raw_response: yahooData 
        });
    }

    // Try to find the players array (It might be in [0], [1], or a named property)
    // We search the whole structure for it
    let playersObj = null;
    if (Array.isArray(leagueNode)) {
        // Search array for the object containing 'players'
        const playerNode = leagueNode.find((node: any) => node.players);
        if (playerNode) playersObj = playerNode.players;
    } else if (leagueNode.players) {
        playersObj = leagueNode.players;
    }

    // If still 0, DUMP the JSON so we can fix the parsing logic
    if (!playersObj || Object.keys(playersObj).length === 0) {
         return res.status(200).json({ 
            message: "Connected to Yahoo, but found 0 players. Check the structure below:", 
            debug_structure: leagueNode 
        });
    }

    // If we get here, it worked!
    return res.status(200).json({ 
        success: true, 
        message: "PLAYERS FOUND! The logic works.",
        sample_data: playersObj
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}