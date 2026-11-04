import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
  ShieldCheck,
  FolderDown,
  ExternalLink,
  Copy,
  X,
  FileSearch,
  GripVertical,
  UploadCloud,
  FileUp,
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

interface ExtentDescriptor {
  start_block: number;
  block_count: number;
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
  extents?: ExtentDescriptor[];
}

interface Breadcrumb {
  id: number;
  name: string;
}

interface ExtractionStats {
  files_count: number;
  folders_count: number;
  bytes_written: number;
  destination_path: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: HfsEntry;
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
  const [lastExtractedPath, setLastExtractedPath] = useState<string | null>(null);

  // Drag and Drop States
  const [isDraggingIn, setIsDraggingIn] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<string[] | null>(null);
  const [isDraggingOut, setIsDraggingOut] = useState(false);

  // Context Menu & Modals
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inspectedEntry, setInspectedEntry] = useState<HfsEntry | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Native Tauri Window Drag-Drop Listener (Dragging Files IN from Windows)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const appWindow = getCurrentWebviewWindow();
      appWindow
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDraggingIn(true);
          } else if (event.payload.type === "leave") {
            setIsDraggingIn(false);
          } else if (event.payload.type === "drop") {
            setIsDraggingIn(false);
            if (event.payload.paths && event.payload.paths.length > 0) {
              setDroppedFiles(event.payload.paths);
            }
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((err) => {
          console.error("Failed to register drag-drop listener:", err);
        });
    } catch (e) {
      console.error(e);
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Close context menu on outside click or escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setContextMenu(null);
        setInspectedEntry(null);
        setShowSafetyModal(false);
        setDroppedFiles(null);
      }
    }
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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
    setLastExtractedPath(null);
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
    setLastExtractedPath(null);
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

  function handleContextMenu(e: React.MouseEvent, entry: HfsEntry) {
    e.preventDefault();
    setSelectedEntry(entry);
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    setContextMenu({ x, y, entry });
  }

  // Drag-OUT: Dragging a file/folder OUT of the app to Windows Desktop / Explorer
  async function handleDragOutStart(e: React.DragEvent, entry: HfsEntry) {
    e.preventDefault();
    setIsDraggingOut(true);
    setStatusMessage(`Preparing "${entry.name}" for drag-and-drop...`);

    try {
      // 1. Prepare/extract item into Windows temp drag cache
      const cachedFilePath = await invoke<string>("prepare_drag_entry", {
        entryId: entry.id,
      });

      // 2. Trigger native Windows OLE drag via tauri-plugin-drag
      await invoke("plugin:drag|start_drag", {
        item: [cachedFilePath],
      });

      setStatusMessage(`Dragged out "${entry.name}" to Windows`);
    } catch (err: any) {
      console.warn("Native drag-out fallback:", err);
      // Fallback: prompt extraction dialog if OLE drag is cancelled or unsupported
      await handleExtractEntry(entry);
    } finally {
      setIsDraggingOut(false);
    }
  }

  // Unified Extract Handler for both files and folders
  async function handleExtractEntry(entry: HfsEntry) {
    setContextMenu(null);
    setErrorMessage(null);

    try {
      let destination: string | null = null;

      if (entry.is_directory) {
        destination = await open({
          directory: true,
          multiple: false,
          title: `Select Destination Folder for "${entry.name}"`,
        });
      } else {
        destination = await save({
          defaultPath: entry.name,
          title: `Save "${entry.name}" to Windows`,
        });
      }

      if (!destination) return;

      setIsLoading(true);
      setStatusMessage(`Extracting ${entry.is_directory ? "folder" : "file"} "${entry.name}"...`);

      const stats = await invoke<ExtractionStats>("extract_entry", {
        entryId: entry.id,
        destinationPath: destination,
      });

      setLastExtractedPath(stats.destination_path);

      if (entry.is_directory) {
        setStatusMessage(
          `Extracted folder "${entry.name}" (${stats.files_count} files, ${formatBytes(
            stats.bytes_written
          )}) successfully!`
        );
      } else {
        setStatusMessage(
          `Extracted "${entry.name}" (${formatBytes(stats.bytes_written)}) successfully!`
        );
      }
    } catch (e: any) {
      setErrorMessage(typeof e === "string" ? e : e?.message || "Failed to extract");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExtractCurrentFolder() {
    const currentFolder = currentPath[currentPath.length - 1];
    await handleExtractEntry({
      id: currentFolder.id,
      parent_id: 1,
      name: currentFolder.name,
      is_directory: true,
      size: 0,
      create_date: "",
      modify_date: "",
      valence: entries.length,
    });
  }

  async function handleRevealInExplorer(path: string) {
    try {
      await revealItemInDir(path);
    } catch (e) {
      console.error("Failed to reveal item in Explorer:", e);
    }
  }

  function handleCopyName(name: string) {
    navigator.clipboard.writeText(name);
    setContextMenu(null);
    setStatusMessage(`Copied "${name}" to clipboard`);
  }

  const filteredEntries = entries.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function getFileIcon(entry: HfsEntry) {
    if (entry.is_directory) {
      return <Folder className="w-5 h-5 text-blue-500 fill-blue-500/20 shrink-0" />;
    }
    const ext = entry.name.split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "ico", "svg"].includes(ext || "")) {
      return <ImageIcon className="w-5 h-5 text-purple-400 shrink-0" />;
    }
    if (["txt", "md", "json", "xml", "plist", "log", "rtf"].includes(ext || "")) {
      return <FileText className="w-5 h-5 text-amber-400 shrink-0" />;
    }
    if (["rs", "ts", "js", "html", "css", "c", "cpp", "py", "sh"].includes(ext || "")) {
      return <FileCode className="w-5 h-5 text-emerald-400 shrink-0" />;
    }
    return <File className="w-5 h-5 text-zinc-400 shrink-0" />;
  }

  const currentFolder = currentPath[currentPath.length - 1];

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 antialiased overflow-hidden select-none font-sans relative">
      {/* Drag-IN Full-Window Overlay */}
      {isDraggingIn && (
        <div className="absolute inset-0 z-50 bg-blue-950/80 backdrop-blur-md border-4 border-dashed border-blue-400 flex flex-col items-center justify-center p-8 text-center space-y-4 animate-in fade-in duration-150">
          <div className="p-5 rounded-full bg-blue-500/20 border border-blue-400/50 text-blue-300 animate-bounce">
            <UploadCloud className="w-16 h-16" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h2 className="text-xl font-bold text-white tracking-wide">
              Drop Files to Import into {currentFolder.name}
            </h2>
            <p className="text-xs text-blue-200 leading-relaxed">
              Release mouse button to inspect and import files into this Apple HFS+ directory.
            </p>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-72 bg-zinc-900/95 border-r border-zinc-800 flex flex-col justify-between shrink-0">
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

          {/* Read-Only Safety Badge */}
          <button
            onClick={() => setShowSafetyModal(true)}
            className="w-full flex items-center justify-between px-3 py-2 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-left">
                <div className="font-semibold text-[11px] leading-tight">Read-Only Mode</div>
                <div className="text-[10px] text-emerald-400/80">Protected against corruption</div>
              </div>
            </div>
            <Info className="w-3.5 h-3.5 text-emerald-400/60 group-hover:text-emerald-300 shrink-0" />
          </button>

          {/* Quick Actions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 px-1">
              Sources
            </label>
            <button
              onClick={handleBrowseDiskImage}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg text-zinc-200 transition-colors shadow-sm cursor-pointer"
            >
              <Disc className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Open .dmg / .img file...</span>
            </button>

            <button
              onClick={handleGenerateDemoImage}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-blue-900/40 to-indigo-900/40 hover:from-blue-900/60 hover:to-indigo-900/60 border border-blue-500/30 rounded-lg text-blue-200 transition-colors shadow-sm cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Create Test HFS+ Image</span>
            </button>
          </div>

          {/* Connected Drives */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Connected Drives
              </label>
              <button
                onClick={refreshDrives}
                title="Refresh drives"
                className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded cursor-pointer"
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
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800/60 rounded-md transition-colors text-left group cursor-pointer"
                  >
                    <HardDrive
                      className={`w-4 h-4 shrink-0 ${
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
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
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
                  <span>Catalog Items:</span>
                  <span className="text-zinc-200 font-mono">
                    {volume.file_count} files, {volume.folder_count} folders
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800/80 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>Rust + Tauri Engine</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Drag & Drop Ready
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
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 disabled:opacity-30 disabled:pointer-events-none text-zinc-300 transition-colors cursor-pointer"
            >
              <ArrowUp className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 text-xs overflow-x-auto whitespace-nowrap py-1">
              {currentPath.map((crumb, idx) => (
                <div key={crumb.id} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  <button
                    onClick={() => handleBreadcrumbClick(idx)}
                    className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
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

          {/* Right Toolbar: Drag Tip & Search */}
          <div className="flex items-center gap-2.5">
            {volume && (
              <button
                onClick={handleExtractCurrentFolder}
                title="Extract all files in current folder to Windows"
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg text-xs font-medium text-zinc-200 transition-colors cursor-pointer"
              >
                <FolderDown className="w-3.5 h-3.5 text-blue-400" />
                <span>Extract Folder</span>
              </button>
            )}

            <div className="relative w-56 shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Filter files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
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
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-sm cursor-pointer"
                >
                  Open Disk Image...
                </button>
                <button
                  onClick={handleGenerateDemoImage}
                  className="px-4 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg transition-colors cursor-pointer"
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
                  <th className="py-2.5 px-4 font-semibold w-8"></th>
                  <th className="py-2.5 px-4 font-semibold">Name</th>
                  <th className="py-2.5 px-4 font-semibold w-40">Date Modified</th>
                  <th className="py-2.5 px-4 font-semibold w-24">Type</th>
                  <th className="py-2.5 px-4 font-semibold w-28 text-right">Size</th>
                  <th className="py-2.5 px-4 font-semibold w-28 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {filteredEntries.map((entry) => {
                  const isSelected = selectedEntry?.id === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      draggable={true}
                      onDragStart={(e) => handleDragOutStart(e, entry)}
                      onClick={() => setSelectedEntry(entry)}
                      onDoubleClick={() => handleNavigateInto(entry)}
                      onContextMenu={(e) => handleContextMenu(e, entry)}
                      title="Drag with mouse to copy out onto Windows Desktop or Explorer"
                      className={`cursor-pointer transition-colors group ${
                        isSelected
                          ? "bg-blue-600/20 text-white"
                          : "hover:bg-zinc-900/60 text-zinc-300"
                      }`}
                    >
                      <td className="py-2 pl-3 pr-1 text-zinc-400 group-hover:text-zinc-400">
                        <GripVertical className="w-3.5 h-3.5 cursor-grab active:cursor-grabbing" />
                      </td>
                      <td className="py-2 px-2 flex items-center gap-2.5 font-medium truncate">
                        {getFileIcon(entry)}
                        <span className="truncate">{entry.name}</span>
                      </td>
                      <td className="py-2 px-4 text-zinc-400 font-mono text-[11px] whitespace-nowrap">
                        {entry.modify_date}
                      </td>
                      <td className="py-2 px-4 text-zinc-400">
                        {entry.is_directory ? "Folder" : "File"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-zinc-400 whitespace-nowrap">
                        {entry.is_directory ? `${entry.valence} items` : formatBytes(entry.size)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExtractEntry(entry);
                          }}
                          title={entry.is_directory ? "Extract Folder" : "Extract File"}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800/80 hover:bg-blue-600 text-zinc-300 hover:text-white rounded text-[11px] transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Extract</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Bottom Status / Selection Bar */}
        <footer className="h-11 border-t border-zinc-800/80 px-4 flex items-center justify-between text-xs bg-zinc-900/40 text-zinc-400 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            {isLoading && (
              <span className="flex items-center gap-1.5 text-blue-400 font-medium shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Working...</span>
              </span>
            )}
            {isDraggingOut && (
              <span className="flex items-center gap-1.5 text-blue-400 font-medium shrink-0 animate-pulse">
                <GripVertical className="w-3.5 h-3.5" />
                <span>Dragging item to Windows...</span>
              </span>
            )}
            {statusMessage && (
              <span className="flex items-center gap-1.5 text-blue-400 font-medium truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{statusMessage}</span>
              </span>
            )}
            {lastExtractedPath && (
              <button
                onClick={() => handleRevealInExplorer(lastExtractedPath)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 shrink-0 cursor-pointer"
              >
                <span>Reveal in Explorer</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            {errorMessage && (
              <span className="flex items-center gap-1.5 text-rose-400 font-medium truncate">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{errorMessage}</span>
              </span>
            )}
            {!statusMessage && !errorMessage && volume && (
              <span className="flex items-center gap-2">
                <span>
                  {filteredEntries.length} items in{" "}
                  <span className="text-zinc-200 font-medium">{currentFolder.name}</span>
                </span>
                <span className="text-[11px] text-zinc-400 bg-zinc-800/70 px-2 py-0.5 rounded-full">
                  Tip: Drag rows with mouse to export
                </span>
              </span>
            )}
          </div>

          {selectedEntry && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-zinc-300 font-medium truncate max-w-xs">
                {selectedEntry.name}
              </span>
              <span className="text-zinc-400 font-mono text-[11px]">
                {selectedEntry.is_directory
                  ? `${selectedEntry.valence} items`
                  : formatBytes(selectedEntry.size)}
              </span>
              <button
                onClick={() => handleExtractEntry(selectedEntry)}
                className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors shadow-sm cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{selectedEntry.is_directory ? "Extract Folder" : "Extract File"}</span>
              </button>
            </div>
          )}
        </footer>
      </main>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-52 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 text-xs text-zinc-200 backdrop-blur"
        >
          <div className="px-3 py-1 text-[10px] text-zinc-400 font-medium truncate border-b border-zinc-800 mb-1">
            {contextMenu.entry.name}
          </div>

          <button
            onClick={() => handleExtractEntry(contextMenu.entry)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-blue-600 hover:text-white transition-colors text-left cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-400 group-hover:text-white" />
            <span>
              {contextMenu.entry.is_directory ? "Extract Folder to Windows..." : "Extract File to Windows..."}
            </span>
          </button>

          <button
            onClick={() => handleCopyName(contextMenu.entry.name)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 transition-colors text-left cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-zinc-400" />
            <span>Copy Name</span>
          </button>

          <button
            onClick={() => {
              setInspectedEntry(contextMenu.entry);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 transition-colors text-left cursor-pointer"
          >
            <FileSearch className="w-3.5 h-3.5 text-zinc-400" />
            <span>Inspect Properties</span>
          </button>
        </div>
      )}

      {/* Properties Modal */}
      {inspectedEntry && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl space-y-4">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getFileIcon(inspectedEntry)}
                <h3 className="font-semibold text-sm truncate max-w-xs">{inspectedEntry.name}</h3>
              </div>
              <button
                onClick={() => setInspectedEntry(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 space-y-3 text-xs text-zinc-300">
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Type:</span>
                <span className="col-span-2 font-medium">
                  {inspectedEntry.is_directory ? "Folder (Directory)" : "File (Data Fork)"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Catalog Node ID:</span>
                <span className="col-span-2 font-mono text-blue-400">{inspectedEntry.id}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Parent CNID:</span>
                <span className="col-span-2 font-mono">{inspectedEntry.parent_id}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Size:</span>
                <span className="col-span-2 font-mono">
                  {inspectedEntry.is_directory
                    ? `${inspectedEntry.valence} items`
                    : `${formatBytes(inspectedEntry.size)} (${inspectedEntry.size} bytes)`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Modified:</span>
                <span className="col-span-2 font-mono">{inspectedEntry.modify_date}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-1 border-b border-zinc-800/60">
                <span className="text-zinc-400">Created:</span>
                <span className="col-span-2 font-mono">{inspectedEntry.create_date}</span>
              </div>
              {inspectedEntry.extents && inspectedEntry.extents.length > 0 && (
                <div className="grid grid-cols-3 gap-2 py-1">
                  <span className="text-zinc-400">Extents:</span>
                  <div className="col-span-2 space-y-1 font-mono text-[11px] text-zinc-400">
                    {inspectedEntry.extents.map((ext, i) => (
                      <div key={i}>
                        Extent #{i}: block {ext.start_block} ({ext.block_count} blocks)
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={() => handleExtractEntry(inspectedEntry)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Extract to Windows...
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drag-IN File Drop Modal (Writing & Protection Notice) */}
      {droppedFiles && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl space-y-4">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-400">
                <FileUp className="w-5 h-5" />
                <h3 className="font-semibold text-sm text-zinc-100">
                  Import Files into Apple HFS+
                </h3>
              </div>
              <button
                onClick={() => setDroppedFiles(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 space-y-3 text-xs text-zinc-300">
              <p className="text-zinc-400">
                You dragged <strong className="text-zinc-200">{droppedFiles.length} item(s)</strong> from Windows into <span className="text-blue-400 font-medium">{currentFolder.name}</span>:
              </p>

              <div className="max-h-32 overflow-y-auto bg-zinc-950/80 border border-zinc-800 rounded-lg p-2.5 space-y-1 font-mono text-[11px] text-zinc-400">
                {droppedFiles.map((path, idx) => (
                  <div key={idx} className="truncate">
                    {path}
                  </div>
                ))}
              </div>

              <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl space-y-1 text-amber-200">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>Write Protection Active (Read-Only Mode)</span>
                </div>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
                  Apple HFS+ volumes are mounted read-only to safeguard the macOS Journal (<code className="text-amber-200 font-mono">kHFSVolumeJournaledBit</code>). Writing raw blocks without an active journal commit buffer risks macOS flagging the drive as corrupt upon reconnecting to a Mac.
                </p>
              </div>
            </div>

            <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 flex justify-between gap-2">
              <button
                onClick={() => {
                  setDroppedFiles(null);
                  setShowSafetyModal(true);
                }}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Learn More
              </button>
              <button
                onClick={() => setDroppedFiles(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety / Read-Only Explanation Modal */}
      {showSafetyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-4">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-semibold text-sm text-zinc-100">
                  Read-Only Mode & Data Safety
                </h3>
              </div>
              <button
                onClick={() => setShowSafetyModal(false)}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 space-y-3.5 text-xs text-zinc-300 leading-relaxed">
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl space-y-1 text-emerald-200">
                <div className="font-semibold">Why is the app in Read-Only Mode?</div>
                <p className="text-[11px] text-emerald-300/90 leading-normal">
                  To protect your Mac hard drive from corruption. All sector reads are strictly non-destructive.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-semibold text-zinc-100">The Apple Journal Protection</h4>
                <p className="text-zinc-400">
                  Almost all macOS drives use <strong>HFS+ Journaling</strong> (<code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded">kHFSVolumeJournaledBit</code>). If a Windows tool writes raw blocks without transactionally replaying and committing to the 8 MB Apple Journal, macOS will detect an inconsistent journal state when reconnected to a Mac, potentially wiping your changes or corrupting directory trees.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-semibold text-zinc-100">What is required for Write & Delete support:</h4>
                <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px]">
                  <li><strong>Block Allocation Bitmap:</strong> Finding free bits and marking allocated sectors.</li>
                  <li><strong>B*-Tree Node Splitting:</strong> Safely splitting and rebalancing 4 KB/8 KB B-Tree catalog nodes when inserting or deleting files.</li>
                  <li><strong>Journal Transaction Buffer:</strong> Updating the <code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded">journal_info_block</code> so macOS accepts changes.</li>
                  <li><strong>Windows Disk Write Locking:</strong> Dismounting Windows drive handles with administrative privileges.</li>
                </ul>
              </div>
            </div>

            <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowSafetyModal(false)}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
