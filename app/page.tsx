"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Search, RotateCw, Filter, X } from "lucide-react";

const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o";

const supabase = createClient(supabaseUrl, supabaseKey);

type Player = {
  nhl_id: number;
  full_name: string;
  team: string;
  position: string;
  status: string;
  owner_team_name: string | null;
  goals: number;
  assists: number;
  plus_minus: number;
  pim: number;
  ppp: number;
  sog: number;
  hits: number;
  blocks: number;
  fantasy_score: number;
};

type StatKey =
  | "goals"
  | "assists"
  | "pim"
  | "ppp"
  | "sog"
  | "hits"
  | "blocks"
  | "fantasy_score";

type Percentiles = {
  [nhl_id: number]: {
    [K in StatKey]: number;
  } & { completeness: number };
};

const PCT_STATS: StatKey[] = [
  "goals",
  "assists",
  "pim",
  "ppp",
  "sog",
  "hits",
  "blocks",
  "fantasy_score",
];

function computePercentiles(players: Player[]): Percentiles {
  const values: Record<StatKey, number[]> = {
    goals: [],
    assists: [],
    pim: [],
    ppp: [],
    sog: [],
    hits: [],
    blocks: [],
    fantasy_score: [],
  };

  players.forEach((p) => {
    values.goals.push(p.goals || 0);
    values.assists.push(p.assists || 0);
    values.pim.push(p.pim || 0);
    values.ppp.push(p.ppp || 0);
    values.sog.push(p.sog || 0);
    values.hits.push(p.hits || 0);
    values.blocks.push(p.blocks || 0);
    values.fantasy_score.push(p.fantasy_score || 0);
  });

  PCT_STATS.forEach((k) => values[k].sort((a, b) => a - b));

  const result: Percentiles = {};

  players.forEach((p) => {
    const entry: any = {};
    let sum = 0;

    PCT_STATS.forEach((k) => {
      const arr = values[k];
      const v = (p as any)[k] || 0;
      let idx = arr.findIndex((x) => x >= v);
      if (idx === -1) idx = arr.length - 1;
      const pct = arr.length > 1 ? Math.round((idx / (arr.length - 1)) * 100) : 50;
      entry[k] = pct;
      sum += pct;
    });

    entry.completeness = Math.round(sum / PCT_STATS.length);
    result[p.nhl_id] = entry;
  });

  return result;
}

