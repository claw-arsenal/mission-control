export function SectionHeading({ title, description, id }: { title: string; description?: string; id?: string }): React.ReactNode {
  return (
    <div className="mb-6">
      <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-8 px-5 py-4">
      <div className="min-w-0 flex-1">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label> : <p className="text-sm font-medium">{label}</p>}
        {description && (
          <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
