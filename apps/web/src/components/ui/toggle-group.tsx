import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cn } from '@/lib/utils';

function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5',
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: Toggle.Props) {
  return (
    <Toggle
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-6 cursor-pointer items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[pressed]:bg-background data-[pressed]:text-foreground data-[pressed]:shadow-xs disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
