import { Plugin } from "@opencode/plugin/tui"
import { For } from "solid-js"
import { readdirSync, existsSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { spawn } from "node:child_process"
import { join, resolve, basename, relative, sep } from "node:path"

const SKIP = new Set(["node_modules", ".git", "dist", "dist-electron", "graphify-out"])
const DEFAULT_DEPTH = 3

const C = {
  dir: "#38bdf8",
  code: "#60a5fa",
  script: "#facc15",
  data: "#34d399",
  docs: "#c084fc",
  web: "#fb923c",
  media: "#f472b6",
  config: "#94a3b8",
}

function extOf(name: string): string {
  const base = name.toLowerCase()
  const dot = base.lastIndexOf(".")
  if (dot <= 0 || dot === base.length - 1) return ""
  return base.slice(dot + 1)
}

const CONFIG_NAMES = new Set([
  "dockerfile",
  "makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  "package-lock.json",
])

function colorFor(name: string, isDir: boolean): string {
  if (isDir) return C.dir
  const lower = name.toLowerCase()
  if (CONFIG_NAMES.has(lower) || lower.startsWith(".env")) return C.config
  const ext = extOf(name)
  if (ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts") return C.code
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return C.script
  if (ext === "json" || ext === "jsonc" || ext === "yaml" || ext === "yml" || ext === "toml")
    return C.data
  if (ext === "md" || ext === "mdx" || ext === "txt") return C.docs
  if (ext === "html" || ext === "css" || ext === "scss" || ext === "less") return C.web
  if (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "gif" ||
    ext === "ico" ||
    ext === "svg" ||
    ext === "woff" ||
    ext === "woff2" ||
    ext === "wasm"
  )
    return C.media
  return C.config
}

type Params = {
  visible: boolean
  root: string
  depth: number
  paneCollapsed: boolean
  expanded: string[]
  selected: string
}

type Node = {
  rel: string
  name: string
  isDir: boolean
  level: number
  isLast: boolean
  ancestorsLast: boolean[]
}

const toRel = (root: string, abs: string): string => {
  const r = relative(root, abs).split(sep).join("/")
  return r === "" ? "" : r
}

function childEntries(absDir: string): Dirent[] {
  try {
    return readdirSync(absDir, { withFileTypes: true })
      .filter((e) => !SKIP.has(e.name))
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
      )
  } catch {
    return []
  }
}

function visibleNodes(root: string, expanded: Set<string>, maxDepth: number): Node[] {
  const out: Node[] = []
  const walk = (absDir: string, level: number, ancestorsLast: boolean[]): void => {
    if (level > maxDepth) return
    const entries = childEntries(absDir)
    entries.forEach((e, i) => {
      const abs = join(absDir, e.name)
      const rel = toRel(root, abs)
      const isDir = e.isDirectory()
      const isLast = i === entries.length - 1
      out.push({ rel, name: e.name, isDir, level, isLast, ancestorsLast })
      if (isDir && expanded.has(rel) && level < maxDepth)
        walk(abs, level + 1, [...ancestorsLast, isLast])
    })
  }
  walk(root, 0, [])
  return out
}

function topLevelExpanded(root: string): string[] {
  return childEntries(root)
    .filter((e) => e.isDirectory())
    .map((e) => toRel(root, join(root, e.name)))
}

function openInEditor(abs: string, notify: (message: string) => void): void {
  try {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
    const args =
      process.platform === "win32" ? ["/c", "start", "", abs] : [abs]
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
    })
    child.on("error", (err) => notify(`Cannot open ${basename(abs)}: ${String(err)}`))
    child.unref()
  } catch (err) {
    notify(`Cannot open ${basename(abs)}: ${String(err)}`)
  }
}

