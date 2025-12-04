import { createClient } from "@supabase/supabase-js";
import YahooFantasy from "yahoo-fantasy";

const supabase = createClient(
  "https://dtunbzugzcpzunnbvzmh.supabase.co",
  "sb_secret_gxW9Gf6-ThLoaB1BP0-HBw_yPOWTVcM"
);

const CONSUMER_KEY = "dj0yJmk9bzdvRlE2Y0ZzdTZaJmQ9WVdrOVpYaDZNWHB4VG1JbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWRh";
const CONSUMER_SECRET = "0c5463680eface4bb3958929f73c891d5618266a";
const LEAGUE_KEY = "465.l.33897";
const GAME_KEY = "465";

export default async function handler(req, res) {
  try {
    // 1) Load Yahoo tokens from Supabase
    const { data: authData, error: authErr } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "yahoo_auth")
      .single();

    if (authErr) throw authErr;
    if (!authData?.value?.access_token) {
      throw new Error("No yahoo_auth access_token stored");
    }

    // 2) Init YahooFantasy client
    const yf = new YahooFantasy(
      CONSUMER_KEY,
      CONSUMER_SECRET,
      async (tokenData) => {
        // refresh callback: persist new tokens
        await supabase
          .from("system_config")
          .update({ value: { ...authData.value, ...tokenData } })
          .eq("key", "yahoo_auth");
      },
      "oob"
    );

    yf.setUserToken(authData.value.access_token);
    if (authData.value.refresh_token) {
      yf.setRefreshToken(authData.value.refresh_token);
    }

    // 3) PHASE A – pull league players + stats via wrapper
    let start = 0;
    const pageSize = 25;
    let totalSynced = 0;
    const syncedIds = [];

    while (true) {
      const url =
        `/fantasy/v2/league/${LEAGUE_KEY}` +
        `/players;sort=AR;start=${start};count=${pageSize}/stats`;

      const statsJson = await yf.api(yf.GET, url); // wrapper handles auth etc

      const leagueNode = statsJson.fantasy_content?.league;
      let playersObj = null;

      if (Array.isArray(leagueNode)) {
        playersObj = leagueNode.find((n) => n.players)?.players || null;
      } else {
        playersObj = leagueNode?.players || null;
      }

      if (!playersObj || Object.keys(playersObj).length === 0) break;

      const updates = [];

      for (const key in playersObj) {
        if (key === "count") continue;

        const wrapper = playersObj[key];
        if (!wrapper || !wrapper.player) continue;

        const pData = wrapper.player;
        const segs = Array.isArray(pData) ? pData : [pData];

        let metaObj = null;
        let statsObj = null;

        segs.forEach((item) => {
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
        const pid = parseInt(idNode.player_id, 10);
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

      start += pageSize;
      await new Promise((r) => setTimeout(r, 500));
    }

    // 4) PHASE B – ownership via league players ownership, still using yf.api

    await supabase
      .from("players")
      .update({ status: "FA", owner_team_name: null });

    const uniqueIds = Array.from(new Set(syncedIds));
    const batchSize = 20;

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const idBatch = uniqueIds.slice(i, i + batchSize);
      const playerKeys = idBatch.map((pid) => `${GAME_KEY}.p.${pid}`).join(",");

      const url =
        `/fantasy/v2/league/${LEAGUE_KEY}` +
        `/players;player_keys=${playerKeys}/ownership`;

      const ownJson = await yf.api(yf.GET, url);

      const leagueNode2 = ownJson.fantasy_content?.league;
      let playersObj2 = null;

      if (Array.isArray(leagueNode2)) {
        playersObj2 = leagueNode2.find((n) => n.players)?.players || null;
      } else {
        playersObj2 = leagueNode2?.players || null;
      }
      if (!playersObj2) continue;

      const ownershipUpdates = [];

      for (const key in playersObj2) {
        if (key === "count") continue;

        const wrapper = playersObj2[key];
        if (!wrapper || !wrapper.player) continue;

        const pData = wrapper.player;
        const segs = Array.isArray(pData) ? pData : [pData];

        const idNode = segs.find((x) => x && x.player_id);
        const ownNode =
          segs.find((x) => x && x.ownership && x.ownership.ownership_type) ||
          segs.find((x) => x && x.status && x.status.ownership_type);

        if (!idNode?.player_id || !ownNode) continue;

        const pid = parseInt(idNode.player_id, 10);
        if (!Number.isFinite(pid)) continue;

        const own =
          ownNode.ownership && ownNode.ownership.ownership_type
            ? ownNode.ownership
            : ownNode.status;

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

      await new Promise((r) => setTimeout(r, 500));
    }

    res.json({
      success: true,
      message: `Synced ${totalSynced} players with ownership`,
      count: totalSynced,
    });
  } catch (err) {
    console.error("SYNC_ERROR", err);
    res.status(500).json({ error: err.message });
  }
}
