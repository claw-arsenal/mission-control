import type { ComponentProps } from "react";
const router = { replace: () => {}, push: () => {} };
export const useRouter = () => router;
export const useModules = () => ({ ready: true, isEnabled: () => true });
export default function Link(props: ComponentProps<"a">) { return <a {...props} />; }
