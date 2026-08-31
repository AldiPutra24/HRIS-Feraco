'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyEmployee } from './use-my-employee';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between gap-4 py-2'>
      <span className='text-muted-foreground text-sm'>{label}</span>
      <span className='text-right text-sm font-medium'>{value || '-'}</span>
    </div>
  );
}

export function EmployeeProfile() {
  const { employee, loading, error } = useMyEmployee();

  if (error) {
    return (
      <div className='p-4 md:p-6'>
        <p className='text-destructive'>{error}</p>
      </div>
    );
  }

  if (loading || !employee) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Profile</h2>
        <p className='text-muted-foreground text-sm'>Data profil Anda.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{employee.full_name}</CardTitle>
        </CardHeader>
        <CardContent className='divide-y'>
          <Row label='Email Kantor' value={employee.company_email} />
          <Row label='Email Pribadi' value={employee.personal_email} />
          <Row label='Department' value={employee.department_name} />
          <Row label='Position' value={employee.position_name} />
          <Row label='Manager' value={employee.manager_name} />
          <Row label='Join Date' value={employee.join_date ?? '-'} />
          <Row label='Employment Status' value={employee.employment_status} />
        </CardContent>
      </Card>
    </div>
  );
}