export default Plugin.define({
  id: "cairn.cli",
  setup(context) {
    // Durable store (not ephemeral memory): survives TUI restarts and
    // hot reloads, so the pane stays on without re-running /cairn.
    const [params, updateParams] = context.storage.store("cairn.params", {
      initial: {
        visible: true,
        root: "",
        depth: DEFAULT_DEPTH,
        paneCollapsed: false,
        expanded: [],
        selected: "",
      },
    })
    const st = () => params as unknown as Partial<Params>

    const currentLoc = (): string => {
      const direct = context.location as unknown as { directory?: string } | undefined
      if (direct?.directory) return direct.directory
      try {
        const def = context.data.location.default() as unknown as
          | { directory?: string }
          | string
          | undefined
        if (typeof def === "string") return def
        if (def?.directory) return def.directory
      } catch {
        /* fall through to cwd */
      }
      return process.cwd()
    }
    // Effective root: persisted root wins; empty means "current project".
    const effRoot = (): string => st().root || currentLoc()

    const getExpanded = (): Set<string> => new Set(st().expanded ?? [])
    const setExpanded = (next: Set<string>): void => {
      const arr = [...next]
      updateParams((draft) => {
        ;(draft as unknown as Params).expanded = arr
      })
    }
    const setExpandedAndSelected = (next: Set<string>, selected?: string): void => {
      const arr = [...next]
      updateParams((draft) => {
        const d = draft as unknown as Params
        d.expanded = arr
        if (selected !== undefined) d.selected = selected
      })
    }

    const moveSelection = (dir: 1 | -1): void => {
      const cur = st()
      if (!cur.visible || cur.paneCollapsed) return
      const root = effRoot()
      const nodes = visibleNodes(root, getExpanded(), cur.depth ?? DEFAULT_DEPTH)
      if (nodes.length === 0) return
      const idx = nodes.findIndex((n) => n.rel === cur.selected)
      const next =
        idx === -1 ? (dir === 1 ? nodes[0] : nodes[nodes.length - 1]) : nodes[(idx + dir + nodes.length) % nodes.length]
      updateParams((draft) => {
        ;(draft as unknown as Params).selected = next.rel
      })
    }

    const toggleSelected = (): void => {
      const cur = st()
      if (!cur.visible || cur.paneCollapsed) return
      const root = effRoot()
      const nodes = visibleNodes(root, getExpanded(), cur.depth ?? DEFAULT_DEPTH)
      const target =
        nodes.find((n) => n.rel === cur.selected && n.isDir) ?? nodes.find((n) => n.isDir)
      if (!target) return
      const next = getExpanded()
      if (next.has(target.rel)) next.delete(target.rel)
      else next.add(target.rel)
      setExpandedAndSelected(next, target.rel)
    }

    const togglePane = (): void => {
      updateParams((draft) => {
        const d = draft as unknown as Params
        d.paneCollapsed = !d.paneCollapsed
      })
    }

    const expandAll = (): void => {
      const cur = st()
      const root = effRoot()
      const all: string[] = []
      const walk = (absDir: string, level: number): void => {
        if (level > (cur.depth ?? DEFAULT_DEPTH)) return
        for (const e of childEntries(absDir)) {
          if (!e.isDirectory()) continue
          const rel = toRel(root, join(absDir, e.name))
          all.push(rel)
          walk(join(absDir, e.name), level + 1)
        }
      }
      walk(root, 0)
      setExpanded(new Set(all))
    }

    const collapseAll = (): void => {
      setExpanded(new Set())
      updateParams((draft) => {
        ;(draft as unknown as Params).selected = ""
      })
    }

    const pickAndToggle = async (): Promise<void> => {
      const cur = st()
      if (!cur.visible) return
      const root = effRoot()
      const expanded = getExpanded()
      const nodes = visibleNodes(root, expanded, cur.depth ?? DEFAULT_DEPTH).filter((n) => n.isDir)
      if (nodes.length === 0) return
      const choice = await context.ui.dialog.select({
        title: "Toggle folder",
        options: nodes.map((n) => ({
          title: `${expanded.has(n.rel) ? "▾" : "▸"} ${n.rel}/`,
          value: n.rel,
        })),
        current: cur.selected,
      })
      if (!choice) return
      const next = getExpanded()
      if (next.has(choice)) next.delete(choice)
      else next.add(choice)
      setExpandedAndSelected(next, choice)
    }

    const toggleRel = (rel: string): void => {
      const cur = st()
      if (!cur.visible || cur.paneCollapsed) return
      const next = getExpanded()
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      setExpandedAndSelected(next, rel)
    }

    const notify = (message: string): void => {
      context.ui.toast.show({ message })
    }

    const openSelectedFile = (): void => {
      const cur = st()
      if (!cur.visible || cur.paneCollapsed) return
      const root = effRoot()
      const nodes = visibleNodes(root, getExpanded(), cur.depth ?? DEFAULT_DEPTH)
      const target = nodes.find((n) => n.rel === cur.selected) ?? nodes[0]
      if (!target || target.isDir) return
      setExpandedAndSelected(getExpanded(), target.rel)
      openInEditor(join(root, ...target.rel.split("/")), notify)
    }

    context.ui.slot({
      append: "sidebar.content",
      render: () => {
        const cur = st()
        if (!cur.visible) return null
        // Pure render: never write state here (writes during render are
        // dropped/loop by the host). Derive defaults locally.
        // Mouse: core Renderable supports onMouseDown; the Solid reconciler
        // passes unknown props through as node assignments, so this is
        // best-effort — slash/palette remain the guaranteed path.
        const theme = context.theme
        const maxWidth = 34
        const fit = (s: string): string =>
          s.length > maxWidth ? s.slice(0, Math.max(0, maxWidth - 1)) + "…" : s
        const collapsed = cur.paneCollapsed ?? false
        const root = effRoot()
        const header = `${collapsed ? "▸" : "▾"} ${basename(root)}/`
        if (collapsed) {
          return (
            <box flexDirection="column">
              <text fg={theme.text.base}>
                <strong>{fit("Project Explorer")}</strong>
              </text>
              <box onMouseDown={togglePane}>
                <text fg={theme.text.base}>{fit(header)}</text>
              </box>
            </box>
          )
        }
        const expanded = new Set(cur.expanded ?? topLevelExpanded(root))
        const nodes = visibleNodes(root, expanded, cur.depth ?? DEFAULT_DEPTH)
        return (
          <box flexDirection="column">
            <text fg={theme.text.base}>
              <strong>{fit("Project Explorer")}</strong>
            </text>
            <text fg={theme.text.base}> </text>
            <box onMouseDown={togglePane}>
              <text fg={theme.text.base}>{fit(header)}</text>
            </box>
            <For each={nodes}>
              {(n) => {
                const guide = n.ancestorsLast.map((last) => (last ? "    " : "│   ")).join("")
                const branch = n.isLast ? "└── " : "├── "
                const marker = n.isDir ? (expanded.has(n.rel) ? "▾ " : "▸ ") : ""
                const cursor = n.rel === cur.selected ? "› " : "  "
                const label = `${cursor}${guide}${branch}${marker}${n.name}${n.isDir ? "/" : ""}`
                const isCursor = n.rel === cur.selected
                const fg = isCursor
                  ? (theme.text.accent ?? C.dir)
                  : colorFor(n.name, n.isDir)
                if (!n.isDir)
                  return (
                    <box onMouseDown={() => openInEditor(join(root, ...n.rel.split("/")), notify)}>
                      <text fg={fg}>{fit(label)}</text>
                    </box>
                  )
                return (
                  <box onMouseDown={() => toggleRel(n.rel)}>
                    <text fg={fg}>{fit(label)}</text>
                  </box>
                )
              }}
            </For>
          </box>
        )
      },
    })

    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "cairn.toggle",
              title: "Toggle project explorer panel",
              group: "Cairn",
              palette: true,
              slash: { name: "cairn", arguments: true },
              run: async (input) => {
                const cur = st()
                const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean)
                const sub = tokens[0]?.toLowerCase()
                if (sub === "expand" && tokens.length === 1) {
                  updateParams((draft) => {
                    ;(draft as unknown as Params).paneCollapsed = false
                  })
                  return
                }
                if (sub === "collapse" && tokens.length === 1) {
                  updateParams((draft) => {
                    ;(draft as unknown as Params).paneCollapsed = true
                  })
                  return
                }
                if (sub === "open" || sub === "close" || sub === "toggle") {
                  const target = tokens[1] ?? cur.selected ?? ""
                  const root = effRoot()
                  const abs = resolve(root, target)
                  if (!existsSync(abs)) return
                  const rel = toRel(root, abs)
                  try {
                    if (!statSync(abs).isDirectory()) return
                  } catch {
                    return
                  }
                  const next = getExpanded()
                  if (sub === "open") next.add(rel)
                  else if (sub === "close") next.delete(rel)
                  else if (next.has(rel)) next.delete(rel)
                  else next.add(rel)
                  setExpandedAndSelected(next, rel)
                  updateParams((draft) => {
                    ;(draft as unknown as Params).paneCollapsed = false
                  })
                  return
                }
                if (sub === "all") {
                  if (tokens[1] === "collapse") collapseAll()
                  else expandAll()
                  return
                }
                if (sub === "pick") {
                  await pickAndToggle()
                  return
                }
                if (sub === "edit") {
                  const target = tokens[1] ?? cur.selected ?? ""
                  const root = effRoot()
                  const abs = resolve(root, target)
                  try {
                    if (!statSync(abs).isFile()) return
                  } catch {
                    return
                  }
                  openInEditor(abs, notify)
                  return
                }
                if (sub === "help") {
                  context.ui.toast.show({
                    message:
                      "/cairn [path] [depth] • /cairn expand|collapse • /cairn toggle <path> • /cairn all|all collapse • /cairn pick|next|prev|reset",
                  })
                  return
                }
                if (sub === "reset") {
                  const root = currentLoc()
                  updateParams((draft) => {
                    const d = draft as unknown as Params
                    d.visible = true
                    d.root = root
                    d.paneCollapsed = false
                    d.expanded = topLevelExpanded(root)
                    d.selected = ""
                  })
                  return
                }
                if (sub === "next") {
                  moveSelection(1)
                  return
                }
                if (sub === "prev") {
                  moveSelection(-1)
                  return
                }
                if (cur.visible && !sub) {
                  updateParams((draft) => {
                    ;(draft as unknown as Params).visible = false
                  })
                  return
                }
                const baseDir = currentLoc()
                let root = baseDir
                let depth = cur.depth ?? DEFAULT_DEPTH
                for (const token of tokens) {
                  if (/^\d+$/.test(token)) {
                    depth = Math.min(10, Math.max(1, parseInt(token, 10)))
                  } else {
                    const candidate = resolve(baseDir, token)
                    try {
                      if (existsSync(candidate) && statSync(candidate).isDirectory()) root = candidate
                    } catch {
                      /* ignore invalid path, keep baseDir */
                    }
                  }
                }
                const rootChanged = (cur.root || baseDir) !== root
                updateParams((draft) => {
                  const d = draft as unknown as Params
                  d.visible = true
                  d.root = root
                  d.depth = depth
                  d.paneCollapsed = false
                  if (d.expanded === undefined || rootChanged) d.expanded = topLevelExpanded(root)
                  if (d.selected === undefined) d.selected = ""
                })
              },
            },
            {
              id: "cairn.pane-toggle",
              title: "Cairn: collapse/expand pane header",
              group: "Cairn",
              palette: true,
              run: () => togglePane(),
            },
            {
              id: "cairn.node-toggle",
              title: "Cairn: expand/collapse selected folder",
              group: "Cairn",
              palette: true,
              run: () => toggleSelected(),
            },
            {
              id: "cairn.node-pick",
              title: "Cairn: pick folder to expand/collapse",
              group: "Cairn",
              palette: true,
              run: async () => pickAndToggle(),
            },
            {
              id: "cairn.open-file",
              title: "Cairn: open selected file in editor",
              group: "Cairn",
              palette: true,
              run: () => openSelectedFile(),
            },
            {
              id: "cairn.next",
              title: "Cairn: move selection down",
              group: "Cairn",
              palette: true,
              run: () => moveSelection(1),
            },
            {
              id: "cairn.prev",
              title: "Cairn: move selection up",
              group: "Cairn",
              palette: true,
              run: () => moveSelection(-1),
            },
            {
              id: "cairn.expand-all",
              title: "Cairn: expand all folders",
              group: "Cairn",
              palette: true,
              run: () => expandAll(),
            },
            {
              id: "cairn.collapse-all",
              title: "Cairn: collapse all folders",
              group: "Cairn",
              palette: true,
              run: () => collapseAll(),
            },
          ],
        }))
        return null
      },
    })
  },
})
