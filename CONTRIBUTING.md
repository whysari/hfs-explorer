# Contributing to hfs-explorer

Thank you for your interest in contributing to **hfs-explorer**! As an open-source project, community contributions, bug reports, and feature requests help make reading Apple disks on Windows seamless for everyone.

---

## 🛠️ Development Setup

1. **Fork and clone** this repository:
   ```bash
   git clone https://github.com/<your-username>/hfs-explorer.git
   cd hfs-explorer
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Verify the Rust toolchain**:
   ```bash
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

4. **Launch the development app**:
   ```bash
   npm run tauri dev
   ```

---

## 📂 Project Organization

- **`src-tauri/src/hfs/`**: Pure Rust HFS+ parser engine:
  - `types.rs`: Structs for Volume Header, Fork Data, Extents, and Mac timestamps.
  - `btree.rs`: B*-Tree Catalog reader (Header, Index, and doubly linked Leaf nodes).
  - `reader.rs`: High-level reader, partition detection (GPT & APM), and file extractor.
  - `generator.rs`: Synthetic HFS+ volume generator for testing.
  - `drives.rs`: Windows drive enumeration (`\\.\PhysicalDriveN` and drive letters).
- **`src-tauri/src/lib.rs`**: Tauri IPC command handlers and app state.
- **`src/`**: React 19 frontend:
  - `App.tsx`: Main file explorer interface, breadcrumbs, search, and dialogs.
  - `App.css`: Tailwind CSS styling and theme configuration.

---

## 📋 Guidelines

- **Format your code**:
  - Rust: `cargo fmt`
  - Frontend: `npm run build` (ensures TypeScript has zero errors)
- **Check for lints**:
  - Rust: `cargo clippy --manifest-path src-tauri/Cargo.toml`
- **Commit Messages**:
  - Use conventional commits (e.g., `feat: support HFSX case-sensitive catalogs`, `fix: align btree record offsets`).

---

## 🚀 Submitting a Pull Request

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit your changes:
   ```bash
   git commit -m "feat: add feature description"
   ```
3. Push to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
4. Open a Pull Request on GitHub.
