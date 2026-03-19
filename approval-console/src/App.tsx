import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, XCircle, Clock, ShieldAlert, FileJson, Settings, ChevronLeft, Save, Activity } from 'lucide-react';
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Data Types based on Prisma Schema
type Task = {
  id: string;
  objective: string;
  status: 'PENDING' | 'PROCESSING' | 'AWAITING_HUMAN' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  expiresAt: string | null;
  createdAt: string;
};

type Proposal = {
  id: string;
  taskId: string;
  recommendedOption: any;
  status: string;
  task: Task;
};

type Decision = {
  id: string;
  proposalId: string;
  decisionType: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  policyResults: any;
  constraints: any;
  proposal: Proposal;
  createdAt: string;
};

function App() {
  const [escalations, setEscalations] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [toastMsg, setToastMsg] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  
  // Settings View State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ active_provider: 'openai', openai_key: '', anthropic_key: '', model: '', base_url: '' });
  const [settingsStatus, setSettingsStatus] = useState({ has_openai_key: false, has_anthropic_key: false });
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    fetchEscalations();
    fetchSettings();
    const interval = setInterval(fetchEscalations, 5000); 
    return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings/llm', {
        headers: { 
           'x-tenant-id': 'default_tenant', 
           'x-api-key': import.meta.env.VITE_API_KEY || 'development_admin_key',
           'x-user-id': 'admin_123'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setSettingsStatus(data);
        setSettings(prev => ({
          ...prev,
          active_provider: data.active_provider,
          model: data.model || '',
          base_url: data.base_url || '',
        }));
      }
    } catch (e) { console.error(e); }
  }

  const fetchEscalations = async () => {
    try {
      const response = await fetch('/api/decisions', {
         headers: {
            'x-tenant-id': 'default_tenant',
            'x-api-key': import.meta.env.VITE_API_KEY || 'development_admin_key',
            'x-user-id': 'admin_123'
         }
      });
      if (response.ok) {
         const data = await response.json();
         setEscalations(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOverride = async (decisionId: string) => {
    try {
        const res = await fetch(`/api/decisions/${decisionId}/override`, {
            method: 'POST',
            headers: {
                'x-tenant-id': 'default_tenant',
                'x-api-key': import.meta.env.VITE_API_KEY || 'development_admin_key',
                'x-user-id': 'admin_123'
            }
        });
        if (!res.ok) {
             const errorData = await res.json();
             throw new Error(errorData.error || 'Override failed');
        }
        setToastMsg({ message: `Successfully Overrode Decision ${decisionId.split('-')[0]}`, type: 'success' });
        setTimeout(() => setToastMsg(null), 3000);
        setEscalations(prev => prev.filter(d => d.id !== decisionId));
        setSelectedDecision(null);
    } catch (e: any) {
        setToastMsg({ message: `Override failed: ${e.message}`, type: 'error' });
        setTimeout(() => setToastMsg(null), 4000);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/settings/llm/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'default_tenant', 'x-api-key': import.meta.env.VITE_API_KEY || 'development_admin_key' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) throw new Error('Save failed');
      
      setToastMsg({ message: 'Settings saved and encrypted successfully.', type: 'success' });
      setTimeout(() => setToastMsg(null), 3000);
      fetchSettings();
    } catch (e: any) {
      setToastMsg({ message: `Save failed: ${e.message}`, type: 'error' });
      setTimeout(() => setToastMsg(null), 4000);
    }
  };

  const handleTestConnection = async (provider: string) => {
    setIsTesting(true);
    try {
      const res = await fetch('/api/settings/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'default_tenant', 'x-api-key': import.meta.env.VITE_API_KEY || 'development_admin_key' },
        body: JSON.stringify({
          provider,
          key: provider === 'openai' || provider === 'custom' ? settings.openai_key : provider === 'anthropic' ? settings.anthropic_key : undefined,
          model: settings.model || undefined,
          base_url: settings.base_url || undefined,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setToastMsg({ message: `Test Passed: ${data.message}`, type: 'success' });
      setTimeout(() => setToastMsg(null), 4000);
    } catch (e: any) {
      setToastMsg({ message: `Test Failed: ${e.message}`, type: 'error' });
      setTimeout(() => setToastMsg(null), 5000);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 p-8 font-sans">
      {toastMsg && (
        <div className={cn(
           "fixed top-4 right-4 p-4 rounded-xl shadow-lg transition-all z-50 flex items-center gap-3 border",
           toastMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        )}>
            {toastMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5"/> : <XCircle className="w-5 h-5"/>}
            {toastMsg.message}
        </div>
      )}
      <header className="mb-12 border-b border-slate-800 pb-6 flex justify-between items-end">
        <div>
          <div className="flex items-center gap-3 mb-2">
             <ShieldAlert className="w-8 h-8 text-indigo-500" />
             <h1 className="text-3xl font-bold tracking-tight text-white">Governor Approval Console</h1>
          </div>
          <p className="text-slate-400">Review and orchestrate pending AWAITING_HUMAN escalated tasks.</p>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 flex items-center gap-2 transition-colors"
        >
          {showSettings ? <><ChevronLeft className="w-4 h-4"/> Back to Queue</> : <><Settings className="w-4 h-4"/> LLM Settings</>}
        </button>
      </header>

      <main className="max-w-6xl mx-auto">
        {showSettings ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 max-w-3xl mx-auto shadow-xl">
             <div className="mb-8">
               <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-3"><Settings className="w-6 h-6 text-indigo-400"/> Multi-Provider Configuration</h2>
               <p className="text-slate-400 mt-2">Manage backend LLM providers and AES-256 encrypted API keys.</p>
             </div>

             <div className="space-y-6">
                <div>
                   <label className="block text-sm font-medium text-slate-300 mb-2">Active Intelligence Provider</label>
                   <select 
                     className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                     value={settings.active_provider}
                     onChange={(e) => setSettings({...settings, active_provider: e.target.value})}
                   >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="ollama">Ollama (Local)</option>
                      <option value="custom">Custom (OpenAI-Compatible)</option>
                   </select>
                   <p className="mt-2 text-xs text-slate-500">
                     {settings.active_provider === 'ollama' && 'Connects to a local Ollama server. No API key needed — just have Ollama running.'}
                     {settings.active_provider === 'custom' && 'Any server with an OpenAI-compatible /v1/chat/completions endpoint (LM Studio, vLLM, LocalAI, etc).'}
                   </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Model Name</label>
                    <input 
                      type="text" 
                      placeholder={
                        settings.active_provider === 'openai' ? 'gpt-4o-mini' :
                        settings.active_provider === 'anthropic' ? 'claude-3-haiku-20240307' :
                        settings.active_provider === 'ollama' ? 'llama3' : 'model-name'
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                      value={settings.model}
                      onChange={(e) => setSettings({...settings, model: e.target.value})}
                    />
                    <p className="mt-1 text-xs text-slate-500">Leave blank for provider default.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Base URL (optional)</label>
                    <input 
                      type="text" 
                      placeholder={
                        settings.active_provider === 'ollama' ? 'http://localhost:11434/v1' :
                        settings.active_provider === 'custom' ? 'http://localhost:1234/v1' : 'https://api.openai.com/v1'
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                      value={settings.base_url}
                      onChange={(e) => setSettings({...settings, base_url: e.target.value})}
                    />
                    <p className="mt-1 text-xs text-slate-500">Override the default API endpoint.</p>
                  </div>
                </div>

                {(settings.active_provider === 'openai' || settings.active_provider === 'custom') && (
                <div className="pt-6 border-t border-slate-800/80">
                   <div className="flex justify-between mb-2">
                     <label className="block text-sm font-medium text-slate-300">OpenAI API Key</label>
                     {settingsStatus.has_openai_key && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Currently Configured</span>}
                   </div>
                   <input 
                     type="password" 
                     placeholder={settingsStatus.has_openai_key ? "••••••••••••••••••••••••••••" : "sk-..."}
                     className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                     value={settings.openai_key}
                     onChange={(e) => setSettings({...settings, openai_key: e.target.value})}
                   />
                </div>
                )}

                {settings.active_provider === 'anthropic' && (
                <div className="pt-6 border-t border-slate-800/80">
                   <div className="flex justify-between mb-2">
                     <label className="block text-sm font-medium text-slate-300">Anthropic API Key</label>
                     {settingsStatus.has_anthropic_key && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Currently Configured</span>}
                   </div>
                   <input 
                     type="password" 
                     placeholder={settingsStatus.has_anthropic_key ? "••••••••••••••••••••••••••••" : "sk-ant-..."}
                     className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                     value={settings.anthropic_key}
                     onChange={(e) => setSettings({...settings, anthropic_key: e.target.value})}
                   />
                </div>
                )}

                {settings.active_provider === 'ollama' && (
                <div className="pt-6 border-t border-slate-800/80 rounded-lg bg-slate-800/20 p-4">
                   <p className="text-sm text-slate-400">
                     Ollama runs locally and doesn't need an API key. Make sure Ollama is running
                     (<code className="text-indigo-400">ollama serve</code>) and you've pulled a model
                     (<code className="text-indigo-400">ollama pull llama3</code>).
                   </p>
                </div>
                )}

                <div className="pt-6 border-t border-slate-800/80 flex justify-between items-center">
                   <button onClick={() => handleTestConnection(settings.active_provider)} disabled={isTesting} className="text-sm px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-2 disabled:opacity-50 transition-colors">
                     <Activity className="w-4 h-4"/> {isTesting ? 'Testing...' : 'Test Connection'}
                   </button>
                   <button 
                     onClick={handleSaveSettings}
                     className="px-6 py-3 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-2"
                   >
                     <Save className="w-5 h-5"/> Save Configuration
                   </button>
                </div>
             </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Col: Queue */}
        <div className="lg:col-span-5 space-y-4">
           <h2 className="text-xl font-semibold mb-4 text-slate-100 flex items-center gap-2">
             <Clock className="w-5 h-5 text-amber-500" /> 
             Pending Queue ({escalations.length})
           </h2>
           
           {loading ? (
              <div className="animate-pulse flex space-x-4 p-4 border border-slate-800 rounded-xl bg-slate-900/50">
                 <div className="flex-1 space-y-4 py-1">
                   <div className="h-4 bg-slate-800 rounded w-3/4"></div>
                   <div className="space-y-2">
                     <div className="h-4 bg-slate-800 rounded"></div>
                     <div className="h-4 bg-slate-800 rounded w-5/6"></div>
                   </div>
                 </div>
              </div>
           ) : escalations.length === 0 ? (
              <div className="p-8 border border-slate-800 border-dashed rounded-xl flex flex-col items-center justify-center text-slate-500">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500/50" />
                  <p>All clear! No tasks await human approval.</p>
              </div>
           ) : (
              escalations.map(dec => (
                  <div 
                    key={dec.id} 
                    onClick={() => setSelectedDecision(dec)}
                    className={cn(
                        "p-5 rounded-xl border transition-all cursor-pointer shadow-sm",
                        selectedDecision?.id === dec.id 
                           ? "border-indigo-500 bg-indigo-500/10 shadow-indigo-500/20" 
                           : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-800/50"
                    )}
                  >
                     <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-mono px-2 py-1 rounded bg-slate-800 text-slate-300">
                           {dec.proposal.task.id.split('-')[0]}
                        </span>
                        <span className="text-xs font-medium px-2 py-1 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> {dec.riskLevel} RISK
                        </span>
                     </div>
                     <h3 className="font-medium text-slate-200 line-clamp-2 leading-snug">
                        {dec.proposal.task.objective}
                     </h3>
                     <div className="mt-4 flex items-center text-xs text-slate-500 gap-2">
                        <Clock className="w-3 h-3" />
                        <span>Expires {dec.proposal.task.expiresAt ? new Date(dec.proposal.task.expiresAt).toLocaleDateString() : 'No expiry set'}</span>
                     </div>
                  </div>
              ))
           )}
        </div>

        {/* Right Col: Details Panel */}
        <div className="lg:col-span-7">
           {selectedDecision ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                 {/* Top Accent Line */}
                 <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 to-indigo-500"></div>
                 
                 <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white mb-2 leading-tight">Action Review</h2>
                    <p className="text-slate-400">{selectedDecision.proposal.task.objective}</p>
                 </div>

                 <div className="space-y-6">
                    <div>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                           <FileJson className="w-4 h-4" /> Minister Proposal Payload
                        </h4>
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-sm overflow-x-auto text-emerald-400 shadow-inner">
                            <pre>{JSON.stringify(selectedDecision.proposal.recommendedOption, null, 2)}</pre>
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
                           <XCircle className="w-4 h-4 text-rose-500" /> Governor Rejection Context
                        </h4>
                        <div className="space-y-2">
                            {Object.values(selectedDecision.policyResults || {}).map((pol: any, idx: number) => (
                                <div key={idx} className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4 flex items-start gap-3">
                                    <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="font-medium text-rose-200">{pol.policyId || 'Policy Constraint'}</div>
                                        <div className="text-sm text-rose-300/80 mt-1">{pol.reason || 'Failed to meet criteria.'}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                 </div>

                 <div className="mt-10 pt-6 border-t border-slate-800 flex justify-end gap-4">
                     <button 
                        onClick={() => setSelectedDecision(null)}
                        className="px-5 py-2.5 rounded-lg font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                     >
                         Cancel
                     </button>
                     <button 
                        onClick={() => handleOverride(selectedDecision.id)}
                        className="px-6 py-2.5 rounded-lg font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-all active:scale-95 flex items-center gap-2"
                     >
                         <ShieldAlert className="w-4 h-4" />
                         Approve Override
                     </button>
                 </div>
              </div>
           ) : (
              <div className="h-full min-h-[500px] border border-slate-800 border-dashed rounded-2xl flex flex-col items-center justify-center text-slate-600 bg-slate-900/20">
                  <ShieldAlert className="w-16 h-16 mb-4 text-slate-700" />
                  <p className="text-lg">Select an escalated task to review</p>
              </div>
           )}
        </div>
        </div>
      )}
      </main>
    </div>
  );
}

export default App;
