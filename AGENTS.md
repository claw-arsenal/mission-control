# AGENTS.md

## Prime directive
Repo-first. Before writing anything, scan for existing patterns, components, hooks, and naming conventions. Extend them — don't invent.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| UI components | Shadcn UI |
| Drag & drop | dnd-kit |
| Toasts | Sonner |
| Auth/DB | Supabase (future) |

---

## Styling rules

- **Tailwind only.** No SCSS, no inline styles, no CSS modules.
- Use Tailwind utility classes directly. No wrapper utilities like `cx()` unless it's the Shadcn `cn()` from `lib/utils.ts`.
- Use Shadcn's CSS variable tokens (`bg-background`, `text-foreground`, `border`, `ring`, etc.) — not raw hex values.
- Spacing: stick to Tailwind's 4px base scale. Don't use arbitrary values like `p-[13px]` unless truly required.
- Dark mode is handled via Tailwind's `dark:` variant + Shadcn's CSS variable system.

---

## Component rules

- **Use Shadcn components** for all UI primitives: `Button`, `Input`, `Textarea`, `Select`, `Dialog`, `Sheet`, `DropdownMenu`, `Badge`, `Avatar`, `Card`, `Table`, `Tabs`, `Popover`, `Calendar`, `Tooltip`, `Separator`.
- Never write a custom modal — use `Dialog` or `Sheet`.
- Never write a custom dropdown — use `DropdownMenu`.
- Never write a custom button element for actions — use `Button` with the correct `variant`.
- Components live in `components/`. Each component gets its own file.
- Leaf components first (e.g. `TicketCard`) then compose upward.

---

## Code quality

- No unnecessary helpers. Three similar lines of code beats a premature abstraction.
- No `normalizeX`, `processHelper`, `handleStuff` names — use domain-specific names.
- Delete unused imports, unused variables, unused components.
- Don't comment out code — just delete it.
- Don't add error handling for impossible states. Trust TypeScript and framework guarantees.
- Only validate at boundaries: user input and external API responses.

---

## File structure

```
app/
  layout.tsx        — root layout, Toaster here
  page.tsx          — thin shell, no logic
  globals.css       — Tailwind directives + Shadcn CSS vars
components/
  layout/           — Sidebar, Header
  tasks/
    kanban/         — KanbanView, KanbanColumn
    list/           — ListView
    grid/           — GridView
    shared/         — TicketCard (shared across all views)
    modals/         — CreateTicketModal, TicketDetailsModal, DiscardModal
hooks/              — state hooks (use-tasks.ts, etc.)
types/              — shared TypeScript types
lib/
  utils.ts          — cn() only
```

---

## State management

- Local `useState` + `useMemo` for page-level state. No Redux, no Zustand yet.
- Extract state into custom hooks (`use-tasks.ts`) — don't inline 10+ state vars in a component.
- Shape your state to be compatible with later Supabase wiring without a UI rewrite.

---

## Drag & drop (dnd-kit)

- Use `DndContext` at the board level, `SortableContext` per column.
- Column drag handle = header element only (pass `listeners` prop down).
- Never start a drag from interactive children (buttons, links, menus) — use `stopPropagation` or `data-no-drag` guards.
- Use `DragOverlay` for the drag ghost. Keep it visually consistent with the source element.

---

## Hover / animation rules

- Hover must never cause layout shift.
- Only use: `transition-transform`, `hover:-translate-y-0.5`, `hover:shadow-md`, `hover:border-*`.
- Never animate: `margin`, `padding`, `height`, `border-width`.

---

## Supabase (future)

- Server components → server Supabase client.
- Client components → browser Supabase client only.
- Never expose `service_role` key to the browser.
- Use RLS. Never trust client-provided `user_id` — use `auth.uid()` in policies.
- Select only needed columns. Always add `order()` for stable pagination.

---

## Responsiveness

Use Tailwind's standard breakpoints:

| Breakpoint | Width |
|---|---|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

---

## Workflow

1. Read the relevant files first.
2. Find the existing pattern closest to what you need.
3. Make the minimal correct change.
4. Remove any code you made dead.
5. Verify: no TS errors, no broken imports, spacing consistent, dark mode works.
