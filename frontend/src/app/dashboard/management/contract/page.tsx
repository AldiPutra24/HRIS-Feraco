import { EmployeeContractPage } from '@/features/employee-self/contract';

export const metadata = { title: 'Kontrak' };

// Management & General Manager: own contracts, same self-service page as employees.
export default function Page() {
  return <EmployeeContractPage />;
}
