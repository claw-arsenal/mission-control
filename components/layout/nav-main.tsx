"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export type NavItem = {
  title: string
  url: string
  icon: React.ElementType
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

function isActivePath(pathname: string, url: string) {
  if (url === "/") return pathname === "/"
  return pathname === url || pathname.startsWith(`${url}/`)
}

/** Primary navigation, grouped by what the operator is doing. Empty groups are skipped. */
export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()

  return (
    <>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="eyebrow h-7 text-sidebar-foreground/55">{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.url)
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className="h-8 rounded-md text-sidebar-foreground/85 transition-[background-color,color] duration-(--dur-fast) ease-(--ease-out) data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-elev-1 [&>svg]:text-sidebar-foreground/60 data-[active=true]:[&>svg]:text-primary"
                    >
                      <Link href={item.url} prefetch={false} aria-current={active ? "page" : undefined}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
    </>
  )
}