function BarWithLabel({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-10 text-right text-[11px] text-slate-600 tabular-nums">
        {value}%
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

type SortKey =
  | "fantasy_score"
  | "goals"
  | "assists"
  | "plus_minus"
  | "pim"
  | "ppp"
  | "sog"
  | "hits"
  | "blocks";

export default function NordicTable() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FA" | "TAKEN">(
    "ALL"
  );
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "advanced">("overview");
  const [sortKey, setSortKey] = useState<SortKey>("fantasy_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Player | null>(null);

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    setLoading(true);
    const { data } = await supabase
      .from("players")
      .select("*")
      .order("fantasy_score", { ascending: false })
      .limit(350);

    setPlayers(((data || []) as unknown) as Player[]);
    setLoading(false);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "fantasy_score" ? "desc" : "desc");
    }
  }

  const filteredSorted = useMemo(() => {
    const base = players.filter((p) => {
      const matchesStatus =
        statusFilter === "ALL" ? true : p.status === statusFilter;
      const matchesSearch = p.full_name
        .toLowerCase()
        .includes(search.toLowerCase());
      return matchesStatus && matchesSearch;
    });

    return [...base].sort((a, b) => {
      const av = (a as any)[sortKey] || 0;
      const bv = (b as any)[sortKey] || 0;
      if (sortDir === "asc") return av - bv;
      return bv - av;
    });
  }, [players, statusFilter, search, sortKey, sortDir]);

  const percentiles = useMemo(
    () => computePercentiles(players),
    [players]
  );

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 px-4 py-8 sm:px-8">
      <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
        {/* MAIN TABLE AREA */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 bg-clip-text text-transparent">
                  Nordic Scout
                </span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Yahoo Fantasy Hockey • League 33897
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  placeholder="Search players..."
                  className="w-full pl-9 pr-3 py-2 rounded-full border border-slate-200 bg-white/80 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="inline-flex items-center rounded-full bg-slate-100 p-1">
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === "ALL"
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter("FA")}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === "FA"
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  Free agents
                </button>
                <button
                  onClick={() => setStatusFilter("TAKEN")}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === "TAKEN"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  Taken
                </button>
              </div>
              <button
                onClick={fetchPlayers}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
                disabled={loading}
              >
                <RotateCw
                  className={`w-4 h-4 mr-1 ${
                    loading ? "animate-spin text-slate-400" : "text-slate-500"
                  }`}
                />
                Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center justify-between">
            <div className="inline-flex rounded-full bg-slate-100 p-1">
              <button
                onClick={() => setTab("overview")}
                className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  tab === "overview"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setTab("advanced")}
                className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  tab === "advanced"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Advanced
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Filter className="w-3 h-3" />
              <span>
                {tab === "overview"
                  ? "Click headers to sort by category"
                  : "Percentiles & completeness vs all synced players"}
              </span>
            </div>
          </div>

          {/* TABLE */}
          <div className="bg-white/90 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200">
                  <tr className="text-[11px] tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-3 text-left font-semibold text-slate-600">
                      Player
                    </th>
                    <th className="px-2 py-3 text-center font-semibold">Pos</th>
                    <th className="px-2 py-3 text-center font-semibold">Team</th>
                    <th className="px-2 py-3 text-center font-semibold">
                      Status
                    </th>
                    <th
                      className="px-2 py-3 text-right font-semibold text-slate-700 cursor-pointer select-none"
                      onClick={() => toggleSort("fantasy_score")}
                    >
                      Score {sortIndicator("fantasy_score")}
                    </th>
                    {tab === "overview" ? (
                      <>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("goals")}
                        >
                          G {sortIndicator("goals")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("assists")}
                        >
                          A {sortIndicator("assists")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("plus_minus")}
                        >
                          +/- {sortIndicator("plus_minus")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("pim")}
                        >
                          PIM {sortIndicator("pim")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("ppp")}
                        >
                          PPP {sortIndicator("ppp")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("sog")}
                        >
                          SOG {sortIndicator("sog")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("hits")}
                        >
                          HIT {sortIndicator("hits")}
                        </th>
                        <th
                          className="px-2 py-3 text-right font-semibold cursor-pointer select-none"
                          onClick={() => toggleSort("blocks")}
                        >
                          BLK {sortIndicator("blocks")}
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-3 text-left font-semibold">
                          G pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          A pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          PIM pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          PPP pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          SOG pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          HIT pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          BLK pct
                        </th>
                        <th className="px-3 py-3 text-left font-semibold">
                          Completeness
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={13}
                        className="py-10 text-center text-slate-400"
                      >
                        Syncing Yahoo data…
                      </td>
                    </tr>
                  ) : filteredSorted.length === 0 ? (
                    <tr>
                      <td
                        colSpan={13}
                        className="py-10 text-center text-slate-400"
                      >
                        No players found.{" "}
                        <button
                          onClick={fetchPlayers}
                          className="underline hover:no-underline"
                        >
                          Retry sync
                        </button>
                      </td>
                    </tr>
                  ) : (
                    filteredSorted.map((p) => {
                      const pct = percentiles[p.nhl_id] || {
                        goals: 0,
                        assists: 0,
                        pim: 0,
                        ppp: 0,
                        sog: 0,
                        hits: 0,
                        blocks: 0,
                        fantasy_score: 0,
                        completeness: 0,
                      };

                      return (
                        <tr
                          key={p.nhl_id}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => setSelected(p)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">
                              {p.full_name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              ID {p.nhl_id}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center text-xs text-slate-600">
                            {p.position}
                          </td>
                          <td className="px-2 py-3 text-center">
                            <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {p.team}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-center">
                            <span
                              className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                p.status === "FA"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                  : "bg-slate-900 text-slate-50 border border-slate-900"
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-right">
                            <span className="font-semibold text-slate-900">
                              {p.fantasy_score.toFixed(1)}
                            </span>
                          </td>

                          {tab === "overview" ? (
                            <>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.goals}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.assists}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.plus_minus}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.pim}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.ppp}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.sog}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.hits}
                              </td>
                              <td className="px-2 py-3 text-right tabular-nums text-slate-700">
                                {p.blocks}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.goals} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.assists} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.pim} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.ppp} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.sog} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.hits} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.blocks} />
                              </td>
                              <td className="px-3 py-3">
                                <BarWithLabel value={pct.completeness} />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between items-center text-xs text-slate-500">
            <span>
              {players.length} players synced • {filteredSorted.length} shown
            </span>
            <span>
              Percentiles & completeness are relative to all synced players
            </span>
          </div>
        </div>

        {/* PROFILE PANEL */}
        <div className="w-full lg:w-80">
          {selected ? (
            <div className="bg-slate-900 text-slate-50 rounded-2xl shadow-xl p-5 relative overflow-hidden">
              <button
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-100"
                onClick={() => setSelected(null)}
              >
                <X className="w-4 h-4" />
              </button>

              <div className="mb-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Player profile
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {selected.full_name}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {selected.position} • {selected.team} • ID {selected.nhl_id}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                  <span
                    className={`px-2 py-0.5 rounded-full font-semibold ${
                      selected.status === "FA"
                        ? "bg-emerald-400/20 text-emerald-200 border border-emerald-300/40"
                        : "bg-slate-100 text-slate-900 border border-slate-200"
                    }`}
                  >
                    {selected.status}
                  </span>
                  {selected.owner_team_name && (
                    <span className="truncate">
                      Owner: {selected.owner_team_name}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                <div>
                  <div className="text-slate-400 mb-1">Fantasy score</div>
                  <div className="text-2xl font-semibold">
                    {selected.fantasy_score.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 mb-1">Completeness</div>
                  <div className="text-2xl font-semibold">
                    {percentiles[selected.nhl_id]?.completeness ?? 0}%
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="text-slate-300 mb-1">Per‑season categories</div>
                <div className="grid grid-cols-4 gap-y-1">
                  <span className="text-slate-400">G</span>
                  <span className="tabular-nums">{selected.goals}</span>
                  <span className="text-slate-400">A</span>
                  <span className="tabular-nums">{selected.assists}</span>

                  <span className="text-slate-400">+/-</span>
                  <span className="tabular-nums">{selected.plus_minus}</span>
                  <span className="text-slate-400">PIM</span>
                  <span className="tabular-nums">{selected.pim}</span>

                  <span className="text-slate-400">PPP</span>
                  <span className="tabular-nums">{selected.ppp}</span>
                  <span className="text-slate-400">SOG</span>
                  <span className="tabular-nums">{selected.sog}</span>

                  <span className="text-slate-400">HIT</span>
                  <span className="tabular-nums">{selected.hits}</span>
                  <span className="text-slate-400">BLK</span>
                  <span className="tabular-nums">{selected.blocks}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-700/60 space-y-1 text-xs">
                <div className="text-slate-300">Percentile radar (key stats)</div>
                <BarWithLabel
                  value={percentiles[selected.nhl_id]?.goals ?? 0}
                />
                <BarWithLabel
                  value={percentiles[selected.nhl_id]?.assists ?? 0}
                />
                <BarWithLabel
                  value={percentiles[selected.nhl_id]?.sog ?? 0}
                />
                <BarWithLabel
                  value={percentiles[selected.nhl_id]?.hits ?? 0}
                />
                <BarWithLabel
                  value={percentiles[selected.nhl_id]?.blocks ?? 0}
                />
              </div>
            </div>
          ) : (
            <div className="bg-white/60 border border-slate-200 rounded-2xl p-5 text-xs text-slate-500">
              <div className="font-semibold text-slate-700 mb-1">
                Player profile
              </div>
              <p>
                Click any row to open a detailed profile with completeness score,
                category breakdown and percentiles.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
