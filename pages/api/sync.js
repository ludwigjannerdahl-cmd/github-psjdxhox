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

    // 2. SYNC ALL PLAYERS
    let start = 0;
    let totalSynced = 0;

    while (start < 350) {
      const yahooRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats;out=ownership?format=json`,
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );

      if (!yahooRes.ok) break;

      const yahooData = await yahooRes.json();
      const leagueNode = yahooData.fantasy_content?.league;

      let playersObj = null;
      if (Array.isArray(leagueNode)) {
        playersObj = leagueNode.find((n) => n.players)?.players;
      } else {
        playersObj = leagueNode?.players;
      }

      if (!playersObj || Object.keys(playersObj).length === 0) break;

      const updates = [];

      for (const key in playersObj) {
        if (key === "count") continue;

        const wrapper = playersObj[key];
        if (!wrapper || !wrapper.player) continue;

        const playerData = wrapper.player;
        const segments = Array.isArray(playerData) ? playerData : [playerData];

        let metaObj = null;
        let statsObj = null;
        let ownerObj = null;

        segments.forEach((item) => {
          if (Array.isArray(item) && item.find((sub) => sub && sub.name)) {
            metaObj = item;
          } else if (item && item.player_stats) {
            statsObj = item;
          } else if (item && item.ownership) {
            ownerObj = item;
          }
        });

        if (!metaObj) continue;

        const nameNode = metaObj.find((i) => i && i.name);
        const teamNode = metaObj.find((i) => i && i.editorial_team_abbr);
        const posNode = metaObj.find((i) => i && i.display_position);
        const idNode = metaObj.find((i) => i && i.player_id);

        if (!nameNode?.name?.full || !idNode?.player_id) continue;

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

        // OWNERSHIP → status + owner_team_name
        let status = "FA";
        let ownerTeamName = null;

        const ownershipSegment = segments.find(
          (item) => item && item.ownership
        );
        if (ownershipSegment && ownershipSegment.ownership) {
          const o = ownershipSegment.ownership;
          if (o.ownership_type === "team") {
            status = "TAKEN";
          } else {
            status = "FA";
          }
          if (o.owner_team_name) {
            ownerTeamName = o.owner_team_name;
          }
        }

        updates.push({
          nhl_id: parseInt(idNode.player_id, 10),
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
