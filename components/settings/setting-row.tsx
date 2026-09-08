export function SectionHeading({ title, description, id }: { title: string; description?: string; id?: string }): React.ReactNode {
  return (
    <div className="mb-6">
      <h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2>
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
    <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 flex-1">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label> : <p className="text-sm font-medium">{label}</p>}
        {description && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="sm:shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{children}</div>
    </div>
  );
}
