'use client';

import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Green "add" button: on hover the icon block slides over the label.
 * Width follows the label (min 150px); the icon block is 38px wide.
 */
export function AddButton({
  label,
  onClick,
  className,
  disabled
}: {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'group relative flex h-9 min-w-[150px] cursor-pointer items-center overflow-hidden rounded-md border border-[#34974d] bg-[#3aa856] pr-[50px] pl-3.5 transition-all duration-300 hover:bg-[#34974d] focus-visible:ring-2 focus-visible:ring-[#34974d]/50 focus-visible:outline-none active:border-[#2e8644] disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      <span className='text-sm font-semibold whitespace-nowrap text-white transition-all duration-300 group-hover:text-transparent'>
        {label}
      </span>
      <span className='absolute right-0 flex h-full w-[38px] items-center justify-center bg-[#34974d] transition-all duration-300 group-hover:w-full group-active:bg-[#2e8644]'>
        <Icons.add className='size-5 text-white' strokeWidth={2.5} />
      </span>
    </button>
  );
}
