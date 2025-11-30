import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // --- HARDCODED CONFIGURATION ---
  const supabaseUrl = 'https://dtunbzugzcpzunnbvzmh.supabase.co';
  const supabaseKey = 'sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM';
  const yahooClientId =
    'dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh';
  const yahooClientSecret = '0c5463680eface4bb3958929f73c891d5618266a';
  const leagueId = '33897'; // Your League ID
  // ------------------------------

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Get Token
    const { data: authData } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'yahoo_auth')
      .single();
    if (!authData) throw new Error('Auth token missing!');

    // 2. Refresh Yahoo Token
    const refreshRes = await fetch(
      'https://api.login.yahoo.com/oauth2/get_token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: yahooClientId,
          client_secret: yahooClientSecret,
          redirect_uri: 'oob',
          refresh_token: authData.value.refresh_token,
          grant_type: 'refresh_token',
        }),
      }
    );
    const tokens = await refreshRes.json();
    if (tokens.error) throw new Error('Yahoo Refresh Failed');

    // Save new token
    await supabase
      .from('system_config')
      .update({
        value: { ...authData.value, access_token: tokens.access_token },
      })
      .eq('key', 'yahoo_auth');

    // 3. Fetch "Taken" Players from Yahoo (The Roster Scan)
    // We loop to get the first 100 taken players to match names
    const yahooRes = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${leagueId}/players;status=T;start=0;count=100?format=json`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const yahooData = await yahooRes.json();

    // Create a list of names that are already owned
    const takenNames = new Set();
    try {
      const players = yahooData.fantasy_content.league[1].players;
      for (const key in players) {
        if (players[key].player)
          takenNames.add(players[key].player[0][2].name.full);
      }
    } catch (e) {
      console.log('Yahoo parsing partial error', e);
    }

    // 4. Fetch Official NHL Stats (Top 200 Players)
    const nhlRes = await fetch(
      'https://api-web.nhle.com/v1/skater-stats-leaders/20242025/2?categories=goals&limit=200'
    );
    const nhlData = await nhlRes.json();

    // 5. Merge & Upsert
    const updates = nhlData.skaters.map((p: any) => {
      const fullName = `${p.firstName.default} ${p.lastName.default}`;
      const isTaken = takenNames.has(fullName); // Check if name exists in Yahoo Taken list

      return {
        nhl_id: p.id,
        full_name: fullName,
        team: p.teamAbbrev,
        position: p.positionCode,
        goals: p.goals,
        assists: p.assists,
        points: p.points,
        plus_minus: p.plusMinus,
        hits: p.hits || 0,
        blocks: p.blockedShots || 0,
        status: isTaken ? 'TAKEN' : 'FA', // <--- REAL STATUS
        fantasy_score:
          p.goals * 3 + p.assists * 2 + p.hits * 0.5 + p.blockedShots * 0.5,
        last_updated: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('players')
      .upsert(updates, { onConflict: 'nhl_id' });
    if (error) throw error;

    res
      .status(200)
      .json({
        success: true,
        message: `Synced ${updates.length} players. Found ${takenNames.size} taken in Yahoo.`,
      });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
