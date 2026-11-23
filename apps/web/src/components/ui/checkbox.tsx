import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return <CheckboxPrimitive.Root {...props} data-slot="checkbox"
    className={cn('flex size-5 shrink-0 items-center justify-center rounded border border-input bg-background text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary data-checked:bg-primary disabled:opacity-50', className)}>
    <CheckboxPrimitive.Indicator><Check size={14} aria-hidden="true" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
