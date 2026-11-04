import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  HardDrive,
  Folder,
  FileText,
  FileCode,
  Image as ImageIcon,
  File,
  ArrowUp,
  Download,
  RefreshCw,
  Search,
  Sparkles,
  ChevronRight,
  Disc,
  Info,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import "./App.css";

interface DetectedDrive {
  id: string;
  name: string;
  path: string;
  drive_type: string;
  is_removable: boolean;
}

interface VolumeInfo {
  name: string;
  signature: string;
  block_size: number;
  total_blocks: number;
  free_blocks: number;
  file_count: number;
  folder_count: number;
  create_date: string;
  modify_date: string;
  total_size_bytes: number;
  free_size_bytes: number;
}

interface HfsEntry {
  id: number;
  parent_id: number;
  name: string;
  is_directory: boolean;
  size: number;
  create_date: string;
  modify_date: string;
  valence: number;
}

interface Breadcrumb {
  id: number;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function App() {
  const [drives, setDrives] = useState<DetectedDrive[]>([]);
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [currentPath, setCurrentPath] = useState<Breadcrumb[]>([
    { id: 2, name: "Macintosh HD" },
  ]);
  const [entries, setEntries] = useState<HfsEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<HfsEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load drives on mount
  useEffect(() => {
    refreshDrives();
  }, []);

  async function refreshDrives() {
    try {
      const list = await invoke<DetectedDrive[]>("list_drives");
      setDrives(list);
    } catch (e) {
      console.error("Failed to list drives:", e);
    }
  }

  async function openVolumePath(path: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage(`Opening ${path}...`);
    try {
      const info = await invoke<VolumeInfo>("open_volume", {
        sourcePath: path,
        partitionOffset: null,
      });
      setVolume(info);
      setCurrentPath([{ id: 2, name: info.name || "Macintosh HD" }]);
      setSelectedEntry(null);
      await loadDirectory(2);
      setStatusMessage(`Successfully opened ${info.name} (${info.signature})`);
    } catch (e: any) {
      setErrorMessage(typeof e === "string" ? e : e?.message || "Failed to open volume");
      setStatusMessage(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDirectory(folderId: number) {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const items = await invoke<HfsEntry[]>("list_directory", {
        folderId,
      });
      setEntries(items);
    } catch (e: any) {
      setErrorMessage(typeof e === "string" ? e : e?.message || "Failed to list directory");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleBrowseDiskImage() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Apple Disk Images & Raw Volumes",
            extensions: ["img", "dmg", "raw", "iso", "bin"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        await openVolumePath(selected);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleGenerateDemoImage() {
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage("Generating test Apple HFS+ volume image...");
    try {
      const savePath = await save({
        defaultPath: "test-volume.img",
        filters: [{ name: "HFS+ Disk Image", extensions: ["img"] }],
      });

      if (savePath) {
        await invoke("create_test_image", { destPath: savePath });
        setStatusMessage("Generated test HFS+ volume! Loading now...");
        await openVolumePath(savePath);
      }
    } catch (e: any) {
      setErrorMessage(typeof e === "string" ? e : e?.message || "Generation failed");
    } finally {
      setIsLoading(false);
    }
  }

  function handleNavigateInto(entry: HfsEntry) {
    if (entry.is_directory) {
      setCurrentPath([...currentPath, { id: entry.id, name: entry.name }]);
      setSelectedEntry(null);
      loadDirectory(entry.id);
    } else {
      setSelectedEntry(entry);
    }
  }

  function handleNavigateUp() {
    if (currentPath.length > 1) {
      const newPath = currentPath.slice(0, -1);
      const parent = newPath[newPath.length - 1];
      setCurrentPath(newPath);
      setSelectedEntry(null);
      loadDirectory(parent.id);
    }
  }

  function handleBreadcrumbClick(index: number) {
    if (index === currentPath.length - 1) return;
    const target = currentPath[index];
    const newPath = currentPath.slice(0, index + 1);
    setCurrentPath(newPath);
    setSelectedEntry(null);
    loadDirectory(target.id);
  }

  async function handleExtract(entry: HfsEntry) {
    if (entry.is_directory) return;

    try {
      const dest = await save({
        defaultPath: entry.name,
      });

      if (dest) {
        setIsLoading(true);
        setStatusMessage(`Extracting ${entry.name}...`);
        const bytes = await invoke<number>("extract_file", {
          fileId: entry.id,
          targetPath: dest,
        });
        setStatusMessage(`Extracted ${entry.name} (${formatBytes(bytes)}) successfully!`);
      }
    } catch (e: any) {
      setErrorMessage(typeof e === "string" ? e : e?.message || "Failed to extract file");
    } finally {
      setIsLoading(false);
    }
  }

  const filteredEntries = entries.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function getFileIcon(entry: HfsEntry) {
    if (entry.is_directory) {
      return <Folder className="w-5 h-5 text-blue-500 fill-blue-500/20" />;
    }
    const ext = entry.name.split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(ext || "")) {
      return <ImageIcon className="w-5 h-5 text-purple-500" />;
    }
    if (["txt", "md", "json", "xml", "plist"].includes(ext || "")) {
      return <FileText className="w-5 h-5 text-amber-500" />;
    }
    if (["rs", "ts", "js", "html", "css", "c", "cpp", "py"].includes(ext || "")) {
      return <FileCode className="w-5 h-5 text-emerald-500" />;
    }
    return <File className="w-5 h-5 text-zinc-400" />;
  }

  const currentFolder = currentPath[currentPath.length - 1];

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 antialiased overflow-hidden select-none font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-zinc-900/90 border-r border-zinc-800 flex flex-col justify-between shrink-0">
        <div className="p-4 space-y-5 overflow-y-auto">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/30">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-1.5">
                hfs-explorer
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                  v0.1
                </span>
              </h1>
              <p className="text-xs text-zinc-400">Apple HFS+ for Windows</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 px-1">
              Source
            </label>
            <button
              onClick={handleBrowseDiskImage}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg text-zinc-200 transition-colors shadow-sm"
            >
              <Disc className="w-4 h-4 text-blue-400" />
              <span>Open .dmg / .img file...</span>
            </button>

            <button
              onClick={handleGenerateDemoImage}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-blue-900/40 to-indigo-900/40 hover:from-blue-900/60 hover:to-indigo-900/60 border border-blue-500/30 rounded-lg text-blue-200 transition-colors shadow-sm"
            >
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span>Create Test HFS+ Image</span>
            </button>
          </div>

          {/* Physical & Removable Drives */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Connected Drives
              </label>
              <button
                onClick={refreshDrives}
                title="Refresh drives"
                className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              {drives.length === 0 ? (
                <p className="text-xs text-zinc-400 px-2 py-1">No drives detected</p>
              ) : (
                drives.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => openVolumePath(d.path)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 rounded-md transition-colors text-left group"
                  >
                    <HardDrive
                      className={`w-4 h-4 ${
                        d.is_removable ? "text-amber-400" : "text-zinc-400"
                      } group-hover:text-blue-400`}
                    />
                    <div className="truncate">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="text-[10px] text-zinc-400 font-mono truncate">
                        {d.path}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Volume Details */}
          {volume && (
            <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-200 font-semibold">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>Volume Info</span>
              </div>
              <div className="space-y-1 text-zinc-400 text-[11px]">
                <div className="flex justify-between">
                  <span>Name:</span>
                  <span className="text-zinc-200 font-medium">{volume.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Format:</span>
                  <span className="text-zinc-200">{volume.signature}</span>
                </div>
                <div className="flex justify-between">
                  <span>Block Size:</span>
                  <span className="text-zinc-200 font-mono">{volume.block_size} B</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Size:</span>
                  <span className="text-zinc-200 font-mono">
                    {formatBytes(volume.total_size_bytes)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Free Space:</span>
                  <span className="text-zinc-200 font-mono">
                    {formatBytes(volume.free_size_bytes)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Items:</span>
                  <span className="text-zinc-200">
                    {volume.file_count} files, {volume.folder_count} folders
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>Rust + Tauri Engine</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Ready
          </span>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        {/* Navigation / Toolbar */}
        <header className="h-14 border-b border-zinc-800/80 px-4 flex items-center justify-between gap-4 bg-zinc-900/50">
          {/* Breadcrumb Path & Up Button */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleNavigateUp}
              disabled={currentPath.length <= 1 || !volume}
              title="Go to parent directory"
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 transition-colors"
            >
              <ArrowUp className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 text-xs overflow-x-auto whitespace-nowrap py-1">
              {currentPath.map((crumb, idx) => (
                <div key={crumb.id} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                  <button
                    onClick={() => handleBreadcrumbClick(idx)}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      idx === currentPath.length - 1
                        ? "bg-zinc-800 text-zinc-100 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative w-64 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search in folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </header>

        {/* Content View / File List */}
        <div className="flex-1 overflow-y-auto">
          {!volume ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-zinc-400 space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
                <Disc className="w-12 h-12 text-zinc-400" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="text-base font-semibold text-zinc-200">No Volume Open</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Open an Apple `.dmg` / `.img` disk image file, select a connected USB drive, or click below to generate a test HFS+ image.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBrowseDiskImage}
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-sm"
                >
                  Open Disk Image...
                </button>
                <button
                  onClick={handleGenerateDemoImage}
                  className="px-4 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg transition-colors"
                >
                  Generate Test Volume
                </button>
              </div>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-xs">
              <Folder className="w-10 h-10 mb-2 stroke-1 text-zinc-400" />
              <p>This folder is empty</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 text-[11px] uppercase tracking-wider text-zinc-400 bg-zinc-900/30 sticky top-0 backdrop-blur">
                  <th className="py-2.5 px-4 font-semibold">Name</th>
                  <th className="py-2.5 px-4 font-semibold w-32">Date Modified</th>
                  <th className="py-2.5 px-4 font-semibold w-24">Type</th>
                  <th className="py-2.5 px-4 font-semibold w-24 text-right">Size</th>
                  <th className="py-2.5 px-4 font-semibold w-24 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {filteredEntries.map((entry) => {
                  const isSelected = selectedEntry?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => setSelectedEntry(entry)}
                      onDoubleClick={() => handleNavigateInto(entry)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-blue-600/20 text-white"
                          : "hover:bg-zinc-900/60 text-zinc-300"
                      }`}
                    >
                      <td className="py-2 px-4 flex items-center gap-2.5 font-medium">
                        {getFileIcon(entry)}
                        <span className="truncate">{entry.name}</span>
                      </td>
                      <td className="py-2 px-4 text-zinc-400 font-mono text-[11px]">
                        {entry.modify_date}
                      </td>
                      <td className="py-2 px-4 text-zinc-400">
                        {entry.is_directory ? "Folder" : "File"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-zinc-400">
                        {entry.is_directory ? `${entry.valence} items` : formatBytes(entry.size)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {!entry.is_directory && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExtract(entry);
                            }}
                            title="Extract file to Windows"
                            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-blue-400 rounded transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Bottom Status / Selection Bar */}
        <footer className="h-10 border-t border-zinc-800/80 px-4 flex items-center justify-between text-xs bg-zinc-900/40 text-zinc-400">
          <div className="flex items-center gap-3">
            {isLoading && (
              <span className="flex items-center gap-1.5 text-blue-400 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Working...</span>
              </span>
            )}
            {statusMessage && (
              <span className="flex items-center gap-1.5 text-blue-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {statusMessage}
              </span>
            )}
            {errorMessage && (
              <span className="flex items-center gap-1.5 text-rose-400 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {errorMessage}
              </span>
            )}
            {!statusMessage && !errorMessage && volume && (
              <span>
                {filteredEntries.length} items in{" "}
                <span className="text-zinc-200 font-medium">{currentFolder.name}</span>
              </span>
            )}
          </div>

          {selectedEntry && !selectedEntry.is_directory && (
            <div className="flex items-center gap-3">
              <span className="text-zinc-300 font-medium">{selectedEntry.name}</span>
              <span className="text-zinc-400 font-mono">
                {formatBytes(selectedEntry.size)}
              </span>
              <button
                onClick={() => handleExtract(selectedEntry)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Extract File</span>
              </button>
            </div>
          )}
        </footer>
      </main>
    </div>
  );
}
