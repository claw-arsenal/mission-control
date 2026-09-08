import type { ComponentProps } from "react";

/** Fixture stand-in for next/image: a plain img with the same common props. */
export default function Image({ src, alt, ...props }: ComponentProps<"img"> & { src?: string; priority?: boolean; fill?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- the fixture stands in for next/image
  return <img src={typeof src === "string" ? src : ""} alt={alt ?? ""} {...props} />;
}
