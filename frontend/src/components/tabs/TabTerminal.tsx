import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2, Copy, Check, CornerDownLeft, Play, Sparkles } from 'lucide-react';
import { api } from '../../api/client';

interface TabTerminalProps {
  deviceId?: string;
  deviceName?: string;
}

interface CommandLog {
  id: string;
  time: string;
  command: string;
  output: string;
  isError?: boolean;
}

const PRESET_COMMANDS = [
  { label: 'IP Address', cmd: '/ip address print' },
  { label: 'Interfaces', cmd: '/interface print' },
  { label: 'IP Routes', cmd: '/ip route print' },
  { label: 'ARP Table', cmd: '/ip arp print' },
  { label: 'DHCP Leases', cmd: '/ip dhcp-server lease print' },
  { label: 'System Resource', cmd: '/system resource print' },
  { label: 'Wireless Reg', cmd: '/interface wireless registration-table print' },
  { label: 'Ping Gateway', cmd: '/tool ping 192.168.88.1 count=4' },
  { label: 'DNS Settings', cmd: '/ip dns print' },
  { label: 'Clock & NTP', cmd: '/system clock print' },
];

export const TabTerminal: React.FC<TabTerminalProps> = ({
  deviceId = '',
  deviceName = 'MikroTik',
}) => {
  const [inputCmd, setInputCmd] = useState('');
  const [logs, setLogs] = useState<CommandLog[]>([
    {
      id: 'init-1',
      time: new Date().toLocaleTimeString(),
      command: '# Selamat datang di Winbox Web CLI Console',
      output: `Koneksi aktif ke RouterOS: ${deviceName} (API port 8728)\nKetik perintah RouterOS apa saja (contoh: /ip address print) atau pilih preset di bawah.`,
    },
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleRunCommand = async (cmdToRun: string) => {
    const trimmed = cmdToRun.trim();
    if (!trimmed || isExecuting) return;

    setIsExecuting(true);
    setInputCmd('');
    setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)]);
    setHistoryIndex(-1);

    const timeStr = new Date().toLocaleTimeString();
    const tempId = `cmd-${Date.now()}`;

    try {
      const res = await api.executeTerminalCommand(deviceId, trimmed);
      setLogs((prev) => [
        ...prev,
        {
          id: tempId,
          time: timeStr,
          command: trimmed,
          output: res.output || '(Perintah sukses tanpa output)',
        },
      ]);
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        {
          id: tempId,
          time: timeStr,
          command: trimmed,
          output: `ERROR: ${err.message}`,
          isError: true,
        },
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRunCommand(inputCmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setInputCmd(history[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputCmd(history[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputCmd('');
      }
    }
  };

  const handleClear = () => {
    setLogs([]);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-3 font-mono">
      {/* Top Presets & Controls */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900 block">Winbox Web CLI Terminal</span>
            <span className="text-[10px] text-slate-500">RouterOS Native Command Interface</span>
          </div>
          <span className="ml-2 px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-700 font-semibold">
            [admin@{deviceName}]
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 text-xs flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer font-sans font-medium"
            title="Bersihkan Layar Terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Screen</span>
          </button>
        </div>
      </div>

      {/* Preset Command Buttons */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <span className="text-[11px] text-slate-500 uppercase font-semibold flex items-center gap-1 shrink-0 mr-1">
          <Sparkles className="w-3 h-3 text-blue-600" />
          Quick CLI:
        </span>
        {PRESET_COMMANDS.map((p) => (
          <button
            key={p.cmd}
            onClick={() => handleRunCommand(p.cmd)}
            disabled={isExecuting}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 hover:border-blue-400 text-slate-700 hover:text-blue-700 text-xs shrink-0 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Play className="w-2.5 h-2.5 text-blue-600" />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Terminal Screen Console */}
      <div className="bg-slate-950 border border-slate-300 rounded-2xl p-5 shadow-lg min-h-[460px] max-h-[620px] overflow-y-auto flex flex-col text-xs leading-relaxed">
        <div className="space-y-4 flex-1">
          {logs.map((log) => (
            <div key={log.id} className="group relative">
              {/* Command Prompt Line */}
              <div className="flex items-center justify-between text-slate-400 text-[11px] border-b border-slate-800 pb-1.5 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">[admin@{deviceName}] &gt;</span>
                  <span className="text-white font-semibold">{log.command}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">{log.time}</span>
                  <button
                    onClick={() => handleCopy(log.id, `${log.command}\n\n${log.output}`)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-white transition-opacity cursor-pointer"
                    title="Copy Output"
                  >
                    {copiedId === log.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Output Content */}
              <pre
                className={`whitespace-pre-wrap break-all pl-2 font-mono ${
                  log.isError
                    ? 'text-rose-400 bg-rose-950/40 p-3 rounded-xl border border-rose-800/50'
                    : 'text-slate-200'
                }`}
              >
                {log.output}
              </pre>
            </div>
          ))}

          {isExecuting && (
            <div className="flex items-center gap-2 text-blue-400 animate-pulse text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
              <span>Mengeksekusi perintah di MikroTik...</span>
            </div>
          )}

          <div ref={terminalEndRef} />
        </div>

        {/* Command Input Bar */}
        <div className="mt-4 pt-3.5 border-t border-slate-800 flex items-center gap-2.5">
          <span className="text-emerald-400 font-bold text-xs shrink-0">
            [admin@{deviceName}] &gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputCmd}
            onChange={(e) => setInputCmd(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            placeholder="Ketik perintah RouterOS... (misal: /ip route print) | ↑↓ untuk history"
            className="flex-1 bg-transparent text-white placeholder-slate-500 focus:outline-none font-mono text-xs caret-emerald-400"
            autoFocus
          />
          <button
            onClick={() => handleRunCommand(inputCmd)}
            disabled={isExecuting || !inputCmd.trim()}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors shrink-0 flex items-center gap-1 cursor-pointer font-sans text-xs font-semibold"
            title="Kirim Perintah (Enter)"
          >
            <span>Run</span>
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
