"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Search, RotateCw, SlidersHorizontal } from "lucide-react";

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

type Percentiles = {
  [nhl_id: number]: {
    goals: number;
    assists: number;
    pim: number;
    ppp: number;
    sog: number;
    hits: number;
    blocks: number;
    fantasy_score: number;
  };
};

function buildPercentiles(players: Player[]): Percentiles {
  const keys: (keyof Percentiles[number])[] = [
    "goals",
    "assists",
    "pim",
    "ppp",
    "sog",
    "hits",
    "blocks",
    "fantasy_score",
  ];

  const values: { [K in keyof Percentiles[number]]: number[] } = {
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

  keys.forEach((k) => values[k].sort((a, b) => a - b));

  const pct: Percentiles = {};
  const n = players.length || 1;

  players.forEach((p) => {
    const entry: any = {};
    keys.forEach((k) => {
      const arr = values[k];
      const v = (p as any)[k] || 0;
      let rankIndex = arr.findIndex((x) => x >= v);
      if (rankIndex === -1) rankIndex = arr.length - 1;
      const percentile = Math.round((rankIndex / (n - 1 || 1)) * 100);
      entry[k] = percentile;
    });
    pct[p.nhl_id] = entry;
  });

  return pct;
}

export default function NordicTable() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FA">("ALL");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "advanced">("overview");

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

    setPlayers((data || []) as Player[]);
    setLoading(false);
  }

  const filtered = useMemo(
    () =>
      players.filter((p) => {
        const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
        const matchesSearch = p.full_name
          .toLowerCase()
          .includes(search.toLowerCase());
        return matchesStatus && matchesSearch;
      }),
    [players, statusFilter, search]
  );

  const percentiles = useMemo(() => buildPercentiles(players), [players]);

  function renderStatCell(value: number, zeroDim = true) {
    return (
      <span
        className={`font-mono text-sm text-slate-800 ${
          zeroDim && value === 0 ? "opacity-30" : ""
        }`}
      >
        {value}
      </span>
    );
  }

  function renderBar(pct: number) {
    return (
      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 px-4 py-8 sm:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
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
            <SlidersHorizontal className="w-3 h-3" />
            <span>
              {tab === "overview"
                ? "Simple scoring overview"
                : "Percentiles based on all synced players"}
            </span>
          </div>
        </div>

        {/* Table */}
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
                  <th className="px-2 py-3 text-center font-semibold">Status</th>
                  <th className="px-2 py-3 text-right font-semibold text-slate-700">
                    Score
                  </th>

                  {tab === "overview" ? (
                    <>
                      <th className="px-2 py-3 text-right font-semibold">G</th>
                      <th className="px-2 py-3 text-right font-semibold">A</th>
                      <th className="px-2 py-3 text-right font-semibold">+/-</th>
                      <th className="px-2 py-3 text-right font-semibold">PIM</th>
                      <th className="px-2 py-3 text-right font-semibold">PPP</th>
                      <th className="px-2 py-3 text-right font-semibold">SOG</th>
                      <th className="px-2 py-3 text-right font-semibold">Hit</th>
                      <th className="px-2 py-3 text-right font-semibold">Blk</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-3 text-left font-semibold">G pct</th>
                      <th className="px-3 py-3 text-left font-semibold">A pct</th>
                      <th className="px-3 py-3 text-left font-semibold">PIM pct</th>
                      <th className="px-3 py-3 text-left font-semibold">PPP pct</th>
                      <th className="px-3 py-3 text-left font-semibold">SOG pct</th>
                      <th className="px-3 py-3 text-left font-semibold">Hit pct</th>
                      <th className="px-3 py-3 text-left font-semibold">Blk pct</th>
                      <th className="px-3 py-3 text-left font-semibold">
                        Score pct
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="py-10 text-center text-slate-400">
                      Syncing Yahoo data…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-10 text-center text-slate-400">
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
                  filtered.map((p) => {
                    const pct = percentiles[p.nhl_id] || {
                      goals: 0,
                      assists: 0,
                      pim: 0,
                      ppp: 0,
                      sog: 0,
                      hits: 0,
                      blocks: 0,
                      fantasy_score: 0,
                    };

                    return (
                      <tr
                        key={p.nhl_id}
                        className="hover:bg-slate-50/70 transition-colors"
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
                                : "bg-slate-100 text-slate-600 border border-slate-200"
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
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.goals)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.assists)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.plus_minus, false)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.pim)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.ppp)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.sog)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.hits)}
                            </td>
                            <td className="px-2 py-3 text-right">
                              {renderStatCell(p.blocks)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3">
                              {renderBar(pct.goals)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.assists)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.pim)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.ppp)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.sog)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.hits)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.blocks)}
                            </td>
                            <td className="px-3 py-3">
                              {renderBar(pct.fantasy_score)}
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

        {/* Footer summary */}
        <div className="flex justify-between items-center text-xs text-slate-500">
          <span>
            {players.length} players synced • {filtered.length} shown
          </span>
          <span>Percentiles calculated from all synced players</span>
        </div>
      </div>
    </main>
  );
}
