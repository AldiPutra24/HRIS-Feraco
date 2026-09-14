'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMyEmployee, listMyContracts } from '@/lib/employee-self';
import type { Contract, Employee } from '@/lib/employees';

export function useMyEmployee() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [emp, cs] = await Promise.all([getMyEmployee(), listMyContracts()]);
      setEmployee(emp);
      setContracts(cs);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat profil.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { employee, contracts, loading, error, refresh: load };
}
