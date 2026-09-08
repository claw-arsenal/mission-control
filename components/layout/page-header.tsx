"use client";

import Link from "next/link";
import { Fragment } from "react";
import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

type Crumb = {
  label: string;
  href: string;
};

type Props = {
  page: string;
  crumbs?: Crumb[];
  /** Rendered between the sidebar toggle and the trail, for a back control on narrow screens. */
  leading?: ReactNode;
  actions?: ReactNode;
};

/**
 * The shared page header: sidebar toggle, breadcrumb trail, and an actions
 * slot on the right. Sticky so the trail and actions stay reachable.
 */
export function PageHeader({ page, crumbs = [], leading, actions }: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center border-b border-line bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85 md:rounded-t-xl">
      <div className="page-x flex w-full items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SidebarTrigger className="-ml-1.5 text-muted-foreground hover:text-foreground" />
          {leading}
          <Separator orientation="vertical" className="mx-1 hidden data-[orientation=vertical]:h-4 md:flex" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1.5 text-sm sm:gap-1.5">
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.href}>
                  {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink asChild className="text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground">
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </Fragment>
              ))}
              {crumbs.length > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-medium text-foreground">{page}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
