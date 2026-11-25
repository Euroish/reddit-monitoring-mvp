import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cn } from '@/lib/utils';

function Progress({
  className,
  value = 0,
  ...props
}: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative w-full', className)}
      {...props}
    >
      <ProgressPrimitive.Track className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <ProgressPrimitive.Indicator className="h-full rounded-full bg-ring transition-all duration-300" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
