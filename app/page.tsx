"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Activity, TrendingUp } from 'lucide-react';

// --- HARDCODED KEYS (PUBLIC ACCESS) ---
const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
// This is your PUBLIC (anon) key. It is safe for the browser.
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o";

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
    // Fetch players sorted by Fantasy Score
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('fantasy_score', { ascending: false })
      .limit(100);

    if (error) {
        console.error('Error fetching:', error);
    } else {
        setPlayers(data || []);
    }
    setLoading(false);
  }

  const displayedPlayers = filter === 'FA' 
    ? players.filter((p: any) => p.status === 'FA') 
    : players;

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto bg-slate-50">
      
      {/* HEADER */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-end border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-4xl font-light tracking-tight text-slate-900 mb-2">
            Nordic <span className="font-bold text-sky-600">Scout</span>
          </h1>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Activity size={14} className="text-sky-500" /> 
            Live Intelligence
          </p>
        </div>

        {/* CONTROLS */}
        <div className="flex gap-3 mt-4 md:mt-0">
          <button 
            onClick={() => setFilter('ALL')}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${filter === 'ALL' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            All Players
          </button>
          <button 
            onClick={() => setFilter('FA')}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all ${filter === 'FA' ? 'bg-sky-500 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            Free Agents
          </button>
        </div>
      </header>

      {/* LOADING STATE */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"></div>
        </div>
      ) : (
        /* PLAYER GRID */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedPlayers.map((player: any) => (
            <div key={player.id} className="nordic-card rounded-xl p-5 bg-white group hover:border-sky-200 transition-colors">
              
              {/* Card Header */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg text-slate-800 leading-tight group-hover:text-sky-600 transition-colors">
                    {player.full_name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-1.5 py-0.5 rounded">{player.team}</span>
                    <span className="text-slate-400 text-xs font-medium">{player.position}</span>
                    {player.status === 'FA' && (
                      <span className="text-emerald-600 text-[10px] font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                        Available
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-900">{player.fantasy_score}</div>
                  <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">Score</div>
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-2 pt-4 border-t border-slate-50">
                <StatBox label="G" value={player.goals} highlight={player.goals >= 30} />
                <StatBox label="A" value={player.assists} highlight={player.assists >= 50} />
                <StatBox label="HIT" value={player.hits} highlight={player.hits >= 100} />
                <StatBox label="BLK" value={player.blocks} highlight={player.blocks >= 100} />
              </div>
              
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function StatBox({ label, value, highlight }: { label: string, value: number, highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] font-bold text-slate-300 uppercase">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? 'text-sky-600' : 'text-slate-600'}`}>{value}</span>
    </div>
  );
}