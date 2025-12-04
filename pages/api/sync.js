import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const supabase = createClient(
    "https://dtunbzugzcpzunnbvzmh.supabase.co",
    "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"
  );

  try {
    // 1) REFRESH YAHOO TOKEN
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

    // 2) PHASE A – STATS: SYNC ALL LEAGUE PLAYERS
    let start = 0;
    let totalSynced = 0;

    while (true) {
      const statsRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/players;sort=AR;start=${start};count=25/stats?format=json`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
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
        await supabase.from("players").upsert(updates, { onConflict: "nhl_id" });
        totalSynced += updates.length;
      }

      start += 25;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 3) PHASE B – OWNERSHIP (DEBUG LOGGING ONLY FOR NOW)

    const leagueTeamsRes = await fetch(
      "https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.33897/teams?format=json",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    const takenIds = new Set();
    const ownerById = {};

    if (leagueTeamsRes.ok) {
      const leagueTeamsJson = await leagueTeamsRes.json();
      console.log(
        "DEBUG_LEAGUE_TEAMS_ROOT",
        JSON.stringify(leagueTeamsJson)
      );

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

          const teamData = tWrapper.team;
          const tSegs = Array.isArray(teamData) ? teamData : [teamData];

          const teamKeyNode = tSegs.find((i) => i && i.team_key);
          const teamNameNode = tSegs.find((i) => i && i.name);

          const teamKey = teamKeyNode?.team_key;
          const teamName = teamNameNode?.name || "Unknown team";

          if (!teamKey) continue;

          const rosterRes = await fetch(
            `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/roster/players?format=json`,
            { headers: { Authorization: `Bearer ${tokens.access_token}` } }
          );

          if (!rosterRes.ok) {
            console.log("DEBUG_ROSTER_ERROR", teamKey, rosterRes.status);
            continue;
          }

          const rosterJson = await rosterRes.json();
          console.log(
            "DEBUG_ROSTER_ROOT",
            teamKey,
            JSON.stringify(rosterJson)
          );

          const rTeamNode = rosterJson.fantasy_content?.team;
          let rPlayersObj = null;

          if (Array.isArray(rTeamNode)) {
            const rosterNode = rTeamNode.find((n) => n.roster)?.roster;
            if (rosterNode && rosterNode.players) {
              rPlayersObj = rosterNode.players;
            }
          } else if (rTeamNode?.roster?.players) {
            rPlayersObj = rTeamNode.roster.players;
          }

          if (!rPlayersObj) continue;

          for (const pk in rPlayersObj) {
            if (pk === "count") continue;
            const pWrap = rPlayersObj[pk];
            if (!pWrap || !pWrap.player) continue;

            const pdata = pWrap.player;
            const pSegs = Array.isArray(pdata) ? pdata : [pdata];
            const idNode = pSegs.find((i) => i && i.player_id);
            const pidStr = idNode?.player_id;
            if (!pidStr) continue;

            const pid = parseInt(pidStr, 10);
            takenIds.add(pid);
            ownerById[pid] = teamName;
          }
        }
      }
    }

    // For now, do NOT update statuses until parsing is confirmed.
    // Once DEBUG_* logs look correct in Vercel, the next step is to
    // use takenIds / ownerById to set status + owner_team_name.

    res.json({
      success: true,
      message: `✅ Synced ${totalSynced} players (ownership debug phase logged)`,
      count: totalSynced,
    });
  } catch (error) {
    console.error("SYNC_ERROR", error);
    res.status(500).json({ error: error.message });
  }
}
