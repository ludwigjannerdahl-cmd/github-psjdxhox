"use client";

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Activity, TrendingUp, TrendingDown, Search, 
  Download, X, ChevronRight, Zap 
} from 'lucide-react';

// --- CONFIGURATION ---
const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
// Use your PUBLIC key here (starts with eyJhbGciOiJIUzI1Ni...)
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o";
const supabase = createClient(supabaseUrl, supabaseKey);

// --- TYPES ---
interface Player {
  id: string;
  full_name: string;
  team: string;
  position: string;
  status: string;
  goals: number;
  assists: number;
  hits: number;
  blocks: number;
  points: number;
  plus_minus: number;
  // Computed fields
  percentiles?: Record<string, number>;
  overall_score?: number;
}

export default function LudfantasyDashboard() {
  const [rawPlayers, setRawPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'ACTUAL' | 'EXPECTED'>('ACTUAL');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'FA' | 'QA'>('ALL'); // QA = Quality Assets

  // --- 1. FETCH & CALCULATE ENGINE ---
  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase.from('players').select('*');
      if (error) { console.error(error); return; }
      
      if (data) {
        // THE ALGORITHM: Calculate Percentiles
        const processed = calculatePercentiles(data);
        setRawPlayers(processed);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  // --- 2. MATH: PERCENTILE RANK CALCULATION ---
  function calculatePercentiles(data: Player[]) {
    const categories = ['goals', 'assists', 'points', 'hits', 'blocks', 'plus_minus'];
    
    // Create a map to store ranks
    const scoredPlayers = data.map(p => ({ ...p, percentiles: {} as any, overall_score: 0 }));

    categories.forEach(cat => {
      // Sort descending for this category
      const sorted = [...scoredPlayers].sort((a, b) => (b as any)[cat] - (a as any)[cat]);
      const total = sorted.length;

      sorted.forEach((p, index) => {
        // Percentile Formula: (Rank / Total) * 100. 
        // We invert it so Rank 1 = 100th percentile.
        const rank = index + 1;
        const percentile = Math.round(((total - rank) / total) * 100);
        
        // Find the player in our main array and assign the score
        const originalPlayer = scoredPlayers.find(op => op.id === p.id);
        if (originalPlayer) {
          originalPlayer.percentiles[cat] = percentile;
        }
      });
    });

    // Calculate Overall Score (Average of all percentiles)
    scoredPlayers.forEach(p => {
      const sum = Object.values(p.percentiles).reduce((a: number, b: number) => a + b, 0);
      p.overall_score = Math.round(sum / categories.length);
    });

    // Sort by Overall Score by default
    return scoredPlayers.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
  }

  // --- 3. FILTER LOGIC ---
  const displayedPlayers = useMemo(() => {
    return rawPlayers.filter(p => {
      if (filterType === 'FA') return p.status === 'FA';
      if (filterType === 'QA') return (p.overall_score || 0) > 50; // The "Noise Gate"
      return true;
    });
  }, [rawPlayers, filterType]);

  // --- 4. INSIGHTS GENERATOR ---
  const topFA = rawPlayers.filter(p => p.status === 'FA').slice(0, 5);
  // Mock trend for now (Random delta for demo)
  const breakout = rawPlayers.filter(p => (p.overall_score || 0) > 60).slice(3, 8); 

  return (
    <div className="min-h-screen font-sans selection:bg-midnight selection:text-white pb-20">
      
      {/* --- TOP NAVIGATION --- */}
      <nav className="sticky top-0 z-40 glass-panel border-b border-white/20 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-gradient-to-tr from-midnight to-slate-700 rounded-lg flex items-center justify-center text-white font-bold tracking-tighter">
            L
          </div>
          <h1 className="text-xl font-light tracking-[0.1em] uppercase text-charcoal">
            Lud<span className="font-semibold">Fantasy</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex bg-white/50 rounded-full p-1 border border-white/60">
            <button 
              onClick={() => setViewMode('ACTUAL')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${viewMode === 'ACTUAL' ? 'bg-midnight text-white shadow-lg' : 'text-slate-500 hover:text-charcoal'}`}
            >
              ACTUAL
            </button>
            <button 
              onClick={() => setViewMode('EXPECTED')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${viewMode === 'EXPECTED' ? 'bg-midnight text-white shadow-lg' : 'text-slate-500 hover:text-charcoal'}`}
            >
              xMODE
            </button>
          </div>
          <div className="h-4 w-px bg-slate-300"></div>
          <span className="text-[10px] font-medium text-slate-400 tracking-widest uppercase">
            Updated: 08:00
          </span>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto px-8 pt-8">
        
        {/* --- INSIGHT DECK --- */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Card 1: Schedule */}
          <div className="nordic-card p-6 rounded-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
              <Activity size={80} />
            </div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Schedule Advantage</h3>
            <div className="flex items-center gap-3">
              {['VAN', 'TOR', 'EDM', 'NYR'].map(t => (
                <div key={t} className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 border border-slate-200">
                  {t}
                </div>
              ))}
              <span className="ml-2 text-sm font-semibold text-sage-text bg-sage-light px-2 py-1 rounded">+4 Gms</span>
            </div>
          </div>

          {/* Card 2: Top FA */}
          <div className="nordic-card p-6 rounded-2xl">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Top Free Agents</h3>
            <div className="space-y-3">
              {topFA.slice(0, 3).map(p => (
                <div key={p.id} className="flex justify-between items-center group cursor-pointer" onClick={() => setSelectedPlayer(p)}>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                      {p.position}
                    </div>
                    <span className="text-sm font-medium text-charcoal group-hover:text-sage-text transition">{p.full_name}</span>
                  </div>
                  <div className="text-xs font-bold text-sage-text bg-sage-light px-2 py-0.5 rounded-full">
                    {p.overall_score}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: The Breakouts (Mock Data) */}
          <div className="nordic-card p-6 rounded-2xl">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Breakout Alerts</h3>
            <div className="flex items-end justify-between h-20 w-full gap-1 pt-4">
               {[40, 55, 45, 70, 65, 85, 90].map((h, i) => (
                 <div key={i} className="w-full bg-sage/20 rounded-t-sm relative group">
                    <div style={{ height: `${h}%` }} className="absolute bottom-0 w-full bg-sage rounded-t-sm transition-all group-hover:bg-midnight"></div>
                 </div>
               ))}
            </div>
            <div className="mt-2 text-right">
               <span className="text-xs font-medium text-sage-text">+24% Intensity</span>
            </div>
          </div>
        </section>

        {/* --- MASTER GRID CONTROLS --- */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4">
            {['ALL', 'FA', 'QA'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type as any)}
                className={`text-xs font-bold tracking-widest uppercase py-2 border-b-2 transition-all ${filterType === type ? 'border-midnight text-midnight' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                {type === 'QA' ? 'Quality Assets' : type === 'FA' ? 'Free Agents' : 'All Players'}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400 hover:text-midnight transition">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {/* --- THE MASTER GRID --- */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-luxury overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold w-12">#</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold sticky left-0 bg-slate-50/95 backdrop-blur z-10 shadow-sm">Player</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-center">Score</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-right">Goals</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-right">Assists</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-right">Points</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-right">Hits</th>
                <th className="py-4 px-6 text-[10px] uppercase tracking-widest text-slate-400 font-semibold text-right">Blks</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-20 text-center text-slate-400">Initializing Core...</td></tr>
              ) : (
                displayedPlayers.map((p, i) => (
                  <tr 
                    key={p.id} 
                    onClick={() => setSelectedPlayer(p)}
                    className="group border-b border-slate-100 hover:bg-slate-50/80 transition-all cursor-pointer hover:shadow-inner"
                  >
                    <td className="py-4 px-6 text-sm text-slate-400 font-medium tabular-nums">{i + 1}</td>
                    
                    {/* Sticky Name Column */}
                    <td className="py-4 px-6 sticky left-0 bg-white group-hover:bg-slate-50/95 transition-colors z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      <div>
                        <div className="text-sm font-semibold text-charcoal">{p.full_name}</div>
                        <div className="text-[10px] font-medium text-slate-400 mt-0.5 flex gap-2">
                          <span>{p.team}</span>
                          <span>•</span>
                          <span>{p.position}</span>
                          {p.status === 'FA' && <span className="text-sage-text">● FA</span>}
                        </div>
                      </div>
                    </td>

                    {/* Overall Score */}
                    <td className="py-4 px-6 text-center">
                      <span className={`inline-block py-1 px-3 rounded text-xs font-bold tabular-nums ${
                        (p.overall_score || 0) >= 90 ? 'bg-midnight text-white' : 
                        (p.overall_score || 0) >= 70 ? 'bg-sage-light text-sage-text' : 
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {p.overall_score}
                      </span>
                    </td>

                    {/* Stats with Heatmap Logic */}
                    <DataCell value={p.goals} percentile={p.percentiles?.goals || 0} />
                    <DataCell value={p.assists} percentile={p.percentiles?.assists || 0} />
                    <DataCell value={p.points} percentile={p.percentiles?.points || 0} />
                    <DataCell value={p.hits} percentile={p.percentiles?.hits || 0} />
                    <DataCell value={p.blocks} percentile={p.percentiles?.blocks || 0} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* --- DEEP DIVE SIDE SHEET --- */}
      {selectedPlayer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-white/30 backdrop-blur-sm transition-opacity" 
            onClick={() => setSelectedPlayer(null)}
          ></div>
          
          {/* Sheet */}
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl animate-slide-in flex flex-col border-l border-slate-100">
            
            {/* Sheet Header */}
            <div className="p-8 border-b border-slate-100 bg-slate-50/50">
              <button 
                onClick={() => setSelectedPlayer(null)}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-200 transition text-slate-400 hover:text-charcoal"
              >
                <X size={20} />
              </button>
              
              <div className="inline-block px-2 py-1 rounded bg-slate-200 text-[10px] font-bold text-slate-600 mb-4">
                {selectedPlayer.team} • {selectedPlayer.position}
              </div>
              <h2 className="text-3xl font-light text-charcoal mb-1">{selectedPlayer.full_name}</h2>
              <div className="text-4xl font-bold text-midnight tabular-nums flex items-baseline gap-2">
                {selectedPlayer.overall_score} <span className="text-sm font-normal text-slate-400 uppercase tracking-widest">Score</span>
              </div>
            </div>

            {/* Sheet Body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              
              {/* Radar Placeholder */}
              <div className="aspect-square bg-slate-50 rounded-full border border-slate-100 relative flex items-center justify-center">
                <div className="text-xs text-slate-400 uppercase tracking-widest text-center">
                  Production Shape<br/>(Coming Soon)
                </div>
              </div>

              {/* Context Data */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Context</h4>
                <div className="space-y-3">
                  <div className="flex justify-between p-4 bg-alabaster rounded-lg">
                    <span className="text-sm text-slate-500">Line Deployment</span>
                    <span className="text-sm font-bold text-charcoal">L1 / PP1</span>
                  </div>
                  <div className="flex justify-between p-4 bg-alabaster rounded-lg">
                    <span className="text-sm text-slate-500">Ownership</span>
                    <span className="text-sm font-bold text-charcoal">{selectedPlayer.status === 'TAKEN' ? 'Owned' : 'Available (FA)'}</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Sheet Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50/30">
              <button className="w-full py-4 bg-midnight text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2">
                <Zap size={16} /> ADD TO WATCHLIST
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

// --- HELPER COMPONENTS ---

function DataCell({ value, percentile }: { value: number, percentile: number }) {
  // Heatmap Logic: Opacity based on percentile
  let bgClass = "bg-transparent";
  let textClass = "text-slate-600";

  if (percentile >= 90) {
    bgClass = "bg-sage-light"; // High value
    textClass = "text-sage-text font-bold";
  } else if (percentile >= 75) {
    bgClass = "bg-slate-100"; 
    textClass = "text-charcoal font-semibold";
  } else if (percentile <= 25) {
    textClass = "text-slate-400"; // Low value dimming
  }

  return (
    <td className="py-4 px-6 text-right">
      <div className={`inline-block px-2 py-1 rounded ${bgClass} ${textClass} tabular-nums text-sm min-w-[3rem] text-center transition-colors`}>
        {value}
      </div>
    </td>
  );
}