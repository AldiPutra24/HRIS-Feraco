import { EmployeeProfile } from '@/features/employee-self/profile';

export const metadata = { title: 'Profil Karyawan' };

// Management & General Manager: same self-service profile as employees
// (direct contact edits + data change requests reviewed by HR).
export default function Page() {
  return <EmployeeProfile />;
}
