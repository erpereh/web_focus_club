'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
    className,
    align = 'center',
    sideOffset = 4,
    children,
    ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                align={align}
                sideOffset={sideOffset}
                className={className}
                {...props}
            >
                {children}
            </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
    );
}
