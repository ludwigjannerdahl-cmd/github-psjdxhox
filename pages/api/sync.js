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
    const syncedIds = []; // nhl_id list for ownership phase

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
        const pidStr = idNode.player_id;
        const pid = parseInt(pidStr, 10);
        if (!Number.isFinite(pid)) continue;

        syncedIds.push(pid);

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
          nhl_id: pid,
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

    // 3) PHASE B – OWNERSHIP VIA LEAGUE PLAYERS OWNERSHIP

    // Reset everyone to FA by default
    await supabase
      .from("players")
      .update({ status: "FA", owner_team_name: null });

    const uniqueIds = Array.from(new Set(syncedIds));
    const gameKey = "465"; // NHL game key for 2025

    const batchSize = 20; // player_keys per ownership call
    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const idBatch = uniqueIds.slice(i, i + batchSize);
      const playerKeys = idBatch.map((pid) => `${gameKey}.p.${pid}`).join(",");

      const ownRes = await fetch(
        `https://fantasysports.yahooapis.com/fantasy/v2/league/465.l.33897/players;player_keys=${playerKeys}/ownership?format=json`,
        { headers: authHeader }
      );

      if (!ownRes.ok) {
        // skip this batch on error, continue with next
        continue;
      }

      const ownJson = await ownRes.json();
      const leagueNode = ownJson.fantasy_content?.league;

      let playersObj = null;
      if (Array.isArray(leagueNode)) {
        playersObj = leagueNode.find((n) => n.players)?.players || null;
      } else {
        playersObj = leagueNode?.players || null;
      }
      if (!playersObj) continue;

      const ownershipUpdates = [];

      for (const key in playersObj) {
        if (key === "count") continue;

        const wrapper = playersObj[key];
        if (!wrapper || !wrapper.player) continue;

        const pData = wrapper.player;
        const pSegs = Array.isArray(pData) ? pData : [pData];

        const idNode = pSegs.find((x) => x && x.player_id);
        const statusNode =
          pSegs.find((x) => x && x.status && x.status.ownership_type) ||
          pSegs.find((x) => x && x.ownership && x.ownership.ownership_type);

        if (!idNode?.player_id || !statusNode) continue;

        const pid = parseInt(idNode.player_id, 10);
        if (!Number.isFinite(pid)) continue;

        const own =
          statusNode.status && statusNode.status.ownership_type
            ? statusNode.status
            : statusNode.ownership;

        const ownershipType = own.ownership_type || "freeagents";
        const ownerName = own.owner_team_name || null;

        let status = "FA";
        if (ownershipType === "team") status = "TAKEN";
        else if (ownershipType === "waivers") status = "WAIVER";

        ownershipUpdates.push({
          nhl_id: pid,
          status,
          owner_team_name: ownerName,
        });
      }

      if (ownershipUpdates.length > 0) {
        const { error } = await supabase
          .from("players")
          .upsert(ownershipUpdates, { onConflict: "nhl_id" });
        if (error) throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    res.json({
      success: true,
      message: `✅ Synced ${totalSynced} players with ownership`,
      count: totalSynced,
    });
  } catch (error) {
    console.error("SYNC_ERROR", error);
    res.status(500).json({ error: error.message });
  }
}
