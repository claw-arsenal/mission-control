"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import {
  IconDashboard,
  IconDeviceMobile,
  IconInnerShadowTop,
  IconListDetails,
  IconLogs,
  IconRobot,
  IconCalendar,
  IconStack2,
  IconSettings,
  IconFolder,
  IconFileText,
  IconChartBar,
} from "@tabler/icons-react"

import { NavMain, type NavGroup, type NavItem } from "@/components/layout/nav-main"
import { NavActivity } from "@/components/layout/nav-activity"
import { NavUser } from "@/components/layout/nav-user"
import { NotificationsBell } from "@/components/notifications/notifications-bell"
import { useModules } from "@/components/modules/modules-provider"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import packageJson from "../../package.json"
import { toast } from "sonner"

type NavEntry = NavItem & { moduleId?: string }

// `moduleId` ties an entry to a module in lib/modules/registry.ts.
// When a module is disabled, its nav entry is hidden client-side.
// Entries without a moduleId are always visible.
const NAV_GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/dashboard", icon: IconDashboard }],
  },
  {
    label: "Work",
    items: [
      { title: "Boards", url: "/boards", icon: IconListDetails, moduleId: "kanban" },
      { title: "Agenda", url: "/agenda", icon: IconCalendar, moduleId: "agenda" },
      { title: "Processes", url: "/processes", icon: IconStack2, moduleId: "processes" },
      { title: "Documents", url: "/documents", icon: IconFileText, moduleId: "documents" },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Metrics", url: "/metrics", icon: IconChartBar, moduleId: "metrics" },
      { title: "Mobile Applications", url: "/mobile-apps", icon: IconDeviceMobile, moduleId: "mobile-apps" },
    ],
  },
  {
    label: "Operate",
    items: [
      { title: "Agents", url: "/agents", icon: IconRobot },
      { title: "File Manager", url: "/file-manager", icon: IconFolder },
      { title: "System", url: "/logs", icon: IconLogs },
    ],
  },
]

const APP_VERSION = packageJson.version || "0.1.0"

type SidebarUser = {
  name: string
  email: string
  avatar: string
}

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  initialUser: SidebarUser | null
  showActivity?: boolean
}

export function AppSidebar({ initialUser, showActivity = true, ...props }: AppSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { user: authUser } = useAuth()
  const { isEnabled } = useModules()

  const groups: NavGroup[] = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((e) => !e.moduleId || isEnabled(e.moduleId)),
  }))

  const sessionUser: SidebarUser | null = authUser
    ? { name: authUser.name, email: authUser.email, avatar: "" }
    : initialUser

  const [user, setUser] = React.useState<SidebarUser | null>(sessionUser)
  const [instanceName, setInstanceName] = React.useState("")

  // Keep displayed user in sync with live session
  React.useEffect(() => {
    setUser(sessionUser)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser])

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getWorkerSettings" }),
          cache: "reload",
        })
        const json = await res.json()
        const next = String(json?.workerSettings?.instanceName || "Mission Control").trim() || "Mission Control"
        if (!cancelled) { setInstanceName(next); document.title = next; }
      } catch {
        if (!cancelled) setInstanceName("Mission Control")
      }
    })()

    const onNameChanged = (event: Event) => {
      const custom = event as CustomEvent<{ name?: string }>
      const next = String(custom.detail?.name || "Mission Control").trim() || "Mission Control"
      setInstanceName(next)
    }

    window.addEventListener("mc-instance-name-changed", onNameChanged as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener("mc-instance-name-changed", onNameChanged as EventListener)
    }
  }, [])

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" })
      // Clear MSAL token cache so Microsoft SSO doesn't silently re-authenticate
      Object.keys(sessionStorage)
        .filter(k => k.startsWith("msal."))
        .forEach(k => sessionStorage.removeItem(k))
      setUser(null)
      router.replace("/login")
      router.refresh()
      toast.success("Signed out")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign out."
      toast.error(message)
    }
  }

  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/")

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="px-2 pt-2.5 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-1 pr-0.5">
              <SidebarMenuButton
                asChild
                size="lg"
                className="h-11 flex-1 gap-2.5 rounded-lg px-2 hover:bg-sidebar-accent/70"
              >
                <Link href="/dashboard" prefetch={false} aria-label="Go to dashboard">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-elev-1">
                    <IconInnerShadowTop className="size-4" aria-hidden />
                  </span>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    {instanceName ? (
                      <span className="truncate text-sm font-semibold tracking-tight">{instanceName}</span>
                    ) : (
                      <Skeleton className="h-4 w-28 bg-sidebar-accent" />
                    )}
                    <span className="truncate text-2xs text-sidebar-foreground/55">OpenClaw · v{APP_VERSION}</span>
                  </span>
                </Link>
              </SidebarMenuButton>
              <NotificationsBell />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <NavMain groups={groups} />
        {showActivity ? <NavActivity /> : null}
      </SidebarContent>

      <SidebarFooter className="gap-1 border-t border-sidebar-border/70 px-2 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={settingsActive}
              tooltip="Settings"
              className="h-8 rounded-md text-sidebar-foreground/85 [&>svg]:text-sidebar-foreground/60 data-[active=true]:[&>svg]:text-primary"
            >
              <Link href="/settings" prefetch={false} aria-current={settingsActive ? "page" : undefined}>
                <IconSettings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {user ? <NavUser user={user} onLogout={handleLogout} /> : null}
      </SidebarFooter>
    </Sidebar>
  )
}
