"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Activity, TrendingUp, Filter, Download, ArrowUpRight } from 'lucide-react';

// --- CONFIGURATION ---
const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o"; // Public Key
const supabase = createClient(supabaseUrl, supabaseKey);

export default function NordicTerminal() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState('ALL'); // ALL, FA, TRENDING

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    const { data } = await supabase
      .from('players')
      .select('*')
      .order('fantasy_score', { ascending: false });
    
    setPlayers(data || []);
    setLoading(false);
  }

  // "The Relevance Filter": Only show trends if Score > 50
  const filteredPlayers = players.filter(p => {
    if (filterMode === 'FA') return p.status === 'FA';
    if (filterMode === 'TRENDING') return p.fantasy_score > 50; // Add real trend logic later
    return true;
  });

  return (
    <main className="min-h-screen bg-[#FDFDFD] text-[#1e293b] font-sans selection:bg-slate-200">
      
      {/* 1. TOP WIDGETS (Financial Ticker Style) */}
      <div className="border-b border-slate-100 bg-white sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-xl tracking-tight font-medium text-slate-900">
              The Nordic <span className="font-bold text-slate-400">Edge</span>
            </h1>
            <span className="bg-slate-100 text-[10px] uppercase font-bold px-2 py-1 rounded text-slate-500">v3.0</span>
          </div>
          
          <div className="flex gap-6 text-xs font-medium text-slate-500">
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wider text-slate-400">Top FA Target</span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Filip Forsberg (92.4)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wider text-slate-400">Busy Schedule</span>
              <span className="text-slate-700">EDM (4 Games)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        
        {/* 2. CONTROLS BAR */}
        <div className="flex justify-between items-end mb-6">
          <div className="flex gap-2">
            <FilterBtn label="All Market" active={filterMode === 'ALL'} onClick={() => setFilterMode('ALL')} />
            <FilterBtn label="Free Agents" active={filterMode === 'FA'} onClick={() => setFilterMode('FA')} />
            <FilterBtn label="Trending > 50" active={filterMode === 'TRENDING'} onClick={() => setFilterMode('TRENDING')} icon={<TrendingUp size={14} />} />
          </div>
          <button className="text-xs font-bold text-slate-400 hover:text-slate-700 flex items-center gap-2 transition">
            <Download size={14} /> EXPORT CSV
          </button>
        </div>

        {/* 3. THE MASTER SCREENER (Dense Grid) */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          {/* Header Row */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            <div className="col-span-3">Player Context</div>
            <div className="col-span-1 text-center">Status</div>
            <div className="col-span-1 text-right">Score (0-100)</div>
            <div className="col-span-7 grid grid-cols-6 text-center">
              <span>G</span><span>A</span><span>HIT</span><span>BLK</span><span>PPP</span><span>SOG</span>
            </div>
          </div>

          {/* Data Rows */}
          {loading ? (
            <div className="p-12 text-center text-slate-300 animate-pulse">Loading Market Data...</div>
          ) : (
            filteredPlayers.map((p, i) => (
              <div key={p.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors items-center group">
                
                {/* Name & Rank */}
                <div className="col-span-3 flex items-center gap-3">
                  <span className="text-slate-300 font-mono text-xs w-6 text-right">{i + 1}</span>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{p.full_name}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{p.team} • {p.position}</div>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="col-span-1 text-center">
                  {p.status === 'FA' ? (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded">FA</span>
                  ) : (
                    <span className="text-slate-300 text-[10px] font-bold">TAKEN</span>
                  )}
                </div>

                {/* The "Nordic Edge" Score */}
                <div className="col-span-1 text-right">
                  <div className={`text-sm font-bold ${p.fantasy_score > 90 ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {p.fantasy_score}
                  </div>
                  {/* Fake Trend Arrow for Demo */}
                  {p.fantasy_score > 50 && (
                     <div className="text-[9px] text-emerald-600 flex items-center justify-end gap-0.5">
                       <ArrowUpRight size={10} /> +2.4
                     </div>
                  )}
                </div>

                {/* The Greeks (Stats Heatmap) */}
                <div className="col-span-7 grid grid-cols-6 text-center text-sm font-medium text-slate-600">
                  <HeatCell value={p.goals} max={30} />
                  <HeatCell value={p.assists} max={50} />
                  <HeatCell value={p.hits} max={100} />
                  <HeatCell value={p.blocks} max={80} />
                  <HeatCell value={p.ppp} max={20} />
                  <HeatCell value={p.sog} max={200} />
                </div>

              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

// Sub-components
function FilterBtn({ label, active, onClick, icon }: any) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-md border flex items-center gap-2 transition-all ${
        active 
          ? 'bg-slate-900 text-white border-slate-900' 
          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
      }`}
    >
      {icon} {label}
    </button>
  );
}

function HeatCell({ value, max }: { value: number, max: number }) {
  // Simple opacity heatmap logic
  const intensity = Math.min(value / max, 1);
  const isHigh = intensity > 0.7;
  
  return (
    <div className={`py-1 rounded ${isHigh ? 'bg-emerald-50 text-emerald-700 font-bold' : ''}`}>
      {value}
    </div>
  );
}