"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ContainerLoader } from "@/components/ui/container-loader";

type PageRevealProps = {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  label?: string;
};

export function PageReveal({ children, className, delayMs = 0, label = "Loading…" }: PageRevealProps) {
  const [ready, setReady] = useState(delayMs <= 0);
  const reduceMotion = useReducedMotion();
  const visible = ready || reduceMotion;

  useEffect(() => {
    const t = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <div className="relative">
      <motion.div
        className={className}
        initial={false}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
      {!visible ? <ContainerLoader label={label} /> : null}
    </div>
  );
}
