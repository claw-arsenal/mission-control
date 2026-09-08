import { lazy, Suspense, type ComponentType } from "react";

/** Preview stand-in for next/dynamic: React.lazy plus an optional loading element. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  opts: { loading?: ComponentType; ssr?: boolean } = {},
) {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return "default" in mod ? mod : { default: mod };
  });
  const Loading = opts.loading;
  return function Dynamic(props: P) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Lazy {...props} /></Suspense>;
  };
}
