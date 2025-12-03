"use client";
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Search, RotateCw } from 'lucide-react';

const supabaseUrl = "https://dtunbzugzcpzunnbvzmh.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dW5ienVnemNwenVubmJ2em1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzY5NjAsImV4cCI6MjA4MDAxMjk2MH0.Hf9k5m30Q6Z4ApjaxlE70fVvrhtUtwkkPvbFrYBwk3o";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function NordicTable() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'FA'>('ALL'); 
  const [search, setSearch] = useState('');

  useEffect(() => { fetchPlayers(); }, []);

  async function fetchPlayers() {
    setLoading(true);
    const { data } = await supabase
      .from('players')
      .select('*')
      .order('fantasy_score', { ascending: false })
      .limit(200);
    setPlayers(data || []);
    setLoading(false);
  }

  const filtered = players.filter(p => {
    const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
    const matchesSearch = p.full_name.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Nordic Scout
            </h1>
            <p className="text-slate-500 mt-1">Yahoo Fantasy Hockey - League 33897</p>
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                placeholder="Search players..." 
                className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg w-72 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
            </div>
            <button 
              onClick={() => setStatusFilter(statusFilter === 'FA' ? 'ALL' : 'FA')}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                statusFilter === 'FA' 
                  ? 'bg-emerald-500 text-white shadow-lg hover:bg-emerald-600' 
                  : 'bg-white border border-slate-200 hover:shadow-md text-slate-700'
              }`}
            >
              {statusFilter === 'FA' ? 'All Players' : 'Free Agents Only'}
            </button>
            <button 
              onClick={fetchPlayers} 
              className="p-3 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all shadow-sm"
              disabled={loading}
            >
              <RotateCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b-2 border-slate-200">
                  <th className="p-6 text-left font-bold text-slate-800 text-lg tracking-tight">PLAYER</th>
                  <th className="p-4 text-center font-bold text-slate-600 text-sm uppercase tracking-wider w-16">POS</th>
                  <th className="p-4 text-center font-bold text-slate-600 text-sm uppercase tracking-wider w-16">TEAM</th>
                  <th className="p-4 text-center font-bold text-slate-600 text-sm uppercase tracking-wider w-24">STATUS</th>
                  <th className="p-4 text-right font-bold text-slate-800 text-xl w-24">SCORE</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">G</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">A</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">+/-</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">PIM</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">PPP</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">SOG</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">HIT</th>
                  <th className="p-3 text-right font-bold text-slate-600 text-xs uppercase tracking-wider w-14">BLK</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="p-20 text-center">
                      <div className="text-slate-400 text-lg">🔄 Syncing Yahoo data...</div>
                    </div>
                  </td>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-20 text-center text-slate-400">
                      No players found. <button onClick={fetchPlayers} className="underline hover:no-underline">Retry sync</button>
                    </td>
                  </tr>
                ) : (
                  filtered.map((p: any, index: number) => (
                    <tr key={p.nhl_id} className="hover:bg-slate-50/50 transition-all group">
                      <td className="p-6 font-semibold text-slate-900 group-hover:text-blue-600">
                        {p.full_name}
                      </td>
                      <td className="p-4 text-center text-sm font-mono text-slate-700 uppercase">{p.position}</td>
                      <td className="p-4 text-center">
                        <span className="w-6 h-6 bg-slate-200 rounded-full text-xs font-bold flex items-center justify-center text-slate-600">
                          {p.team}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          p.status === 'FA'
                            ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-white shadow-lg'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="text-2xl font-black bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                          {p.fantasy_score.toFixed(1)}
                        </div>
                      </td>
                      <td className={`p-3 text-right font-mono text-lg font-bold text-emerald-600 ${p.goals === 0 ? 'opacity-30' : ''}`}>
                        {p.goals}
                      </td>
                      <td className={`p-3 text-right font-mono text-lg font-bold text-blue-600 ${p.assists === 0 ? 'opacity-30' : ''}`}>
                        {p.assists}
                      </td>
                      <td className={`p-3 text-right font-mono text-lg ${p.plus_minus > 0 ? 'text-emerald-600 font-bold' : p.plus_minus < 0 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                        {p.plus_minus}
                      </td>
                      <td className={`p-3 text-right font-mono text-sm ${p.pim > 0 ? 'text-orange-600' : 'text-slate-400'}`}>
                        {p.pim}
                      </td>
                      <td className={`p-3 text-right font-mono text-lg text-purple-600 ${p.ppp === 0 ? 'opacity-30' : ''}`}>
                        {p.ppp}
                      </td>
                      <td className={`p-3 text-right font-mono text-sm text-slate-600 ${p.sog === 0 ? 'opacity-30' : ''}`}>
                        {p.sog}
                      </td>
                      <td className={`p-3 text-right font-mono text-lg text-orange-500 ${p.hits === 0 ? 'opacity-30' : ''}`}>
                        {p.hits}
                      </td>
                      <td className={`p-3 text-right font-mono text-lg text-indigo-600 ${p.blocks === 0 ? 'opacity-30' : ''}`}>
                        {p.blocks}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 p-6 bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-center text-sm text-slate-500">
            <p>💾 <strong>{players.length}</strong> total players | 
            <button onClick={fetchPlayers} className="ml-1 underline hover:no-underline text-blue-600 font-medium">
              Refresh Data
            </button></p>
            <p className="mt-1">🔄 Last sync: <span id="lastSync"></span></p>
          </div>
        </div>
      </div>
    </main>
  );
}
