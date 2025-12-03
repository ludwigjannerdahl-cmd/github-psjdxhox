import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

// --- CONFIGURATION & CONSTANTS ---
// In a production environment, these should be process.env variables.
const SUPABASE_URL = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const SUPABASE_KEY = "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"; // Service Role Key required for upserts
const YAHOO_CLIENT_ID = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
const YAHOO_CLIENT_SECRET = "0c5463680eface4bb3958929f73c891d5618266a";
const LEAGUE_ID = "33897"; // nhl.l.33897

// Mapping internal DB columns to potential Yahoo display names
const STAT_COLUMN_MAP: Record<string, string[]> = {
  goals: ['G', 'Goals'],
  assists: ['A', 'Assists'],
  plus_minus: ['+/-', 'Plus/Minus'],
  pim: ['PIM', 'Penalty Minutes'],
  ppp: ['PPP', 'Powerplay Points'],
  sog: ['SOG', 'Shots on Goal'],
  hits: ['HIT', 'Hits'],
  blocks: ['BLK', 'Blocks']
};

// Fantasy Score Weights (Configurable)
const SCORING_WEIGHTS: Record<string, number> = {
  goals: 3,
  assists: 2,
  hits: 0.5,
  blocks: 0.5,
  sog: 0.4,
  plus_minus: 0.5,
  ppp: 1
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // 1. AUTHENTICATION & TOKEN REFRESH
    // Fetch the stored token from our system_config table
    const { data: authData, error: authDbError } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'yahoo_auth')
      .single();

    if (authDbError || !authData) throw new Error("Auth token missing in DB. Run the initial auth flow first.");

    // Attempt to refresh the token to ensure it is valid
    const refreshParams = new URLSearchParams({
      client_id: YAHOO_CLIENT_ID,
      client_secret: YAHOO_CLIENT_SECRET,
      redirect_uri: 'oob',
      refresh_token: authData.value.refresh_token,
      grant_type: 'refresh_token'
    });

    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshParams
    });

    if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        throw new Error(`Yahoo Token Refresh Failed: ${tokenResponse.status} ${errText}`);
    }

    const tokens = await tokenResponse.json();

    // Persist new tokens
    await supabase.from('system_config').update({
       value: { ...authData.value, access_token: tokens.access_token, refresh_token: tokens.refresh_token || authData.value.refresh_token }
    }).eq('key', 'yahoo_auth');

    const accessToken = tokens.access_token;

    // 2. DISCOVER STAT MAPPING (Dynamic Stat IDs)
    // We fetch league settings to find out which ID corresponds to "Goals", "Hits", etc.
    // Reference: https://developer.yahoo.com/fantasysports/guide/#settings-collection
    const settingsUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${LEAGUE_ID}/settings?format=json`;
    const settingsRes = await fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    
    if (!settingsRes.ok) throw new Error(`Failed to fetch league settings: ${settingsRes.status}`);
    
    const settingsData = await settingsRes.json();
    const statCategories = settingsData?.fantasy_content?.league?.[1]?.settings?.[0]?.stat_categories;

    if (!statCategories) throw new Error("Could not parse stat categories from Yahoo response.");

    // Build map: { "1": "goals", "2": "assists", ... }
    const statIdToColumn: Record<string, string> = {};
    
    // Yahoo returns stat_categories as an object with numeric keys or an array. We iterate safely.
    // Typically: { stats: [ { stat: { stat_id, display_name, ... } } ] }
    const statsArray = statCategories.stats;

    if (Array.isArray(statsArray)) {
        statsArray.forEach((entry: any) => {
            const s = entry.stat;
            const displayName = s.display_name || s.name;
            const id = s.stat_id.toString();

            // Match against our known column map
            for (const [colKey, validNames] of Object.entries(STAT_COLUMN_MAP)) {
                if (validNames.includes(displayName)) {
                    statIdToColumn[id] = colKey;
                    break;
                }
            }
        });
    }

    // 3. PAGINATION LOOP (Fetch Players)
    let start = 0;
    const count = 25; // Yahoo max batch size
    const maxPlayers = 600; // Safety limit
    let totalSynced = 0;
    
    // Buffer for batch upsert
    let playerBuffer: any[] = [];

    while (start < maxPlayers) {
        // Delay to respect rate limits (approx 60/hr)
        if (start > 0) await new Promise(r => setTimeout(r, 800));

        // Fetch Stats and Ownership in one call
        // Reference: https://developer.yahoo.com/fantasysports/guide/#player-collection
        const url = `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.${LEAGUE_ID}/players;sort=AR;start=${start};count=${count}/stats;out=ownership?format=json`;
        
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        
        if (res.status === 429) {
            // Simple backoff if rate limited
            console.warn("Rate limited. Waiting 5s...");
            await new Promise(r => setTimeout(r, 5000));
            continue; // Retry same start
        }

        if (!res.ok) throw new Error(`Yahoo Player Fetch Failed: ${res.status}`);

        const data = await res.json();
        
        // Yahoo Data Navigation (Recursive finder logic handles inconsistent nesting)
        const leagueNode = data.fantasy_content?.league;
        
        // Find the 'players' node safely
        let playersCollection = null;
        if (Array.isArray(leagueNode)) {
             // Sometimes league is an array [ metadata, players ]
             playersCollection = leagueNode.find((n: any) => n.players)?.players;
        } else {
             playersCollection = leagueNode?.players;
        }

        // If empty or just has 'count', we are done
        if (!playersCollection || (Object.keys(playersCollection).length === 1 && playersCollection.count)) {
            break;
        }

        // Iterate over the "fake array" object
        for (const key in playersCollection) {
            if (key === 'count') continue;
            const pWrapper = playersCollection[key].player;
            if (!pWrapper) continue;

            // pWrapper is [ [metadata], {stats}, {ownership} ] sandwich
            // We flatten it to find what we need
            const flatData = pWrapper.flat();

            const meta = flatData.find((i: any) => i.player_id);
            const statsNode = flatData.find((i: any) => i.player_stats);
            const ownerNode = flatData.find((i: any) => i.ownership);

            if (!meta) continue;

            // -- Metadata --
            const nhlId = parseInt(meta.player_id);
            const fullName = meta.name?.full || "Unknown";
            const team = meta.editorial_team_abbr || "FA";
            const position = meta.display_position || "UNK";

            // -- Ownership --
            // ownership_type is 'team' (taken) or 'freeagents' (FA)
            const ownershipType = ownerNode?.ownership?.ownership_type;
            const status = ownershipType === 'team' ? 'TAKEN' : 'FA';

            // -- Stats --
            // Default record
            const playerRecord: any = {
                nhl_id: nhlId,
                full_name: fullName,
                team: team,
                position: position,
                status: status,
                goals: 0, assists: 0, plus_minus: 0, pim: 0, ppp: 0, sog: 0, hits: 0, blocks: 0,
                last_updated: new Date().toISOString()
            };

            const rawStats = statsNode?.player_stats?.stats;
            if (Array.isArray(rawStats)) {
                rawStats.forEach((s: any) => {
                    const id = s.stat.stat_id.toString();
                    const valStr = s.stat.value;
                    
                    // Map ID to DB column
                    const colName = statIdToColumn[id];
                    if (colName) {
                        // Parse Value: Handle '-' as 0, otherwise float -> int
                        const numVal = valStr === '-' ? 0 : parseFloat(valStr);
                        playerRecord[colName] = isNaN(numVal) ? 0 : Math.round(numVal);
                    }
                });
            }

            // -- Fantasy Score Calculation --
            let fScore = 0;
            for (const [stat, weight] of Object.entries(SCORING_WEIGHTS)) {
                fScore += (playerRecord[stat] || 0) * weight;
            }
            playerRecord.fantasy_score = parseFloat(fScore.toFixed(2));

            playerBuffer.push(playerRecord);
        }

        start += count;
    }

    // 4. BATCH UPSERT TO SUPABASE
    // Upsert in chunks of 100 to be safe
    const chunkSize = 100;
    for (let i = 0; i < playerBuffer.length; i += chunkSize) {
        const chunk = playerBuffer.slice(i, i + chunkSize);
        const { error } = await supabase
            .from('players')
            .upsert(chunk, { onConflict: 'nhl_id' }); // Upsert on unique NHL ID
        
        if (error) {
            console.error("Supabase Upsert Error:", error);
            throw new Error(`Database Write Failed: ${error.message}`);
        }
    }

    totalSynced = playerBuffer.length;

    return res.status(200).json({ 
        success: true, 
        message: `Synced ${totalSynced} players successfully using dynamic stat mapping.`,
        stat_map_used: statIdToColumn 
    });

  } catch (error: any) {
    console.error("Sync Pipeline Error:", error);
    return res.status(500).json({ 
        success: false, 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}