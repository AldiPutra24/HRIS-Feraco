'use client';

import { useEffect, useState } from 'react';
import { getMyEmployee, listMyContracts } from '@/lib/employee-self';
import type { Contract, Employee } from '@/lib/employees';

export function useMyEmployee() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [emp, cs] = await Promise.all([getMyEmployee(), listMyContracts()]);
        if (active) {
          setEmployee(emp);
          setContracts(cs);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat profil.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { employee, contracts, loading, error };
}
