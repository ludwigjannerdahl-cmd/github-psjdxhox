import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    "https://dtunbzugzcpzunnbvzmh.supabase.co",
    "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"
  );

  try {
    // 1) REFRESH YAHOO TOKEN
    const { data: authData, error: authErr } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "yahoo_auth")
      .single();

    if (authErr) throw authErr;
    if (!authData?.value?.refresh_token) {
      throw new Error("No Yahoo auth token in system_config");
    }

    const tokenRes = await fetch(
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
    );

    const tokens = await tokenRes.json();
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

    const authHeader = { Authorization: `Bearer ${tokens.access_token}` };

    // 2) PHASE A – STATS: SYNC ALL LEAGUE PLAYERS
    let start = 0;
    let totalSynced = 0;

    while (true) {
      const statsRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats?format=json`,
        { headers: authHeader }
      );
      if (!statsRes.ok) break;

      const statsJson = await statsRes.json();
      const leagueNode = statsJson.fantasy_content?.league;

      let playersObj = null;
      if (Array.isArray(leagueNode)) {
        playersObj = leagueNode.find((n) => n.players)?.players || null;
      } else {
        playersObj = leagueNode?.players || null;
      }

      if (!playersObj || Object.keys(playersObj).length === 0) {
        break;
      }

      const updates = [];

      for (const key in playersObj) {
        if (key === "count") continue;

        const wrapper = playersObj[key];
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

        const stats = {};
        if (statsObj?.player_stats?.stats) {
          statsObj.player_stats.stats.forEach((w) => {
            const s = w.stat;
            const raw = s.value === "-" ? 0 : parseFloat(s.value || "0");
            stats[s.stat_id] = isNaN(raw) ? 0 : raw;
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
          fantasy_score: parseFloat(fantasyScore.toFixed(2)),
          last_updated: new Date().toISOString(),
        });
      }

      if (updates.length > 0) {
        const { error } = await supabase
          .from("players")
          .upsert(updates, { onConflict: "nhl_id" });
        if (error) throw error;
        totalSynced += updates.length;
      }

      start += 25;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 3) PHASE B – OWNERSHIP FROM ROSTERS

    // 3a) get all teams in league (you already logged this JSON)
    const leagueTeamsRes = await fetch(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/teams?format=json",
      { headers: authHeader }
    );

    const takenIds = new Set();
    const ownerById = {};

    if (leagueTeamsRes.ok) {
      const leagueTeamsJson = await leagueTeamsRes.json();
      const lNode = leagueTeamsJson.fantasy_content?.league;

      let teamsObj = null;
      if (Array.isArray(lNode)) {
        teamsObj = lNode.find((n) => n.teams)?.teams || null;
      } else {
        teamsObj = lNode?.teams || null;
      }

      if (teamsObj) {
        for (const key in teamsObj) {
          if (key === "count") continue;

          const tWrapper = teamsObj[key];
          if (!tWrapper || !tWrapper.team) continue;

          const tData = tWrapper.team;
          const tSegs = Array.isArray(tData) ? tData : [tData];

          const teamKeyNode = tSegs.find((i) => i && i.team_key);
          const teamNameNode = tSegs.find((i) => i && i.name);

          const teamKey = teamKeyNode?.team_key;
          const teamName = teamNameNode?.name || "Unknown team";

          if (!teamKey) continue;

          // 3b) roster for this team – we know from your sample the JSON has team + roster + roster.players
          const rosterRes = await fetch(
            `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster/players?format=json`,
            { headers: authHeader }
          );
          if (!rosterRes.ok) continue;

          const rosterJson = await rosterRes.json();
          const teamNode = rosterJson.fantasy_content?.team;

          let playersArray = null;

          if (Array.isArray(teamNode)) {
            // structure: [ meta..., { roster: { players: { "0": {...}, ... } } } ]
            const rosterNode = teamNode.find((n) => n.roster)?.roster;
            if (rosterNode && Array.isArray(rosterNode.players)) {
              // some wrappers flatten to array
              playersArray = rosterNode.players;
            } else if (rosterNode && rosterNode.players) {
              playersArray = rosterNode.players;
            }
          } else if (teamNode?.roster?.players) {
            playersArray = teamNode.roster.players;
          }

          if (!playersArray) continue;

          // playersArray is an object with numeric keys or an array; your sample file is already flattened
          const iterable =
            Array.isArray(playersArray) ? playersArray : Object.values(playersArray);

          for (const p of iterable) {
            const playerObj = p.player || p; // depending on shape

            const pidStr = playerObj.player_id;
            if (!pidStr) continue;

            const pid = parseInt(pidStr, 10);
            takenIds.add(pid);

            const own = playerObj.ownership;
            const ownerName =
              own?.owner_team_name && typeof own.owner_team_name === "string"
                ? own.owner_team_name
                : teamName;
            ownerById[pid] = ownerName;
          }
        }
      }
    }

    // 3c) Reset all players to FA
    await supabase
      .from("players")
      .update({ status: "FA", owner_team_name: null });

    // 3d) Mark taken players in batches
    const allTaken = Array.from(takenIds);
    const batchSize = 100;

    for (let i = 0; i < allTaken.length; i += batchSize) {
      const batch = allTaken.slice(i, i + batchSize);
      const updates = batch.map((pid) => ({
        nhl_id: pid,
        status: "TAKEN",
        owner_team_name: ownerById[pid] || null,
      }));

      const { error } = await supabase
        .from("players")
        .upsert(updates, { onConflict: "nhl_id" });
      if (error) throw error;
    }

    res.json({
      success: true,
      message: `✅ Synced ${totalSynced} players with ownership`,
      count: totalSynced,
      ownedCount: allTaken.length,
    });
  } catch (error) {
    console.error("SYNC_ERROR", error);
    res.status(500).json({ error: error.message });
  }
}
