"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Search, RotateCw, Filter } from 'lucide-react';

// --- CONFIGURATION ---
const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function NordicTable() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL'); 
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPlayers();
  }, []);

  async function fetchPlayers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('fantasy_score', { ascending: false })
      .limit(200);

    if (error) console.error('Error:', error);
    else setPlayers(data || []);
    setLoading(false);
  }

  const filtered = players.filter(p => {
    const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
    const matchesSearch = p.full_name.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <main className="min-h-screen bg-white text-slate-900 p-8">
      
      {/* HEADER TOOLBAR */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nordic Scout</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest">Season 2025/2026</p>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search player..." 
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-slate-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filter Toggles */}
          <div className="flex bg-slate-100 p-1 rounded-md">
            <button 
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1 text-xs font-bold rounded ${statusFilter === 'ALL' ? 'bg-white shadow text-black' : 'text-slate-500'}`}
            >
              All
            </button>
            <button 
              onClick={() => setStatusFilter('FA')}
              className={`px-3 py-1 text-xs font-bold rounded ${statusFilter === 'FA' ? 'bg-white shadow text-green-600' : 'text-slate-500'}`}
            >
              Free Agents
            </button>
          </div>
          
          <button onClick={fetchPlayers} className="p-2 hover:bg-slate-100 rounded-full">
            <RotateCw className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* DATA TABLE */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">Player</th>
              <th className="px-2 py-3 text-center">Pos</th>
              <th className="px-2 py-3 text-center">Team</th>
              <th className="px-2 py-3 text-center">Status</th>
              <th className="px-2 py-3 text-right bg-slate-100/50">Score</th>
              
              {/* Stats Columns */}
              <th className="px-2 py-3 text-right w-12">G</th>
              <th className="px-2 py-3 text-right w-12">A</th>
              <th className="px-2 py-3 text-right w-12">+/-</th>
              <th className="px-2 py-3 text-right w-12">PIM</th>
              <th className="px-2 py-3 text-right w-12">PPP</th>
              <th className="px-2 py-3 text-right w-12">SOG</th>
              <th className="px-2 py-3 text-right w-12">HIT</th>
              <th className="px-2 py-3 text-right w-12">BLK</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
               <tr><td colSpan={13} className="text-center py-10 text-slate-400">Loading Data...</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-4 py-2 font-medium text-slate-900">
                  {p.full_name}
                </td>
                <td className="px-2 py-2 text-center text-xs text-slate-500">{p.position}</td>
                <td className="px-2 py-2 text-center text-xs text-slate-400">{p.team}</td>
                <td className="px-2 py-2 text-center">
                  {p.status === 'FA' ? (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded font-bold">FA</span>
                  ) : (
                    <span className="text-slate-300 text-[10px] font-bold">TAKEN</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-bold text-slate-900 bg-slate-50/50">
                  {Math.round(p.fantasy_score)}
                </td>

                {/* Stat Cells (Dimmed if 0) */}
                <td className={`px-2 py-2 text-right ${p.goals > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.goals}</td>
                <td className={`px-2 py-2 text-right ${p.assists > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.assists}</td>
                <td className={`px-2 py-2 text-right ${p.plus_minus !== 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.plus_minus}</td>
                <td className={`px-2 py-2 text-right ${p.pim > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.pim}</td>
                <td className={`px-2 py-2 text-right ${p.ppp > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.ppp}</td>
                <td className={`px-2 py-2 text-right ${p.sog > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.sog}</td>
                <td className={`px-2 py-2 text-right ${p.hits > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.hits}</td>
                <td className={`px-2 py-2 text-right ${p.blocks > 0 ? 'text-slate-700' : 'text-slate-200'}`}>{p.blocks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}