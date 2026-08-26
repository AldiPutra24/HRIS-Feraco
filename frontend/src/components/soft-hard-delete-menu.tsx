'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Icons } from '@/components/icons';

export function SoftHardDeleteMenu({
  onSoft,
  onHard,
  label = 'Hapus'
}: {
  onSoft: () => void;
  onHard: () => void;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='ghost' size='sm'>
            <Icons.trash />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={onSoft}>Hapus (soft)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant='destructive' onClick={onHard}>
          Hapus permanen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
