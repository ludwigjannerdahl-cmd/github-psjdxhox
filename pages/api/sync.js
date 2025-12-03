import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    "https://dtunbzugzcpzunnbvzmh.supabase.co",
    "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"
  );

  try {
    // 1. REFRESH YAHOO TOKEN
    const { data: authData } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "yahoo_auth")
      .single();

    if (!authData?.value?.refresh_token) {
      throw new Error("No Yahoo auth token in system_config");
    }

    const tokens = await fetch(
      "https://api.login.yahoo.com/oauth2/get_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:
            "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh",
          client_secret: "0c5463680eface4bb3958929f73c891d5618266a",
          redirect_uri: "oob",
          refresh_token: authData.value.refresh_token,
          grant_type: "refresh_token",
        }),
      }
    ).then((r) => r.json());

    if (tokens.error) {
      throw new Error(
        `Yahoo token refresh failed: ${
          tokens.error_description || tokens.error
        }`
      );
    }

    await supabase
      .from("system_config")
      .update({
        value: { ...authData.value, access_token: tokens.access_token },
      })
      .eq("key", "yahoo_auth");

    // 2. SYNC ALL PLAYERS WITH STATS + OWNERSHIP
    let start = 0;
    let totalSynced = 0;

    while (true) {
      // A) STATS CALL (what you already had)
      const statsRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats?format=json`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (!statsRes.ok) break;
      const statsJson = await statsRes.json();

      // B) OWNERSHIP CALL (new)
      const ownRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25;status=A;out=ownership,percent_owned?format=json`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (!ownRes.ok) break;
      const ownJson = await ownRes.json();

      // Helper to get players object from league response
      const extractPlayers = (root) => {
        const leagueNode = root.fantasy_content?.league;
        if (Array.isArray(leagueNode)) {
          return leagueNode.find((n) => n.players)?.players || null;
        }
        return leagueNode?.players || null;
      };

      const statsPlayers = extractPlayers(statsJson);
      const ownPlayers = extractPlayers(ownJson);

      if (
        !statsPlayers ||
        Object.keys(statsPlayers).length === 0 ||
        !ownPlayers ||
        Object.keys(ownPlayers).length === 0
      ) {
        break;
      }

      // Build map: player_id -> { ownership_type, owner_team_name }
      const ownershipById = {};
      for (const key in ownPlayers) {
        if (key === "count") continue;
        const wrapper = ownPlayers[key];
        if (!wrapper || !wrapper.player) continue;

        const pdata = wrapper.player;
        const segs = Array.isArray(pdata) ? pdata : [pdata];

        segs.forEach((item) => {
          if (item && item.ownership) {
            const idNode = segs.find((i) => i && i.player_id);
            const pid = idNode?.player_id;
            if (!pid) return;
            ownershipById[pid] = {
              ownership_type: item.ownership.ownership_type,
              owner_team_name: item.ownership.owner_team_name || null,
            };
          }
        });
      }

      const updates = [];

      for (const key in statsPlayers) {
        if (key === "count") continue;

        const wrapper = statsPlayers[key];
        if (!wrapper || !wrapper.player) continue;

        const playerData = wrapper.player;
        const segments = Array.isArray(playerData) ? playerData : [playerData];

        let metaObj = null;
        let statsObj = null;

        segments.forEach((item) => {
          if (Array.isArray(item) && item.find((sub) => sub && sub.name)) {
            metaObj = item;
          } else if (item && item.player_stats) {
            statsObj = item;
          }
        });

        if (!metaObj) continue;

        const nameNode = metaObj.find((i) => i && i.name);
        const teamNode = metaObj.find((i) => i && i.editorial_team_abbr);
        const posNode = metaObj.find((i) => i && i.display_position);
        const idNode = metaObj.find((i) => i && i.player_id);

        if (!nameNode?.name?.full || !idNode?.player_id) continue;
        const pid = idNode.player_id;

        // STATS (hard-coded IDs)
        const stats = {};
        if (statsObj?.player_stats?.stats) {
          statsObj.player_stats.stats.forEach((w) => {
            const s = w.stat;
            const val = s.value === "-" ? 0 : parseFloat(s.value || "0");
            stats[s.stat_id] = isNaN(val) ? 0 : val;
          });
        }

        const goals = stats["1"] || 0;
        const assists = stats["2"] || 0;
        const plus_minus = stats["4"] || 0;
        const pim = stats["5"] || 0;
        const ppp = stats["8"] || 0;
        const sog = stats["14"] || 0;
        const hits = stats["31"] || 0;
        const blocks = stats["32"] || 0;

        const fantasyScore =
          goals * 3 +
          assists * 2 +
          hits * 0.5 +
          blocks * 0.5 +
          sog * 0.4 +
          plus_minus * 0.5 +
          ppp * 1;

        // OWNERSHIP FROM MAP
        const own = ownershipById[pid] || null;
        let status = "FA";
        let ownerTeamName = null;

        if (own) {
          if (own.ownership_type === "team") status = "TAKEN";
          if (own.owner_team_name) ownerTeamName = own.owner_team_name;
        }

        updates.push({
          nhl_id: parseInt(pid, 10),
          full_name: nameNode.name.full,
          team: teamNode?.editorial_team_abbr || "UNK",
          position: posNode?.display_position || "F",
          goals: Math.round(goals),
          assists: Math.round(assists),
          plus_minus: Math.round(plus_minus),
          pim: Math.round(pim),
          ppp: Math.round(ppp),
          sog: Math.round(sog),
          hits: Math.round(hits),
          blocks: Math.round(blocks),
          status,
          owner_team_name: ownerTeamName,
          fantasy_score: parseFloat(fantasyScore.toFixed(2)),
          last_updated: new Date().toISOString(),
        });
      }

      if (updates.length > 0) {
        await supabase.from("players").upsert(updates, { onConflict: "nhl_id" });
        totalSynced += updates.length;
      }

      start += 25;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    res.json({
      success: true,
      message: `✅ Synced ${totalSynced} players`,
      count: totalSynced,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
