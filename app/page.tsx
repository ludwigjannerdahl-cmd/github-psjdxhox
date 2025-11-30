'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Activity, TrendingUp } from 'lucide-react';

// --- HARDCODED KEYS (PUBLIC ACCESS) ---
const supabaseUrl = 'https://dtunbzugzcpzunnbvzmh.supabase.co';
// This is your PUBLIC (anon) key. It is safe to use here.
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o';

const supabase = createClient(supabaseUrl, supabaseKey);
// --------------------------------------

export default function NordicDashboard() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('fantasy_score', { ascending: false })
      .limit(50);

    if (error) console.error('Error fetching:', error);
    else setPlayers(data || []);
    setLoading(false);
  }

  const displayedPlayers =
    filter === 'FA' ? players.filter((p: any) => p.status === 'FA') : players;

  return (
    <main className="min-h-screen p-6 md:p-12 max-w-7xl mx-auto bg-slate-50/50">
      {/* HEADER */}
      <header className="mb-10 flex flex-col md:flex-row justify-between items-end border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-5xl font-extralight tracking-tight text-slate-900 mb-3">
            Nordic <span className="font-semibold text-sky-600">Scout</span>
          </h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em] flex items-center gap-2">
            <Activity size={14} className="text-sky-500" />
            Season 2025/2026 • Live Intelligence
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex gap-3 mt-6 md:mt-0">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all duration-300 ${
              filter === 'ALL'
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-200 scale-105'
                : 'bg-white text-slate-400 hover:bg-white hover:text-slate-600 border border-slate-100'
            }`}
          >
            All Players
          </button>
          <button
            onClick={() => setFilter('FA')}
            className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider rounded-full transition-all duration-300 ${
              filter === 'FA'
                ? 'bg-sky-500 text-white shadow-lg shadow-sky-100 scale-105'
                : 'bg-white text-slate-400 hover:bg-white hover:text-slate-600 border border-slate-100'
            }`}
          >
            Free Agents
          </button>
        </div>
      </header>

      {/* GRID */}
      {loading ? (
        <div className="flex justify-center py-32">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayedPlayers.map((player: any) => (
            <div
              key={player.id}
              className="nordic-card rounded-2xl p-6 relative overflow-hidden group bg-white hover:border-sky-200"
            >
              {/* Card Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-medium text-xl text-slate-800 leading-tight group-hover:text-sky-600 transition-colors">
                    {player.full_name}
                  </h3>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="bg-slate-50 text-slate-500 text-[10px] font-bold px-2 py-1 rounded border border-slate-100">
                      {player.team}
                    </span>
                    <span className="text-slate-400 text-xs font-semibold">
                      {player.position}
                    </span>
                    {player.status === 'FA' && (
                      <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-1 rounded border border-emerald-100 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Available
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-light text-slate-900 tracking-tight">
                    {player.fantasy_score}
                  </div>
                  <div className="text-[9px] uppercase text-slate-400 font-bold tracking-widest mt-1">
                    Z-Score
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-3 py-4 border-t border-slate-50">
                <StatBox
                  label="Goals"
                  value={player.goals}
                  highlight={player.goals > 30}
                />
                <StatBox
                  label="Asst"
                  value={player.assists}
                  highlight={player.assists > 50}
                />
                <StatBox
                  label="Hits"
                  value={player.hits}
                  highlight={player.hits > 50}
                />
                <StatBox
                  label="Blks"
                  value={player.blocks}
                  highlight={player.blocks > 50}
                />
              </div>

              {/* Hidden Trend Indicator */}
              <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-x-2 group-hover:translate-x-0">
                <TrendingUp size={20} className="text-emerald-400" />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function StatBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase text-slate-400 font-bold mb-1 tracking-wider">
        {label}
      </span>
      <span
        className={`text-sm font-semibold ${
          highlight ? 'text-sky-600' : 'text-slate-600'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
